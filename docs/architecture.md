# Maisie Architecture

## Overview

Maisie is a home AI platform — a personal operating system for the home. It connects to every service in the house, reasons about what's happening, and acts autonomously within boundaries the household defines.

The system has three layers: an event bus that carries everything that happens, an agent runtime that decides what to do about it, and a dashboard that surfaces state and accepts conversation.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Dashboard (React SPA)                     │
│            capability-aware components, streaming chat           │
├─────────────────────────────────────────────────────────────────┤
│                    HTTP API + WebSocket (Hono)                   │
│                  action-generated endpoints, SSE chat            │
├───────────────────────┬─────────────────────────────────────────┤
│     Plugin Registry   │         Agent Runtime                    │
│  discovery, validation│   personas, memory, tool execution       │
│  capability mapping   │   event routing, autonomy tiers          │
├───────────────────────┴─────────────────────────────────────────┤
│                        Core Chassis                              │
│            Hono, MQTT client, SQLite, plugin loader              │
├──────────┬──────────┬──────────┬──────────┬────────────────────┤
│  plugin  │  plugin  │  plugin  │  plugin  │  plugin            │
│  unifi   │  plex    │  calibre │  bambu   │  ...               │
└──────────┴──────────┴──────────┴──────────┴────────────────────┘
                            │
                  MQTT Event Bus (Mosquitto)
                            │
           ┌────────────────┼────────────────┐
      synthetic-hdhr   tokyo-streamer     go2rtc
      (TV channels)    (GPU transcoding)  (camera relay)
```

### Current State

The platform currently ships as a single `agent` package implementing a "skills" architecture — each integration is a directory under `packages/agent/src/skills/` with its own client and business logic, wired together in `api.ts`. The plugin model described in this document is the target architecture toward which the codebase is evolving.

### Services at a Glance

| Service | Container | Port | Role |
|---------|-----------|------|------|
| maisie | maisie | 3001 | Agent + HTTP API + dashboard static files |
| mosquitto | mosquitto | 1883, 9001, 9002 | MQTT broker |
| synthetic-hdhr | synthetic-hdhr | 5004 | HDHomeRun emulator (cable + camera + library channels) |
| tokyo-streamer | tokyo-streamer | 5050 | GPU-accelerated HLS/MPEG-TS transcoding |
| go2rtc | go2rtc | 1984 | Camera stream relay (MSE/WebRTC for dashboard) |
| ssdp | ssdp | — (host) | SSDP broadcast so Plex finds synthetic-hdhr |
| audiobookshelf | audiobookshelf | 13378 | Audiobook library and player |

---

## The PluginAction Model

Every operation a plugin exposes is a `PluginAction` — a single TypeScript object with a name, description, Zod input/output schemas, and three surface declarations (`http`, `ai`, `ui`). The Maisie framework reads these declarations and automatically:

1. Mounts an HTTP endpoint at `POST /api/{plugin-name}/{action-name}` (or GET, depending on `http.method`)
2. Registers an AI tool in the agent's tool registry with the action's name and description
3. Makes a React hook `use{ActionName}()` available to dashboard components via the capability interface

This means a plugin author writes the action once. The framework handles the plumbing.

### Interface

```typescript
interface PluginAction<TInput, TOutput> {
  // Unique within the plugin. snake_case. Used as the HTTP path segment,
  // AI tool name, and React hook suffix.
  name: string;

  // Written for both humans and LLMs. Be precise about what the action returns
  // and under what conditions it might fail. This text becomes the AI tool
  // description verbatim — write it accordingly.
  description: string;

  // Zod schema for the input. Validated before execute() is called.
  // For GET actions this maps to query parameters. For POST, the request body.
  // The AI runtime validates tool call arguments against this schema.
  input: z.ZodType<TInput>;

  // Zod schema for the output. Validated after execute() returns.
  // Dashboard components type their data from this schema.
  output: z.ZodType<TOutput>;

  // HTTP surface configuration. Set to false to explicitly opt out.
  // Leaving undefined is a bug — caught at boot with a clear error.
  http: {
    method: "GET" | "POST" | "DELETE";
    // Optional: override the URL path segment. Defaults to action name.
    path?: string;
  } | false;

  // AI surface configuration.
  ai: {
    // When the agent may invoke this action autonomously:
    //   'ignore' — never exposed to the agent
    //   'inform' — agent may call it for context; result logged to memory
    //   'advise' — agent calls it, presents result to user for approval before acting
    //   'act'    — agent may call it and act on the result without human confirmation
    tier: "ignore" | "inform" | "advise" | "act";

    // Optional: AI-specific description override. Use when the human-facing
    // description needs to be more technical for the LLM to use the action correctly.
    description?: string;
  } | false;

  // Dashboard UI surface configuration.
  ui: {
    // Which dashboard section this action's data belongs in.
    // Built-in sections: 'network', 'media', 'storage', 'cameras', 'smarthome',
    // 'printer', 'books', 'system'. Plugins may define new section names.
    section: string;

    // MQTT topic to watch for live updates. When a message arrives on this
    // topic, dashboard components using this action's data re-fetch automatically.
    // Supports MQTT wildcards: 'home/media/plex/+' or 'home/network/#'
    realtimeTopic?: string;
  } | false;

  // The implementation. Called after input validation passes.
  // Context provides: logger, the plugin's service client, and a memory accessor.
  execute: (input: TInput, ctx: ActionContext) => Promise<TOutput>;
}
```

### Worked Example: `get_devices`

Here is the `get_devices` action from a hypothetical `plugin-unifi`, rendered on all three surfaces:

```typescript
// packages/plugin-unifi/src/actions.ts

export const getDevices = defineAction({
  name: "get_devices",
  description:
    "Returns all devices currently on the network. Each device includes MAC address, " +
    "IP, hostname, device type, online status, and the network segment (Default or IoT). " +
    "Results are sorted by last-seen descending. Offline devices are included if seen " +
    "within the last 7 days.",

  input: z.object({
    status: z.enum(["trusted", "known", "new", "suspicious", "blocked"]).optional(),
    segment: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),

  output: z.object({
    devices: z.array(DeviceSchema),
    total: z.number(),
    timestamp: z.string().datetime(),
  }),

  http: { method: "GET" },   // → GET /api/unifi/get_devices?status=new&limit=10

  ai: {
    tier: "inform",          // Agent may call this freely for context
    // No description override — the main description is already LLM-appropriate
  },

  ui: {
    section: "network",
    realtimeTopic: "home/network/devices/+",  // re-fetch on new/changed/missing
  },

  execute: async (input, ctx) => {
    const devices = await ctx.client.getDevices(input);
    return {
      devices,
      total: devices.length,
      timestamp: new Date().toISOString(),
    };
  },
});
```

**HTTP surface** — The framework mounts `GET /api/unifi/get_devices`. Query params are deserialized and validated against the input schema. Invalid params return 400 with a Zod error message.

**AI surface** — The action appears in the agent's tool registry as `get_devices`. When the agent encounters a network-related question, it may call this tool. The tier `inform` means the agent reads the result for context; it does not require human approval before using the data.

**UI surface** — Dashboard components call `useNetworkSection()` which discovers all plugins implementing the `network` capability. When an MQTT message arrives on `home/network/devices/new` or `home/network/devices/changed`, the hook automatically re-fetches.

### Surface Opt-Out

Setting a surface to `false` is explicit and intentional:

```typescript
// This action modifies state — no need for a dashboard component
ui: false,

// This action is administrative — never expose to the AI
ai: false,

// Internal helper — no HTTP endpoint
http: false,
```

Leaving `http`, `ai`, or `ui` undefined is a misconfiguration. The framework will refuse to load the plugin and log:

```
[plugin-unifi] Action 'restart_ap' missing surface declaration for 'ui'. Set to false to opt out.
```

---

## PluginEvent Model

Events are the complement to actions. Actions are things you request. Events are things that happen.

Plugins declare the events they emit so the framework can route them correctly to the agent and dashboard.

```typescript
interface PluginEvent<TPayload> {
  // Matches the MQTT topic this event is published on.
  // Use the constants from @maisie/shared/topics where possible.
  topic: string;

  // Human-readable description of what this event means.
  description: string;

  // Zod schema for the event payload. Validated on receipt.
  payload: z.ZodType<TPayload>;

  // How the agent should respond to this event.
  ai: {
    // 'ignore' — route to /dev/null. Use for high-frequency telemetry.
    // 'inform' — log to agent memory, no user-facing output
    // 'advise' — generate a notification, queue for human approval
    // 'act'    — wake the appropriate persona and run autonomously
    tier: "ignore" | "inform" | "advise" | "act";

    // Which persona should handle this event. If omitted, Maisie routes it.
    persona?: string;
  };

  // How the dashboard should respond to this event.
  ui: {
    // When true, dashboard components watching this topic re-fetch their data.
    realtime: boolean;

    // When true, the event appears in the agent notification feed visible to the user.
    notify: boolean;
  };
}
```

### Example Events

**High-frequency telemetry** — ignore at the agent, realtime for the dashboard:

```typescript
export const printerStatusEvent = defineEvent({
  topic: TOPICS.printer.bambu.status,
  description: "Bambu X1C reports current print status every 30 seconds.",
  payload: PrinterStatusSchema,
  ai: { tier: "ignore" },
  ui: { realtime: true, notify: false },
});
```

**Security alert** — wake the network persona:

```typescript
export const rogueDeviceEvent = defineEvent({
  topic: TOPICS.network.alerts.rogueDevice,
  description: "An unrecognized device joined the network. No prior history.",
  payload: z.object({
    mac: z.string(),
    ip: z.string().nullable(),
    firstSeen: z.string().datetime(),
    segment: z.string(),
  }),
  ai: { tier: "advise", persona: "natalie" },
  ui: { realtime: true, notify: true },
});
```

---

## Capabilities

Capabilities are named contracts — a set of required action names that a plugin must implement to claim the capability. They let the dashboard and agent work with any provider of a given type without knowing which plugin is installed.

| Capability | Required Actions | Optional Actions |
|------------|-----------------|------------------|
| `media-server` | `get_libraries`, `get_now_playing`, `get_recently_added` | `search_media`, `get_stream_url` |
| `network` | `get_devices`, `get_wan_health` | `block_device`, `unblock_device`, `get_topology` |
| `storage` | `get_health`, `list_files` | `get_download_url` |
| `camera` | `get_cameras`, `get_snapshot` | `get_rtsp_url`, `get_recent_events` |
| `smart-home` | `get_entities`, `call_service` | `get_entity` |
| `printer` | `get_status` | `pause_print`, `resume_print`, `cancel_print` |
| `book-library` | `search_books`, `get_book_count` | `get_book`, `get_authors` |

### Validation

A plugin that declares `capabilities: ['network']` must have actions named `get_devices` and `get_wan_health`. At boot, the framework checks this:

```
[plugin-unifi] Validating capability 'network'...
  ✓ get_devices
  ✓ get_wan_health
  ✓ Capability 'network' satisfied
```

If a required action is missing:

```
[plugin-unifi] FATAL: Capability 'network' requires action 'get_wan_health' but it is not defined.
  Plugin will not be loaded.
```

### Capability-Aware Dashboard Components

Dashboard components never import directly from a plugin package. They ask the registry:

```typescript
// NowPlayingCard.tsx — doesn't know if it's Plex or Jellyfin
const mediaServer = useCapability("media-server");
const { data } = mediaServer.useAction("get_now_playing", {});
```

If no plugin implements `media-server`, the component renders an "unavailable" state. If two plugins both implement it, the registry returns the first one (or lets the user configure priority).

---

## Plugin Registry

### Discovery

At startup, the framework scans `node_modules` for packages with a `"maisie"` key in their `package.json`:

```json
{
  "name": "@maisie/plugin-unifi",
  "maisie": {
    "capabilities": ["network", "camera"],
    "minCoreVersion": "0.1.0"
  }
}
```

Packages without this key are ignored regardless of naming.

### Validation

Before calling `init()`, the framework checks:

1. Required environment variables are present (defined in the plugin's `requiredEnv` list)
2. All declared capabilities have their required actions implemented
3. All actions have explicit `http`, `ai`, and `ui` declarations (not undefined)
4. `minCoreVersion` is satisfied

**Missing env var** — plugin is skipped, not failed. The rest of the system boots normally:

```
[plugin-unifi] Skipping: required env var UNIFI_HOST is not set.
```

**Missing capability action** — plugin is rejected:

```
[plugin-unifi] FATAL: Capability 'camera' requires 'get_snapshot' but it is not defined.
```

### Loading

Plugins that pass validation have their `init()` called in sequence. `init()` receives the framework context (config, logger, db access) and returns the plugin's service client. If `init()` throws, the plugin is skipped with a logged error — other plugins continue loading.

---

## Agent Runtime

The agent is an event-driven AI coordination layer. It is not a chatbot. Its primary job is to monitor the MQTT event bus, decide which events warrant AI reasoning, wake the appropriate persona, and either act or present a recommendation.

### Event Flow

```
MQTT message arrives
        │
        ▼
  EventRouter
  ┌─────────────────────────────────────────────────┐
  │ 1. Find matching PluginEvent declaration         │
  │ 2. Validate payload against event schema         │
  │ 3. Read ai.tier                                  │
  └─────────────────────────────────────────────────┘
        │
  ┌─────┴──────────────────────────────────────┐
  │ tier: 'ignore'     │ tier: 'inform'         │
  │ Discard            │ Continue               │
  └────────────────────┴────────────────────────┘
        │
  PersonaRouter
  ┌─────────────────────────────────────────────────┐
  │ 1. Find persona with matching eventSubscription  │
  │ 2. Fall back to Maisie if none matches           │
  └─────────────────────────────────────────────────┘
        │
  Context Assembly
  ┌─────────────────────────────────────────────────┐
  │ - Recent episodes from that persona's memory     │
  │ - Relevant facts from agent_facts                │
  │ - Current event payload                          │
  │ - Current timestamp, home state summary          │
  └─────────────────────────────────────────────────┘
        │
  generateText() — Anthropic API
  ┌─────────────────────────────────────────────────┐
  │ model: claude-haiku (routine) / claude-sonnet    │
  │ system: persona's system prompt                  │
  │ tools: actions in persona's toolScopes           │
  │ messages: [context + event]                      │
  └─────────────────────────────────────────────────┘
        │
  ┌─────┴──────────────────────────────────────┐
  │ tier: 'inform'  │ tier: 'advise'            │ tier: 'act'
  │ Log to memory   │ Push to notification      │ Execute tool calls
  │                 │ queue, await approval     │ Log episode to memory
  └─────────────────┴───────────────────────────┘
```

### Tier Behavior in Detail

**`inform`** — The agent reads the event and updates its understanding of the world. No user-facing output unless the persona decides the information is noteworthy. Episode is written to memory.

Example: `home/media/plex/now_playing` fires every 30 seconds. Tier is `inform`. Channing logs what's playing and moves on. No notification.

**`advise`** — The agent reasons about the event and generates a recommendation, but does not act. The recommendation appears in the notification queue. The user approves or dismisses it.

Example: A new device joins the network. Tier is `advise`. Natalie runs `get_devices` and `get_wan_health`, identifies the device, composes a summary ("Unknown device 192.168.20.47 — Apple OUI, likely a phone. Recommend marking as 'known'."), and queues it. The user approves; the action executes.

**`act`** — The agent reasons and acts without waiting for human confirmation. Reserved for low-stakes, clearly-correct, easily-reversible operations.

Example: The EPG refresh timer fires. Tier is `act`. Channing calls `refresh_epg` and logs the result.

---

## Memory System

Three SQLite tables persist agent knowledge across restarts:

### `agent_episodes`

What happened, when, what was decided, what tools were used.

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `persona` | text | Which persona generated this episode |
| `timestamp` | text | ISO 8601 |
| `trigger` | text | MQTT topic or 'chat' |
| `summary` | text | What the persona observed and decided |
| `tools_used` | text | JSON array of action names called |
| `tier` | text | 'inform', 'advise', or 'act' |
| `outcome` | text | 'logged', 'queued', 'executed', 'dismissed' |

Episodes are the agent's short-term memory. They inform future reasoning by showing what has already been noticed and acted upon.

### `agent_facts`

Durable facts about the home. Set by personas over time; persist indefinitely unless explicitly updated.

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `domain` | text | e.g., 'network', 'media', 'household' |
| `key` | text | Fact identifier |
| `value` | text | Fact content (free text or JSON) |
| `set_by` | text | Persona name |
| `set_at` | text | ISO 8601 |
| `confidence` | real | 0.0–1.0 |

Example facts:

```
domain='network',   key='known_devices_count',  value='67'
domain='household', key='primary_viewer',        value='hammer'
domain='media',     key='plex_active',           value='true'
```

### `agent_preferences`

User and home preferences by domain. Consulted when personas make judgment calls.

| Column | Type | Description |
|--------|------|-------------|
| `domain` | text | e.g., 'notifications', 'media', 'automation' |
| `key` | text | Preference name |
| `value` | text | Preference value |

Example preferences:

```
domain='notifications', key='quiet_hours',     value='23:00-07:00'
domain='media',         key='auto_enrich',     value='false'
domain='network',       key='alert_new_iot',   value='true'
```

### Memory Isolation

Personas have isolated memory views by default. Natalie's episodes are hers. Channing's are his. Maisie can read all personas' episodes — this is how she provides cross-domain synthesis ("Why is the TV buffering?" requires correlating network and media data).

---

## The Persona System

Personas are AI specialists. Each one is defined by a system prompt, a set of MQTT topics they monitor, a set of actions they can use, and a default autonomy tier.

```typescript
interface Persona {
  id: string;           // 'maisie', 'natalie', 'channing', 'alexandria'
  name: string;         // Display name
  systemPrompt: string; // 200–400 words of domain expertise and judgment criteria
  plugin: string;       // Which plugin ships this persona

  // MQTT topics this persona watches. Supports wildcards.
  eventSubscriptions: string[];

  // Action names this persona may call. The agent assembles tools from these names
  // by looking them up in the plugin registry. Personas cannot use actions
  // outside this list, even if those actions exist.
  toolScopes: string[];

  // Default tier for events this persona handles. Individual PluginEvent
  // declarations may override this.
  defaultTier: "inform" | "advise" | "act";
}
```

When an event arrives, the PersonaRouter finds the persona whose `eventSubscriptions` best matches the topic. That persona runs with:
- Their system prompt
- Only the tools in their `toolScopes`
- Their recent episodes from memory
- Relevant facts from `agent_facts`

A persona cannot accidentally use tools from another domain. This is enforced by the tool assembly step, not by the system prompt.

---

## Dashboard Architecture

The dashboard is a React SPA served as static files by the agent (`packages/dashboard/`). It connects to the agent over HTTP for data and MQTT-over-WebSocket for real-time updates.

### Capability Interface

Dashboard components do not import from plugin packages. They use the capability interface:

```typescript
// Ask for whatever implements 'media-server'
const media = useCapability("media-server");

// Call an action from that capability
const { data, loading } = media.useAction("get_now_playing", {});

// Subscribe to real-time updates (auto-wired from realtimeTopic declaration)
media.useRealtime("get_now_playing");
```

This means swapping Plex for Jellyfin requires only changing which plugin implements `media-server` — no dashboard code changes.

### Chat Interface

The chat panel at the bottom of the dashboard streams responses from `GET /api/chat` via Server-Sent Events. The user may address specific personas:

- `@Natalie why is 192.168.20.47 on my network?`
- `@Channing what's on channel 302 right now?`
- `@Alexandria find books by Ursula K. Le Guin`
- General messages → Maisie routes to the appropriate specialist or answers directly

The SSE stream sends partial tokens as they arrive. The client renders them incrementally.

### Notification Feed

The `GET /api/agent/notifications` endpoint returns queued `advise`-tier recommendations. Each notification has an approve/dismiss action. Approving executes the queued tool call. Dismissing logs the dismissal to memory so the persona doesn't re-surface the same recommendation.
