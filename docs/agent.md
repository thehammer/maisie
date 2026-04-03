# The Maisie Agent System

The agent is the reasoning core of Maisie. It is not a chatbot. Its primary function is to watch everything that happens in the home via MQTT, decide which events warrant AI reasoning, and either act autonomously or surface a recommendation to the user.

The chat panel on the dashboard is a secondary interface — a way to query the agent and address personas directly. Most agent activity happens silently, in the background, triggered by events.

---

## What the Agent Is

The agent is an **event-driven AI coordinator**. It:

1. Subscribes to the full MQTT topic space
2. Receives events from every connected service
3. Classifies each event by autonomy tier
4. Wakes the appropriate persona
5. Provides context (memory, tools) and lets the persona reason
6. Executes, queues, or logs the result

The agent is not a general-purpose assistant. It has a job: maintain the home. Each persona has a domain and stays in it.

---

## The Three-Tier Autonomy Model

Every event and every action is classified into one of three tiers. The tier determines whether the agent acts, queues a recommendation, or just observes.

### Tier 1: `inform`

**What:** The agent observes and updates its memory. No user output unless the persona judges something noteworthy.

**Use when:** The event is routine. The data is useful for context but doesn't require action.

**Examples:**
- Plex starts playing a movie → Channing logs it to memory
- NAS storage check returns 72% used → Natalie logs it, no alert
- Printer reports 34% complete → Bambu status event, ignored entirely
- WAN health check returns 12ms RTT → Natalie logs it as baseline

**User experience:** The notification feed is empty. Memory is accumulating context for future reasoning.

### Tier 2: `advise`

**What:** The agent reasons about the event, assembles a recommendation, and queues it for human approval. Nothing executes until the user approves.

**Use when:** The action changes state, modifies data, affects hardware, or has effects that are hard to reverse.

**Examples:**
- Unknown device joins the network → Natalie identifies it, recommends marking it 'known' or 'suspicious'. User approves.
- Calibre enrichment pipeline finds missing metadata → Alexandria proposes changes. User reviews each one.
- Sonarr adds a new show to the queue → Channing surfaces it as "here's what was added." No action needed.
- NAS storage hits 85% → Natalie recommends running cleanup. User approves.

**User experience:** A notification appears in the feed. The user sees the reasoning, approves or dismisses. Approval triggers execution. Dismissal is logged so the persona doesn't re-surface the same recommendation.

### Tier 3: `act`

**What:** The agent reasons and acts without waiting for confirmation.

**Use when:** The action is low-stakes, clearly correct, easily reversed, and the user would be annoyed if asked.

**Examples:**
- EPG refresh timer fires → Channing calls `refresh_epg`, logs the result
- A device Natalie has seen before (same OUI family, same hostname pattern) joins the network → Natalie marks it 'known' automatically
- Lights in a room are toggled via a scene → Maisie executes immediately

**User experience:** Nothing visible unless the persona decides to mention it. The episode is logged to memory.

**Guard rails:** `act` is only available for specific actions. A plugin author must explicitly set `tier: "act"`. The framework will not infer it.

---

## Event Flow Walkthrough

Tracing a single event from MQTT arrival to agent response.

**Scenario:** An unrecognized device joins the network. The UniFi controller publishes to `home/network/alerts/rogue_device`.

```
1. MQTT broker receives message on home/network/alerts/rogue_device
   Payload: { mac: "b8:27:eb:a1:c2:d3", ip: "192.168.1.201", segment: "Default" }

2. Maisie agent's MQTT client fires the message handler

3. EventRouter receives the message
   - Scans registered PluginEvent declarations for topic match
   - Finds: rogueDeviceEvent { tier: "advise", persona: "natalie" }
   - Validates payload against the event's Zod schema ✓

4. tier is "advise" — not ignored, proceed

5. PersonaRouter selects Natalie
   - rogueDeviceEvent.ai.persona = "natalie"
   - Natalie is loaded and her toolScopes are: [get_devices, get_wan_health,
     get_cameras, block_device, unblock_device, mark_device_status]

6. Context assembly
   - Recent episodes from Natalie's memory (last 10 episodes matching network topics)
   - Relevant facts: known_devices_count=67, last_scan=2 minutes ago
   - Current event payload
   - Current timestamp, day of week

7. Anthropic API call
   Model: claude-haiku-4-5-20251001
   System: Natalie's system prompt (network specialist, thresholds, tone)
   Tools: [get_devices, get_wan_health, get_cameras, block_device,
           unblock_device, mark_device_status]
   Messages: [assembled context + event payload]

8. Model response: calls get_devices({ limit: 5, status: "new" })
   Framework executes the tool call
   Result: [{ mac: "b8:27:eb:...", ouiManufacturer: "Raspberry Pi Foundation",
              hostname: null, status: "new" }]

9. Model continues reasoning, produces text:
   "New Raspberry Pi (b8:27:eb:a1:c2:d3) on the Default VLAN at 192.168.1.201.
    No hostname. Likely a new project device. Recommend marking as 'known' —
    it's a known OUI family but hasn't been seen before."

10. tier is "advise" — result pushed to notification queue
    Notification: {
      persona: "natalie",
      summary: "New Raspberry Pi on Default VLAN...",
      proposedAction: { tool: "mark_device_status",
                        args: { mac: "b8:27:eb:a1:c2:d3", status: "known" } },
      timestamp: "...",
    }

11. Episode logged to agent_episodes:
    { persona: "natalie", trigger: "home/network/alerts/rogue_device",
      summary: "...", tools_used: ["get_devices"], tier: "advise",
      outcome: "queued" }

12. Dashboard notification feed shows Natalie's recommendation
    User clicks "Approve" → mark_device_status executes
    Episode outcome updated to "executed"
```

---

## The Persona System

Personas are AI specialists. Each one has a defined domain and stays in it.

### How Personas Are Selected

The EventRouter finds the persona whose `eventSubscriptions` best match the incoming topic. Matching rules:

1. Exact topic match wins over wildcard
2. More specific wildcard wins (`home/network/alerts/+` beats `home/network/#`)
3. If no persona matches, Maisie receives the event

### What Context a Persona Receives

Every persona call is assembled with:

- **System prompt** — the persona's domain knowledge and judgment criteria
- **Tool list** — only actions in `toolScopes` (enforced, not just instructed)
- **Recent episodes** — last N episodes from this persona's memory
- **Relevant facts** — `agent_facts` rows matching the event's domain
- **Current event** — the triggering event payload
- **Temporal context** — current timestamp, day of week, time of day

The persona cannot access memory from other personas directly (except Maisie, who can read all).

### Persona Selection for Chat

When the user sends a message in the dashboard chat:

- `@Natalie what devices are online?` → Natalie responds
- `@Channing what's on 302?` → Channing responds
- `@Alexandria find Le Guin` → Alexandria responds
- No `@` prefix → Maisie receives it and either responds directly or delegates

Maisie uses the message content to decide whether to answer herself or hand off to a specialist. A question about Plex playback goes to Channing. A question about the library goes to Alexandria. A cross-domain question ("Why is everything slow tonight?") stays with Maisie.

---

## Memory

Three SQLite tables. Each serves a distinct purpose.

### `agent_episodes` — What Has Happened

Episodes are written after every agent run. They are the short-term working memory of each persona.

An episode records:
- Which persona ran
- What triggered it (MQTT topic or 'chat')
- What the persona decided (free text summary)
- Which tools were called
- What the outcome was: logged, queued, executed, or dismissed

**When agents read episodes:** Before reasoning about an event, the context assembler fetches recent episodes for the active persona. This lets personas notice patterns ("this device appeared yesterday too") and avoid re-surfacing dismissed recommendations.

**Retention:** Episodes older than 30 days are pruned on a nightly schedule.

### `agent_facts` — What Is Durably True

Facts are written by personas when they learn something durable about the home. They persist until explicitly updated or deleted.

```
domain='network',    key='primary_router',        value='UDM Pro at 192.168.1.1'
domain='household',  key='residents',             value='["hammer"]'
domain='media',      key='plex_library_count',    value='4'
domain='books',      key='calibre_library_count', value='3847'
```

Facts answer the question "what does the agent know about this home?" They are more permanent than episodes and more specific than preferences.

**When agents write facts:** When a persona discovers something durable during a run. Example: Natalie counts the network segments and writes `known_segments=2`. Channing finds the EPG device auth and writes `epg_device_auth=abc123`.

### `agent_preferences` — How the Household Wants Things

Preferences represent the household's configuration of agent behavior. They are written by the user (via chat or the settings panel) or inferred by personas over time.

```
domain='notifications', key='quiet_hours',         value='23:00-07:00'
domain='media',         key='auto_enrich_books',   value='false'
domain='network',       key='alert_on_new_iot',    value='true'
domain='automation',    key='autonomy_level',       value='conservative'
```

Personas consult preferences when making judgment calls. If `alert_on_new_iot` is false, Natalie still logs new IoT devices but doesn't queue a notification.

---

## Tool Assembly

When a persona is selected to handle an event, the framework assembles a tool list from the persona's `toolScopes`.

1. Look up each action name in the plugin registry
2. Convert to Anthropic tool format (name, description, input_schema from Zod)
3. Pass to the Anthropic API as `tools`

Tools outside `toolScopes` are never assembled. The LLM cannot call them. This is the enforcement mechanism — not a prompt instruction.

**Example assembly for Natalie:**

```typescript
toolScopes: ["get_devices", "get_wan_health", "get_cameras", "block_device",
             "unblock_device", "mark_device_status"]
```

Assembled tools (simplified):

```json
[
  {
    "name": "get_devices",
    "description": "Returns all devices currently on the network...",
    "input_schema": {
      "type": "object",
      "properties": {
        "status": { "type": "string", "enum": ["trusted", "known", "new", "suspicious", "blocked"] },
        "limit": { "type": "number", "default": 100 }
      }
    }
  },
  ...
]
```

The Anthropic API receives exactly these tools. Natalie cannot call Channing's `get_now_playing` or Alexandria's `search_books` — they were never assembled.

---

## The Streaming Chat Interface

**Endpoint:** `GET /api/chat`
**Protocol:** Server-Sent Events (SSE)
**Parameters:** `?message=...&persona=...` (persona is optional)

The client opens an SSE connection with the user's message. The agent:

1. Selects the persona (from `@` prefix or Maisie by default)
2. Assembles context and tools
3. Calls the Anthropic API with `stream: true`
4. Forwards partial tokens to the SSE stream as they arrive
5. After streaming completes, logs the episode

SSE event format:

```
event: token
data: {"text": "The"}

event: token
data: {"text": " Raspberry"}

event: token
data: {"text": " Pi..."}

event: done
data: {"inputTokens": 842, "outputTokens": 156, "persona": "natalie"}
```

The dashboard client renders tokens incrementally into the chat bubble.

**Tool calls during streaming:** When the model issues a tool call, the framework pauses the stream, executes the tool, returns the result to the model, and resumes streaming. The user sees a brief "thinking" indicator during tool execution.

---

## The Notification System

**Endpoint:** `GET /api/agent/notifications`
**Returns:** Array of queued `advise`-tier recommendations

Each notification:

```typescript
interface AgentNotification {
  id: string;
  persona: string;           // Which persona generated it
  summary: string;           // What the persona found and recommends
  proposedAction?: {         // The tool call to execute on approval
    tool: string;
    args: Record<string, unknown>;
  };
  triggeredBy: string;       // MQTT topic or 'chat'
  createdAt: string;
  expiresAt?: string;        // Some recommendations expire (e.g., EPG refresh)
}
```

**Approving:** `POST /api/agent/notifications/{id}/approve`
- Executes `proposedAction` if present
- Updates the episode outcome to 'executed'
- Removes from the queue

**Dismissing:** `POST /api/agent/notifications/{id}/dismiss`
- No action executed
- Updates the episode outcome to 'dismissed'
- The persona sees the dismissal in future context and does not re-surface the same recommendation for 24 hours

---

## Extending the Agent

### Adding Event Rules

Event routing is driven by `PluginEvent` declarations. To teach the agent about a new event:

1. Declare the event in your plugin (see [building-a-plugin.md](building-a-plugin.md#pluginevent-reference))
2. Set `ai.tier` and optionally `ai.persona`
3. Add the topic to the appropriate persona's `eventSubscriptions`

No configuration required. The framework picks it up on restart.

### Writing a New Persona

1. Write a system prompt (200–400 words, specific thresholds and criteria)
2. Define `eventSubscriptions` — the MQTT topics the persona watches
3. Define `toolScopes` — the actions the persona may call
4. Ship it in your plugin's `persona` export

See [personas.md](personas.md) for the full reference on each official persona.

### Adjusting Autonomy

The global autonomy level is a preference:

```
domain='automation', key='autonomy_level', value='conservative'
```

| Level | Effect |
|-------|--------|
| `conservative` | All `act` tier actions are demoted to `advise` |
| `standard` | Default behavior |
| `autonomous` | All `advise` tier actions from trusted personas are promoted to `act` |

Individual action tiers can also be overridden per-household in the preferences table.
