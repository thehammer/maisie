# Building a Maisie Plugin

This guide walks through writing a Maisie plugin from scratch. By the end you will have a working plugin with three actions, a package.json with the correct `maisie` key, and a test file covering the required cases.

No prior Maisie knowledge required.

---

## Quickstart

The fastest path: a minimal "system info" plugin with three actions and no persona. We'll make it work first, then explain everything.

### What We're Building

A plugin called `plugin-sysinfo` that exposes:

- `get_hostname` — returns the machine's hostname (GET, safe read)
- `get_uptime` — returns uptime in seconds (GET, safe read)
- `restart_service` — restarts a named system service (POST, state change)

### File Structure

```
packages/plugin-sysinfo/
  package.json
  src/
    index.ts       ← plugin definition (the entry point)
    actions.ts     ← action implementations
    client.ts      ← abstraction over the system calls
```

### package.json

```json
{
  "name": "@maisie/plugin-sysinfo",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "maisie": {
    "capabilities": [],
    "minCoreVersion": "0.1.0",
    "requiredEnv": []
  },
  "dependencies": {
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@maisie/core": "workspace:*"
  }
}
```

The `"maisie"` key is what makes this a Maisie plugin. The framework finds it during discovery. `capabilities: []` is valid — this plugin doesn't claim any capability contract.

### src/client.ts

```typescript
// Thin wrapper over OS calls. This interface is what tests will mock.
export interface SysinfoClient {
  getHostname(): Promise<string>;
  getUptimeSeconds(): Promise<number>;
  restartService(name: string): Promise<{ success: boolean; message: string }>;
}

export function createSysinfoClient(): SysinfoClient {
  return {
    async getHostname() {
      return Bun.spawn(["hostname"]).stdout.text().then(s => s.trim());
    },

    async getUptimeSeconds() {
      const text = await Bun.file("/proc/uptime").text();
      return parseFloat(text.split(" ")[0]);
    },

    async restartService(name: string) {
      const proc = Bun.spawn(["systemctl", "restart", name]);
      const exit = await proc.exited;
      return {
        success: exit === 0,
        message: exit === 0 ? `${name} restarted` : `Failed to restart ${name} (exit ${exit})`,
      };
    },
  };
}
```

### src/actions.ts

```typescript
import { z } from "zod";
import { defineAction } from "@maisie/core";
import type { SysinfoClient } from "./client";

// createActions accepts the client as a parameter.
// This is the mock injection point for tests.
export function createActions(client: SysinfoClient) {
  return {

    get_hostname: defineAction({
      name: "get_hostname",
      description:
        "Returns the hostname of the machine running the Maisie agent. " +
        "Useful for confirming which server is being queried in multi-host setups.",

      input: z.object({}),
      output: z.object({
        hostname: z.string(),
        timestamp: z.string().datetime(),
      }),

      http: { method: "GET" },  // → GET /api/sysinfo/get_hostname

      ai: { tier: "inform" },   // Agent may call freely; result logged, not announced

      ui: {
        section: "system",
        // No realtimeTopic — hostname rarely changes; on-demand is fine
      },

      execute: async (_input, _ctx) => ({
        hostname: await client.getHostname(),
        timestamp: new Date().toISOString(),
      }),
    }),

    get_uptime: defineAction({
      name: "get_uptime",
      description:
        "Returns system uptime in seconds. Use this to check how long the server " +
        "has been running since the last reboot. Returns a human-readable string " +
        "in addition to the raw seconds value.",

      input: z.object({}),
      output: z.object({
        uptimeSeconds: z.number(),
        uptimeHuman: z.string(),   // e.g. "3 days, 4 hours"
        timestamp: z.string().datetime(),
      }),

      http: { method: "GET" },

      ai: { tier: "inform" },

      ui: {
        section: "system",
        realtimeTopic: "home/system/agent/heartbeat",  // re-fetch on each heartbeat
      },

      execute: async (_input, _ctx) => {
        const seconds = await client.getUptimeSeconds();
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        return {
          uptimeSeconds: Math.floor(seconds),
          uptimeHuman: `${days} days, ${hours} hours`,
          timestamp: new Date().toISOString(),
        };
      },
    }),

    restart_service: defineAction({
      name: "restart_service",
      description:
        "Restarts a named systemd service on the host machine. Requires the service " +
        "name (e.g. 'caddy', 'nginx'). Returns success/failure and a message. " +
        "This is an irreversible operation — use with care.",

      input: z.object({
        service: z.string().min(1).describe("systemd service name to restart"),
      }),
      output: z.object({
        success: z.boolean(),
        message: z.string(),
        service: z.string(),
        timestamp: z.string().datetime(),
      }),

      http: { method: "POST" },  // → POST /api/sysinfo/restart_service

      ai: { tier: "advise" },    // Agent queues recommendation; human approves

      ui: false,                 // No dashboard component needed for this action

      execute: async (input, _ctx) => {
        const result = await client.restartService(input.service);
        return {
          ...result,
          service: input.service,
          timestamp: new Date().toISOString(),
        };
      },
    }),

  };
}
```

### src/index.ts

```typescript
import { definePlugin } from "@maisie/core";
import { createSysinfoClient } from "./client";
import { createActions } from "./actions";

export default definePlugin({
  id: "sysinfo",
  name: "System Info",
  description: "Hostname and uptime from the host machine.",

  // Called once at startup. Return value becomes ctx.client in execute().
  // Throw here to skip loading this plugin (service unavailable, bad config, etc.)
  async init(ctx) {
    const client = createSysinfoClient();
    // Verify we can reach the host
    await client.getHostname();
    return client;
  },

  // Called with the value returned by init()
  actions(client) {
    return createActions(client);
  },

  // No events emitted by this plugin
  events: [],

  // No persona shipped with this plugin
  persona: null,

  // healthCheck is called by GET /api/health and the dashboard
  async healthCheck(client) {
    try {
      await client.getHostname();
      return { status: "healthy" };
    } catch {
      return { status: "offline", message: "Cannot read hostname" };
    }
  },
});
```

That's a complete, working plugin. Now let's go deeper.

---

## The `maisie` Key in package.json

```json
{
  "name": "@maisie/plugin-example",
  "maisie": {
    "capabilities": ["network"],
    "minCoreVersion": "0.1.0",
    "requiredEnv": ["EXAMPLE_HOST", "EXAMPLE_API_KEY"]
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `capabilities` | Yes | Array of capability names this plugin implements. May be empty. Must match what your actions actually provide — validated at boot. |
| `minCoreVersion` | Yes | Semver. Framework refuses to load if core version is older. |
| `requiredEnv` | No | Env vars that must be set for this plugin to load. If any are missing, the plugin is skipped (not an error). |

The `"maisie"` key being present is the sole discovery mechanism. The framework ignores the package name.

---

## PluginAction Reference

### `name`

Snake case. Unique within the plugin. Used as:
- HTTP path segment: `GET /api/{plugin-id}/{name}`
- AI tool name (must be globally unique — prefix with plugin id if needed)
- React hook suffix: `use{PascalCase(name)}()`

Good: `get_devices`, `search_books`, `get_wan_health`
Bad: `getDevices`, `devices`, `fetch` (too generic)

### `description`

Written for both humans and LLMs. The AI sees this description verbatim when deciding whether to call the tool. Be specific:

Good:
> Returns all cameras registered in UniFi Protect. Each camera includes its current recording state, last motion event, resolution, and RTSP stream alias. Offline cameras are included. Results sorted by name.

Bad:
> Gets cameras.

Include: what it returns, what format, what edge cases (offline devices, empty results), what it does NOT return.

### `input` and `output`

Zod schemas. These are the contract — validated on every call.

- Optional fields should have `.optional()` or `.default()`
- Add `.describe()` to fields that need explanation
- Output schemas should be strict (no `z.any()`) — LLMs reason better with typed fields
- For GET endpoints, input maps to query parameters. Keep types serializable (strings, numbers, booleans)

### `http.method`

| Method | Use for |
|--------|---------|
| `GET` | Reads with no side effects. Safe to call multiple times. |
| `POST` | Creates, updates, or triggers operations. |
| `DELETE` | Removes a resource. |

Never use GET for mutations. Idempotency matters — GET requests may be cached.

### `ai.tier`

| Tier | Agent behavior | Example actions |
|------|---------------|-----------------|
| `ignore` | Never exposed to the agent | Internal helpers, streaming endpoints |
| `inform` | Agent may call freely; result goes to memory | `get_devices`, `get_now_playing`, `get_book_count` |
| `advise` | Agent calls it, queues result for human approval | `add_movie`, `apply_enrichment`, `restart_service` |
| `act` | Agent calls and acts without confirmation | `toggle_light`, `refresh_epg`, `mark_device_known` |

**Rule of thumb for advise vs act:**
- Touches hardware? → `advise`
- Irreversible? → `advise`
- Changes persistent data? → `advise`
- "I'd want to confirm this before it happens" → `advise`
- Safe, low-stakes, easily undone? → `act`
- High-frequency telemetry? → `inform` or `ignore`

### `ai.description`

Override the human-facing description with an LLM-optimized version. Use this when:
- The action has technical context an LLM needs but a human UI doesn't
- The description needs to explain argument formats precisely
- You want to steer the LLM away from common misuse

```typescript
ai: {
  tier: "inform",
  description:
    "Returns network device list. The 'status' parameter accepts exactly: " +
    "'trusted', 'known', 'new', 'suspicious', 'blocked'. " +
    "Do NOT pass 'online' or 'offline' — those are not valid status values. " +
    "To find new unknown devices, use status='new'.",
}
```

### `ui.section`

Groups the action's data in the dashboard. Built-in sections:

| Section | Dashboard location |
|---------|-------------------|
| `network` | Network card |
| `media` | Media/Plex card |
| `storage` | NAS storage card |
| `cameras` | Camera grid |
| `smarthome` | Smart home panel |
| `printer` | Printer card |
| `books` | Calibre/library card |
| `system` | System status card |

Plugins may define new section names. The framework creates a new card for unknown sections.

### `ui.realtimeTopic`

MQTT topic pattern to watch. When a message arrives on a matching topic, dashboard components using this action's data re-fetch automatically. Supports MQTT wildcards:

```typescript
realtimeTopic: "home/network/devices/+"      // single-level wildcard
realtimeTopic: "home/network/#"              // all network topics
realtimeTopic: "home/media/plex/now_playing" // exact topic
```

Only set this if the data changes frequently enough to warrant automatic refresh. For data that changes rarely, omit it — components can refresh on page load or on-demand.

---

## Tiers in Depth

### `inform` — Safe Reads

Use for anything the agent should know about but not act on. High-frequency events, reference data, status reads.

The agent calls `inform` actions freely while assembling context for a response. The result is logged to memory but not surfaced to the user unless the persona decides it's noteworthy.

```typescript
// Good inform examples:
// - get_devices (network inventory)
// - get_now_playing (current Plex session)
// - get_book_count (library size)
// - get_cameras (camera list)
```

### `advise` — Curated Recommendations

Use when the operation changes state, touches hardware, or is hard to reverse. The agent reasons about whether the action should happen and generates a recommendation. The user sees it in the notification queue and approves or dismisses.

```typescript
// Good advise examples:
// - restart_service (restarts a running process)
// - add_movie (queues a download — fills disk)
// - apply_enrichment (modifies library metadata)
// - block_device (changes network access)
// - run_scan (long-running operation)
```

**Important:** If you're not sure, use `advise`. It is always safer than `act`. The user can approve repeatedly fast once they trust the pattern.

### `act` — Autonomous Actions

Use sparingly. Only for operations that are:
- Low-stakes (easily reversed or inconsequential if wrong)
- Clearly correct (no ambiguity about whether they should happen)
- Fast (not long-running)

```typescript
// Good act examples:
// - mark_device_known (labels a device — easily changed)
// - refresh_epg (fetches data — no side effects)
// - toggle_light (user expects this to be instant)
// - add_note (creates a record — no irreversible effect)
```

**Never use `act` for:** file deletion, service restarts, network changes, anything that writes to external services outside the home, anything that costs money.

---

## PluginEvent Reference

### `topic`

Must match the MQTT topic your plugin publishes on. Use constants from `@maisie/shared/topics` when available:

```typescript
import { TOPICS } from "@maisie/shared";
topic: TOPICS.network.alerts.rogueDevice,
```

For new topics not in the shared constants, use the `home/{domain}/{sub}/{name}` convention.

### `ai.tier`

Same tier system as actions, but applies to events instead of explicit calls:

```typescript
// High-frequency heartbeat — never wake the agent
ai: { tier: "ignore" }

// Device came online — log it
ai: { tier: "inform", persona: "natalie" }

// New unknown device — surface to user
ai: { tier: "advise", persona: "natalie" }

// Scheduled maintenance window started — go do it
ai: { tier: "act", persona: "maisie" }
```

### Two Event Examples

**Realtime telemetry** — printer reports status every 30 seconds. The dashboard needs to update. The agent doesn't care.

```typescript
export const printerStatusEvent = defineEvent({
  topic: TOPICS.printer.bambu.status,
  description: "Bambu X1C printer status update (temperature, progress, state).",
  payload: z.object({
    state: z.enum(["idle", "printing", "paused", "error", "offline"]),
    progressPercent: z.number().min(0).max(100).nullable(),
    bedTemp: z.number().nullable(),
    nozzleTemp: z.number().nullable(),
    timestamp: z.string().datetime(),
  }),
  ai: { tier: "ignore" },
  ui: { realtime: true, notify: false },
});
```

**Security alert** — Natalie should wake up and investigate:

```typescript
export const rogueDeviceEvent = defineEvent({
  topic: TOPICS.network.alerts.rogueDevice,
  description:
    "An unrecognized device joined the network with no prior history. " +
    "MAC address, IP, and network segment are provided.",
  payload: z.object({
    mac: z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i),
    ip: z.string().ip().nullable(),
    segment: z.string(),
    firstSeen: z.string().datetime(),
  }),
  ai: { tier: "advise", persona: "natalie" },
  ui: { realtime: true, notify: true },
});
```

---

## Declaring Capabilities

When you declare a capability, you are making a contract:

```json
{
  "maisie": {
    "capabilities": ["media-server"]
  }
}
```

This says: "My plugin satisfies the `media-server` contract." The framework checks:

1. Does the plugin have an action named `get_libraries`? ✓ or FATAL
2. Does the plugin have an action named `get_now_playing`? ✓ or FATAL
3. Does the plugin have an action named `get_recently_added`? ✓ or FATAL

Optional actions (`search_media`, `get_stream_url`) do not need to be present.

The dashboard's `<NowPlayingCard>` asks the registry: "who implements `media-server`?" It calls `get_now_playing` on whatever plugin it gets back. It never knows if it's your plugin or a different one.

To see what a capability requires, check [docs/architecture.md#capabilities](architecture.md#capabilities) or query the registry at runtime:

```typescript
const required = registry.getCapabilityRequirements("media-server");
// ["get_libraries", "get_now_playing", "get_recently_added"]
```

---

## Writing a Persona

A persona is the most important thing you can add to a plugin. It transforms the plugin from a passive API into an active member of the household.

### The System Prompt

The system prompt is what your persona knows and how it thinks. Write it as if briefing a new team member.

**Template:**

```typescript
const systemPrompt = `
You are {Name}, the {role} for {household name}.

Your domain: {what you know about}. You monitor {what events you watch}.
You have access to: {list of tools in toolScopes}.

Your judgment criteria:
- {What you consider normal vs. anomalous}
- {What threshold triggers an alert}
- {What you always do first}
- {What you escalate to Maisie}

Communication style: {how you write — technical? casual? precise? concise?}

When you act:
- {What you do autonomously}
- {What you queue for human approval}
- {What you never do}

Context you always have: {what background knowledge you carry}
`.trim();
```

**Guidance:**

- 200–400 words. Too short and the persona lacks consistency. Too long and it wastes tokens.
- Include the persona's name in first-person. It helps tool calls carry identity.
- Be specific about thresholds and criteria. "A new IoT device on the Default VLAN is suspicious" is better than "know about devices."
- Specify communication style explicitly. Personas interact via the chat panel — tone matters.
- Include what the persona should NOT do. Constraints are as important as capabilities.

### Persona Definition

```typescript
export const natalie: Persona = {
  id: "natalie",
  name: "Natalie",
  plugin: "@maisie/plugin-unifi",

  systemPrompt: `
You are Natalie, the network and infrastructure specialist for this household.

Your domain: the home network, connected devices, NAS health, and physical security cameras.
You monitor: home/network/#, home/protect/#, home/nas/#.
You have access to: get_devices, get_wan_health, get_nas_health, get_cameras, block_device, unblock_device, mark_device_status.

Your judgment criteria:
- A device on the IoT VLAN (192.168.20.0/24) attempting to reach the Default VLAN is suspicious.
- A new device on the Default VLAN with no manufacturer match (unknown OUI) warrants investigation.
- NAS storage above 85% used is a warning. Above 95% is critical.
- A camera going offline for >10 minutes is a notification. >1 hour is an alert.
- WAN RTT above 50ms is elevated. Packet loss above 1% is degraded.

Communication style: direct and technical. You write for the person who set up the network.
No fluff. Lead with the finding, follow with evidence, end with recommendation.

When you act autonomously:
- Mark devices as 'known' when they match a pattern you've seen before (same OUI family, same hostname pattern).

When you queue for approval:
- Block a device.
- Change a device's status from 'known' to 'suspicious'.
- Any action touching the IoT VLAN firewall rules.

When you escalate to Maisie:
- Events that cross domains (e.g., network anomaly coincides with a media outage).
- Anything you're uncertain about.
`.trim(),

  eventSubscriptions: [
    "home/network/#",
    "home/protect/#",
    "home/nas/#",
  ],

  toolScopes: [
    "get_devices",
    "get_wan_health",
    "get_nas_health",
    "get_cameras",
    "block_device",
    "unblock_device",
    "mark_device_status",
  ],

  defaultTier: "inform",
};
```

Each field explained:

| Field | Description |
|-------|-------------|
| `id` | Used in `@Natalie` chat addressing and `persona` field on events |
| `plugin` | The plugin that ships this persona (for discovery and attribution) |
| `systemPrompt` | Sent as the `system` parameter on every Anthropic API call for this persona |
| `eventSubscriptions` | MQTT topic patterns. When a matching event arrives, this persona is selected by the EventRouter. Wildcards supported. |
| `toolScopes` | Action names this persona may call. Tools outside this list are not assembled — the LLM never sees them. |
| `defaultTier` | Fallback tier if the PluginEvent declaration doesn't specify one |

---

## Testing

### Required Test Coverage

For every plugin, tests must cover:

1. **Happy path** — valid input produces schema-valid output
2. **Invalid input** — bad schema is rejected before `execute()` is called
3. **Service unavailable** — client throws, action returns error (not crash)
4. **Plugin structure** — all required capability actions present
5. **Event declarations** — correct tier and topic

### The Mock Pattern

Client is injected via factory function:

```typescript
// In your test file
import { createActions } from "../src/actions";
import type { SysinfoClient } from "../src/client";

// Mock implements the same interface as the real client
const mockClient: SysinfoClient = {
  getHostname: async () => "tokyo.local",
  getUptimeSeconds: async () => 259200, // 3 days
  restartService: async (name) => ({ success: true, message: `${name} restarted` }),
};

const actions = createActions(mockClient);

// Test happy path
test("get_hostname returns hostname and timestamp", async () => {
  const result = await actions.get_hostname.execute({}, mockContext);
  expect(result.hostname).toBe("tokyo.local");
  expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

// Test service unavailable
test("get_hostname handles client failure gracefully", async () => {
  const failingClient: SysinfoClient = {
    ...mockClient,
    getHostname: async () => { throw new Error("Cannot read hostname"); },
  };
  const failActions = createActions(failingClient);
  await expect(failActions.get_hostname.execute({}, mockContext)).rejects.toThrow("Cannot read hostname");
});

// Test invalid input rejected
test("restart_service rejects empty service name", async () => {
  const result = actions.restart_service.input.safeParse({ service: "" });
  expect(result.success).toBe(false);
});
```

### Mock Context

The `ActionContext` passed to `execute()` in tests:

```typescript
import type { ActionContext } from "@maisie/core";

export const mockContext: ActionContext = {
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  memory: {
    logEpisode: async () => {},
    getFacts: async () => [],
    setFact: async () => {},
  },
};
```

### Running Tests

```bash
bun test                          # all tests in the monorepo
bun test packages/plugin-sysinfo  # single plugin
bun test --watch                  # watch mode during development
bun test --coverage               # coverage report
```

---

## Common Mistakes

### 1. Leaving a surface undefined

```typescript
// BAD — 'ui' is undefined. Framework will reject at boot.
ai: { tier: "inform" },
// ui is missing entirely
```

```typescript
// GOOD — explicit opt-out
ai: { tier: "inform" },
ui: false,
```

### 2. Using `act` for persistent state changes

```typescript
// BAD — this modifies library metadata and is hard to reverse
ai: { tier: "act" },   // ← should be "advise"
execute: async (input, ctx) => {
  await ctx.client.applyEnrichment(input.bookId, input.changes);
}
```

### 3. Not handling `init()` failures

```typescript
// BAD — if the service is down at boot, the plugin crashes loudly
async init(ctx) {
  const client = createMyClient(ctx.config);
  return client; // no validation that it actually works
}
```

```typescript
// GOOD — validate the connection, let the framework handle the skip
async init(ctx) {
  const client = createMyClient(ctx.config);
  await client.ping(); // throws if unreachable → plugin skipped cleanly
  return client;
}
```

### 4. Actions that do too many things

```typescript
// BAD — one action that does five different things based on a 'mode' parameter
execute: async (input, ctx) => {
  if (input.mode === "devices") { ... }
  else if (input.mode === "health") { ... }
  else if (input.mode === "topology") { ... }
}
```

Split into `get_devices`, `get_wan_health`, `get_topology`. Each action should do one thing. The agent calls them individually — it can combine the results in its reasoning.

### 5. System prompts that are too short

```typescript
// BAD — persona has no domain knowledge
systemPrompt: "You are Natalie, a network assistant. Help the user.",
```

A two-sentence system prompt produces inconsistent behavior. The persona doesn't know its thresholds, its tone, or what it should escalate. Write 200–400 words minimum. The Anthropic API context window is large — don't economize on the system prompt.

### 6. Zod schemas with `any`

```typescript
// BAD — the AI can't reason about the contents of 'data'
output: z.object({
  data: z.any(),
})
```

```typescript
// GOOD — typed fields the LLM can use
output: z.object({
  devices: z.array(DeviceSchema),
  total: z.number(),
  timestamp: z.string().datetime(),
})
```
