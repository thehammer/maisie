# Testing in Maisie

## Philosophy

Behavioral tests only. A test should read like a specification clause.

Good: "when a new device is seen, `get_devices` returns it in the result set"
Bad: "calls `client.getDevices()` once with the expected arguments"

Tests survive implementation rewrites. The mock changes; the assertion stays. Tests that bind to implementation details — specific method names, call counts, internal data transformations — break during legitimate refactors and provide no value.

Every test should document a behavior the system is supposed to have. If you can't describe what a test is checking in one plain-English sentence, it probably shouldn't exist.

---

## What to Test

### For Every Plugin Action

**Happy path** — valid input produces schema-valid output

```typescript
test("get_devices returns devices matching the status filter", async () => {
  const actions = createActions(mockClient);
  const result = await actions.get_devices.execute({ status: "new", limit: 10 }, mockContext);

  // Assert the output validates against the declared schema
  const parsed = actions.get_devices.output.safeParse(result);
  expect(parsed.success).toBe(true);

  // Assert behavioral contract
  expect(result.devices.every(d => d.status === "new")).toBe(true);
  expect(result.total).toBe(result.devices.length);
  expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});
```

**Invalid input** — bad schema rejected before `execute()` is called

```typescript
test("get_devices rejects invalid status value", () => {
  const actions = createActions(mockClient);
  const parsed = actions.get_devices.input.safeParse({ status: "online" });

  // "online" is not a valid DeviceStatus
  expect(parsed.success).toBe(false);
  expect(parsed.error?.issues[0].path).toContain("status");
});

test("restart_service rejects empty service name", () => {
  const actions = createActions(mockClient);
  const parsed = actions.restart_service.input.safeParse({ service: "" });
  expect(parsed.success).toBe(false);
});
```

**Service unavailable** — client throws, action returns meaningful error, not crash

```typescript
test("get_devices handles client failure gracefully", async () => {
  const failingClient: UniFiClientInterface = {
    ...mockClient,
    getDevices: async () => { throw new Error("Connection refused"); },
  };
  const actions = createActions(failingClient);

  // Should reject with a meaningful error, not an unhandled crash
  await expect(
    actions.get_devices.execute({}, mockContext)
  ).rejects.toThrow("Connection refused");
});
```

**Edge cases specific to the action** — empty results, limit enforcement, etc.

```typescript
test("get_devices returns empty list when no devices match filter", async () => {
  const emptyClient: UniFiClientInterface = {
    ...mockClient,
    getDevices: async () => [],
  };
  const actions = createActions(emptyClient);
  const result = await actions.get_devices.execute({ status: "suspicious" }, mockContext);

  expect(result.devices).toEqual([]);
  expect(result.total).toBe(0);
});
```

### For Every Plugin Event

**Correct tier declared** — verify the event declaration matches what the system expects:

```typescript
import { rogueDeviceEvent } from "../src/events";

test("rogue device event has advise tier", () => {
  expect(rogueDeviceEvent.ai.tier).toBe("advise");
});

test("rogue device event notifies the user", () => {
  expect(rogueDeviceEvent.ui.notify).toBe(true);
});
```

**Correct MQTT topic** — topic constants should match declared topics:

```typescript
import { TOPICS } from "@maisie/shared";

test("rogue device event uses the correct MQTT topic", () => {
  expect(rogueDeviceEvent.topic).toBe(TOPICS.network.alerts.rogueDevice);
});
```

**Payload validates** — representative payloads should parse successfully:

```typescript
test("rogue device event accepts valid payload", () => {
  const payload = {
    mac: "b8:27:eb:a1:c2:d3",
    ip: "192.168.1.201",
    segment: "Default",
    firstSeen: new Date().toISOString(),
  };
  const result = rogueDeviceEvent.payload.safeParse(payload);
  expect(result.success).toBe(true);
});

test("rogue device event rejects invalid MAC format", () => {
  const payload = {
    mac: "not-a-mac",
    ip: "192.168.1.201",
    segment: "Default",
    firstSeen: new Date().toISOString(),
  };
  const result = rogueDeviceEvent.payload.safeParse(payload);
  expect(result.success).toBe(false);
});
```

### For Plugin Structure

**Required capability actions present** — if a plugin declares a capability, all required actions must exist:

```typescript
import plugin from "../src/index";
import { getCapabilityRequirements } from "@maisie/core";

test("plugin satisfies declared capabilities", async () => {
  const client = createMockClient();
  const actions = plugin.actions(client);
  const actionNames = Object.keys(actions);

  for (const cap of plugin.capabilities) {
    const required = getCapabilityRequirements(cap);
    for (const actionName of required) {
      expect(actionNames).toContain(actionName);
    }
  }
});
```

**All actions have explicit surface declarations:**

```typescript
test("all actions have explicit http, ai, and ui declarations", async () => {
  const client = createMockClient();
  const actions = plugin.actions(client);

  for (const [name, action] of Object.entries(actions)) {
    expect(action.http).not.toBeUndefined();  // false is allowed, undefined is not
    expect(action.ai).not.toBeUndefined();
    expect(action.ui).not.toBeUndefined();
  }
});
```

**`healthCheck()` returns 'offline' when service unreachable:**

```typescript
test("healthCheck returns offline when service is unreachable", async () => {
  const deadClient: SysinfoClient = {
    getHostname: async () => { throw new Error("ECONNREFUSED"); },
    getUptimeSeconds: async () => { throw new Error("ECONNREFUSED"); },
    restartService: async () => { throw new Error("ECONNREFUSED"); },
  };

  // Directly test the healthCheck function with the dead client
  const result = await plugin.healthCheck(deadClient);
  expect(result.status).toBe("offline");
  expect(result.message).toBeTruthy();
});
```

### For Agent Runtime

**Event routing** — correct persona selected for each topic:

```typescript
import { EventRouter } from "@maisie/core/agent";
import { rogueDeviceEvent } from "@maisie/plugin-unifi";

test("rogue device events route to natalie", () => {
  const router = new EventRouter([rogueDeviceEvent]);
  const match = router.route("home/network/alerts/rogue_device");
  expect(match?.persona).toBe("natalie");
});

test("wildcard subscription matches subtopics", () => {
  const router = new EventRouter([rogueDeviceEvent]);
  // Natalie subscribes to home/network/# — should match any network subtopic
  const match = router.route("home/network/health/wan");
  expect(match?.persona).toBe("natalie");
});
```

**Tier handling** — inform logs, advise queues, act executes:

```typescript
test("inform tier logs episode and produces no notification", async () => {
  const agent = createTestAgent({ events: [nowPlayingEvent] });
  await agent.handleEvent("home/media/plex/now_playing", validNowPlayingPayload);

  expect(agent.episodeLog).toHaveLength(1);
  expect(agent.episodeLog[0].outcome).toBe("logged");
  expect(agent.notificationQueue).toHaveLength(0);
});

test("advise tier queues notification without executing", async () => {
  const agent = createTestAgent({ events: [rogueDeviceEvent] });
  await agent.handleEvent("home/network/alerts/rogue_device", validRogueDevicePayload);

  expect(agent.notificationQueue).toHaveLength(1);
  expect(agent.notificationQueue[0].persona).toBe("natalie");
});
```

**Memory** — episodes stored after each run, facts persist:

```typescript
test("episode is written after handling an event", async () => {
  const agent = createTestAgent({ events: [nowPlayingEvent] });
  await agent.handleEvent("home/media/plex/now_playing", validNowPlayingPayload);

  const episodes = await agent.memory.getRecentEpisodes("channing");
  expect(episodes).toHaveLength(1);
  expect(episodes[0].trigger).toBe("home/media/plex/now_playing");
});

test("persona can read its own facts", async () => {
  const agent = createTestAgent({});
  await agent.memory.setFact("network", "known_count", "67", "natalie");

  const facts = await agent.memory.getFacts("network");
  expect(facts.find(f => f.key === "known_count")?.value).toBe("67");
});
```

---

## The Mock Pattern

### Overview

Plugin clients are created via factory functions that accept a config object. Tests inject a mock object implementing the same TypeScript interface. No mocking framework needed — just a plain object that satisfies the interface.

```typescript
// packages/plugin-unifi/src/client.ts

// The interface is the contract. Tests implement this; real code implements this.
export interface UniFiClientInterface {
  getDevices(filter?: { status?: DeviceStatus; limit?: number }): Promise<Device[]>;
  getWanHealth(): Promise<WanHealth>;
  blockDevice(mac: string): Promise<void>;
  unblockDevice(mac: string): Promise<void>;
  markDeviceStatus(mac: string, status: DeviceStatus): Promise<void>;
}

// createActions accepts the interface, not the concrete client
export function createActions(client: UniFiClientInterface) {
  return {
    get_devices: defineAction({
      // ...
      execute: async (input) => {
        const devices = await client.getDevices(input);
        return { devices, total: devices.length, timestamp: new Date().toISOString() };
      }
    })
  };
}
```

```typescript
// packages/plugin-unifi/src/actions.test.ts

import { createActions } from "./actions";
import type { UniFiClientInterface } from "./client";
import { mockContext } from "../../test-helpers";

// Minimal mock — only implements what you need for the test
const mockClient: UniFiClientInterface = {
  getDevices: async (filter) => {
    const devices = [
      { mac: "aa:bb:cc:dd:ee:ff", status: "trusted", ip: "192.168.1.100", ... },
      { mac: "11:22:33:44:55:66", status: "new",     ip: "192.168.1.201", ... },
    ];
    if (filter?.status) {
      return devices.filter(d => d.status === filter.status);
    }
    return devices;
  },
  getWanHealth: async () => ({ rtt: 12, packetLoss: 0, timestamp: new Date().toISOString() }),
  blockDevice: async () => {},
  unblockDevice: async () => {},
  markDeviceStatus: async () => {},
};

const actions = createActions(mockClient);
```

### Mock Context

Every `execute()` call receives an `ActionContext`. Create a test helper that provides a no-op version:

```typescript
// packages/test-helpers/index.ts

import type { ActionContext } from "@maisie/core";

export const mockContext: ActionContext = {
  logger: {
    info: (_msg: string, ..._args: unknown[]) => {},
    warn: (_msg: string, ..._args: unknown[]) => {},
    error: (_msg: string, ..._args: unknown[]) => {},
  },
  memory: {
    logEpisode: async (_episode) => {},
    getRecentEpisodes: async (_persona, _limit) => [],
    getFacts: async (_domain) => [],
    setFact: async (_domain, _key, _value, _persona) => {},
    getPreference: async (_domain, _key) => null,
  },
};
```

For tests that need to assert on memory calls, replace the no-op with a recorded version:

```typescript
const episodeLog: EpisodeRecord[] = [];

const recordingContext: ActionContext = {
  ...mockContext,
  memory: {
    ...mockContext.memory,
    logEpisode: async (episode) => { episodeLog.push(episode); },
  },
};
```

### Partial Mock Pattern

For tests that only need to override one method, spread the base mock:

```typescript
test("handles 403 from WAN health check", async () => {
  const actions = createActions({
    ...mockClient,
    getWanHealth: async () => { throw new Error("403 Forbidden"); },
  });

  await expect(actions.get_wan_health.execute({}, mockContext))
    .rejects.toThrow("403 Forbidden");
});
```

---

## Running Tests

```bash
bun test                              # all tests in the monorepo
bun test packages/plugin-unifi        # single plugin
bun test packages/plugin-unifi/src/actions.test.ts  # single file
bun test --watch                      # watch mode during development
bun test --coverage                   # coverage report
bun test -t "get_devices"             # filter by test name substring
```

### Test File Conventions

- Test files: `src/*.test.ts` alongside the file they test
- One test file per source file (actions.test.ts for actions.ts, client.test.ts for client.ts)
- Helper factories in `src/test-helpers.ts` (never checked into the test file itself)

### What Not to Test

- Internal implementation details (private methods, internal data structures)
- Third-party library behavior (Zod validation internals, Anthropic API responses)
- One-liner utility functions with no branching
- TypeScript types (the compiler handles this)

If you find yourself mocking a mock to test a mock, step back. Test the behavior from the outside.
