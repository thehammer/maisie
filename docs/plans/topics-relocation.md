# Plan: topics-relocation

## Goal

Move `packages/shared/src/topics.ts` from `@maisie/shared` into `packages/agent/src/topics.ts`. Remove the re-export from shared's barrel. Update all import sites in the agent package to use the local path. Verify with `bun run typecheck`.

## Why

`packages/shared/` is headed for extraction as `@universal-interface/` — a domain-agnostic type and expression library. `topics.ts` contains Maisie-specific home automation MQTT topic paths (e.g. `home/network/devices/new`, `home/ble/...`). These are not domain-agnostic and do not belong in a general-purpose type library.

## Current State

Confirmed by reading the source files:

**`packages/shared/src/topics.ts`** — exports a single `TOPICS` const with sub-namespaces: `network`, `media`, `smarthome`, `packages`, `printer`, `nas`, `gaming`, `protect`, `hpPrinter`, `ble`, `system`.

**`packages/shared/src/index.ts` line 1** — `export * from "./topics"` — topics IS re-exported from the shared barrel.

**Files that import TOPICS** (confirmed via grep, all in `packages/agent/src/`):
1. `packages/agent/src/index.ts` — `import { TOPICS } from "@maisie/shared"`
2. `packages/agent/src/skills/network/sync.ts` — `import { TOPICS } from "@maisie/shared"`
3. `packages/agent/src/skills/ble/mqtt-bridge.ts` — `import { TOPICS } from "@maisie/shared"`
4. `packages/agent/src/skills/ble/registry.ts` — `import { TOPICS } from "@maisie/shared"`
5. `packages/agent/src/skills/maintenance/nightly-runner.ts` — `import { TOPICS } from "@maisie/shared"`
6. `packages/agent/src/skills/maintenance/docker-upgrades.ts` — `import { TOPICS } from "@maisie/shared"`

No files outside `packages/agent/` import `TOPICS`. The dashboard and plugin-core do not use it. The test files in `packages/shared/src/__tests__/` do not import topics.

## Steps

### Step 1: Copy the file to its new location

Create `packages/agent/src/topics.ts` with the full content of `packages/shared/src/topics.ts`. The content is identical — do not change the `TOPICS` export shape.

The file content to write (copy exactly):

```typescript
// MQTT topic constants — single source of truth for all pub/sub

export const TOPICS = {
  network: {
    devices: {
      new: "home/network/devices/new",
      changed: "home/network/devices/changed",
      missing: "home/network/devices/missing",
    },
    health: {
      wan: "home/network/health/wan",
      ap: (name: string) => `home/network/health/ap/${name}` as const,
    },
    alerts: {
      rogueDevice: "home/network/alerts/rogue_device",
      anomalousTraffic: "home/network/alerts/anomalous_traffic",
      openPort: "home/network/alerts/open_port",
    },
  },
  media: {
    radarr: { upcoming: "home/media/radarr/upcoming" },
    sonarr: { upcoming: "home/media/sonarr/upcoming" },
    plex: {
      recentlyAdded: "home/media/plex/recently_added",
      nowPlaying: "home/media/plex/now_playing",
    },
  },
  smarthome: {
    lights: (zone: string) => `home/smarthome/lights/${zone}` as const,
    scenes: { triggered: "home/smarthome/scenes/triggered" },
    sports: { gameResult: "home/smarthome/sports/game_result" },
  },
  packages: {
    shipped: "home/packages/shipped",
    statusChanged: "home/packages/status_changed",
    delivered: "home/packages/delivered",
  },
  printer: {
    bambu: {
      status: "home/printer/bambu/status",
      filament: "home/printer/bambu/filament",
    },
    inventory: { lowStock: "home/printer/inventory/low_stock" },
  },
  nas: {
    storage: { alert: "home/nas/storage/alert" },
    docker: {
      changed: "home/nas/docker/changed",
      down: "home/nas/docker/down",
    },
    health: "home/nas/health",
  },
  gaming: {
    ps4: {
      status: "home/gaming/ps4/status",
      catalog: "home/gaming/ps4/catalog",
    },
  },
  protect: {
    cameras: "home/protect/cameras",
    events: "home/protect/events",
  },
  hpPrinter: {
    status: "home/hp-printer/status",
    supplyLow: "home/hp-printer/supply_low",
    error: "home/hp-printer/error",
  },
  ble: {
    devices: {
      discovered: "home/ble/devices/discovered",
      updated: "home/ble/devices/updated",
      lost: "home/ble/devices/lost",
    },
    state: (mac: string) => `home/ble/state/${mac.replace(/:/g, "")}` as const,
    command: (mac: string) => `home/ble/command/${mac.replace(/:/g, "")}` as const,
    commandResult: (mac: string) => `home/ble/command/${mac.replace(/:/g, "")}/result` as const,
    gateway: {
      status: (node: string) => `home/ble/gateway/${node}/status` as const,
      scan: (node: string) => `home/ble/gateway/${node}/scan` as const,
    },
  },
  system: {
    agent: {
      health: (skill: string) => `home/system/agent/${skill}/health` as const,
      heartbeat: "home/system/agent/heartbeat",
    },
    scanner: { results: "home/system/scanner/results" },
    nightly: {
      status: "home/system/nightly/status",
      progress: "home/system/nightly/progress",
    },
    hevc: {
      status: "home/system/hevc/status",
    },
    docker: {
      checkStarted: "home/system/docker/check_started",
      checkCompleted: "home/system/docker/check_completed",
    },
  },
} as const
```

### Step 2: Remove topics from shared's barrel

In `packages/shared/src/index.ts`, delete line 1:
```typescript
export * from "./topics";
```

Do NOT delete `packages/shared/src/topics.ts` yet — do that only after all imports are updated and typecheck passes. (Or delete it in the same pass, since we're doing a single atomic change.)

After removing the barrel re-export, delete `packages/shared/src/topics.ts`.

### Step 3: Update all six import sites

For each of the six files, change the import from `"@maisie/shared"` to a relative path pointing to `packages/agent/src/topics.ts`.

**File 1: `packages/agent/src/index.ts`**
- Change: `import { TOPICS } from "@maisie/shared"`
- To: `import { TOPICS } from "./topics"`

**File 2: `packages/agent/src/skills/network/sync.ts`**
- Change: `import { TOPICS } from "@maisie/shared"`
- To: `import { TOPICS } from "../../topics"`

**File 3: `packages/agent/src/skills/ble/mqtt-bridge.ts`**
- Change: `import { TOPICS } from "@maisie/shared"`
- To: `import { TOPICS } from "../../topics"`

**File 4: `packages/agent/src/skills/ble/registry.ts`**
- Change: `import { TOPICS } from "@maisie/shared"`
- To: `import { TOPICS } from "../../topics"`

**File 5: `packages/agent/src/skills/maintenance/nightly-runner.ts`**
- Change: `import { TOPICS } from "@maisie/shared"`
- To: `import { TOPICS } from "../../topics"`

**File 6: `packages/agent/src/skills/maintenance/docker-upgrades.ts`**
- Change: `import { TOPICS } from "@maisie/shared"`
- To: `import { TOPICS } from "../../topics"`

The relative depths are:
- `packages/agent/src/index.ts` → `./topics` (same dir)
- `packages/agent/src/skills/*/` → `../../topics` (two levels up: skills/{domain}/ → src/)

### Step 4: Verify

Run from the repo root:
```bash
bun run typecheck
```

This must exit with no errors. If there are errors, grep the error output for any remaining `"@maisie/shared"` TOPICS imports and fix them.

Also run:
```bash
bun test
```

No tests should break — topics is pure data, not tested directly. The agent test suite doesn't import TOPICS in test files.

## What NOT to do

- Do not add `TOPICS` to any other package or make it a shared constant again. It belongs only in `packages/agent/`.
- Do not create a re-export shim in `packages/shared/`. The point is removal.
- Do not modify the TOPICS content itself — this is a pure relocation.

```yaml
suggested_config:
  cody:
    model: haiku
    effort: medium
    rationale: "downgrade: mechanical file move + import path updates. No logic changes, no new tests needed. Haiku is sufficient for a pure relocation."
  redd:
    model: haiku
    effort: low
    rationale: "downgrade: simple rename/relocation, no new behavior to test-drive. Typecheck is the primary gate."
  marty:
    model: haiku
    effort: low
    rationale: "downgrade: no logic change. Typecheck is the only verification needed; nothing to refactor."
  perri:
    skip: true
    rationale: "No new behavior introduced, no security surface changed."
```
