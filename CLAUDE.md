# Maisie — AI Development Guide

## What This Is

Maisie is a plugin-based home AI platform built on TypeScript and Bun. Every integration is a plugin; every plugin capability is simultaneously a REST endpoint, an AI tool, and a dashboard component. See README.md for the full vision.

---

## The Core Abstraction: PluginAction

THE most important concept. Every plugin capability is a `PluginAction` — a single definition the framework uses to generate three surfaces simultaneously:

1. **HTTP endpoint** — REST API route, input-validated, included in OpenAPI spec
2. **AI tool** — available to agent personas with a declared autonomy tier
3. **React hook** — for dashboard components, with optional realtime via MQTT topic

```typescript
interface PluginAction<TInput, TOutput> {
  name: string           // snake_case — used as endpoint path segment + AI tool name
  description: string    // shared across all three surfaces

  input: z.ZodSchema<TInput>   // HTTP request validation + AI tool parameters
  output: z.ZodSchema<TOutput> // HTTP response type + AI tool return

  http: { method: 'GET' | 'POST' | 'DELETE' | 'PATCH', path?: string }
  ai: { tier: 'inform' | 'advise' | 'act', description?: string } | false
  ui: { label: string, section: string, icon?: string, realtimeTopic?: string } | false

  execute(input: TInput, context: ActionContext): Promise<TOutput>
}
```

**THE THREE SURFACES RULE**: Every action MUST explicitly declare `http`, `ai`, AND `ui`. Setting one to `false` is a valid opt-out. Leaving it undefined is a bug — the framework will reject it at boot.

---

## Capability System

Capabilities are named groups of required action names. A plugin that declares `capabilities: ['network']` must implement actions named `get_devices` and `get_wan_health`. The framework validates this contract at boot and refuses to start a plugin that doesn't satisfy its declared capabilities.

Capabilities enable the agent runtime to discover which plugins provide which operations without reading every action in the registry.

---

## Plugin Structure

```
packages/plugin-{name}/
  src/
    index.ts          # MaisiePlugin export — required entry point
    actions.ts        # PluginAction definitions via defineAction()
    events.ts         # PluginEvent definitions via defineEvent()
    client.ts         # API client for the external service
    persona.ts        # AgentPersona definition (if this plugin ships a specialist)
    __tests__/
      actions.test.ts # behavioral tests — happy path, bad input, service down
      events.test.ts
  package.json        # must include a "maisie" key declaring capabilities
```

---

## MaisiePlugin Interface

```typescript
interface MaisiePlugin {
  name: string
  version: string
  description: string
  capabilities: CapabilityType[]
  envVars: EnvVarSpec[]
  actions: PluginAction[]
  events: PluginEvent[]
  persona?: AgentPersona
  init(core: MaisieCore): Promise<void>
  shutdown(): Promise<void>
  healthCheck(): Promise<PluginHealth>
  customRoutes?: Hono  // escape hatch for OAuth flows, streaming, webhooks
}
```

`init` receives the `MaisieCore` instance (HTTP server, MQTT client, SQLite db, plugin registry). All setup — registering routes, subscribing to topics, seeding schema — happens here.

---

## Personas

Specialists are `AgentPersona` objects shipped inside plugins. They define who the specialist is, what events wake them, and which tools they can use.

```typescript
interface AgentPersona {
  name: string
  role: string
  avatar?: string
  defaultTier: 'inform' | 'advise' | 'act'
  eventSubscriptions: string[]   // MQTT topic patterns (wildcards ok)
  toolScopes: string[]           // action names this persona can call
  systemPrompt: string
}
```

**Current household:**

| Persona | Domain | Plugin(s) |
|---------|--------|-----------|
| Maisie | Orchestrator, all domains | core |
| Natalie | Network + storage | @maisie/plugin-unifi, @maisie/plugin-synology |
| Channing | TV + streaming | @maisie/plugin-synthetic-hdhr |
| Alexandria | Books + library | @maisie/plugin-calibre |

---

## Tiers

Every AI action declares an autonomy tier. The tier governs whether the agent calls the action freely, surfaces the result for review, or acts and moves on.

| Tier | Behavior |
|------|----------|
| `inform` | Agent calls freely; result logged to memory |
| `advise` | Agent calls; result surfaced to human for approval before any downstream action |
| `act` | Agent calls and acts autonomously; logged but not held for review |

Destructive or irreversible operations must be `advise` unless the user has explicitly elevated them for a specific persona.

---

## Testing Standard

Behavioral tests only. Test what the system does from the outside, not how it does it internally.

- **Every action**: happy path, invalid input (Zod rejection), service unavailable
- **Every event**: correct tier, correct MQTT topic, correct payload shape
- **Plugin structure**: has all required capability actions, all actions have explicit http/ai/ui declarations
- Use `bun test`. Mock at the plugin boundary — inject mock clients into `init`. Never mock internals.

```typescript
// Good — mock at boundary
const plugin = createUnifiPlugin({ client: mockUnifiClient })

// Bad — mock internal fetch
vi.mock('node-fetch')
```

---

## Key Commands

```bash
bun run dev                        # start agent + dashboard in watch mode
bun test                           # run all tests
bun run typecheck                  # tsc --noEmit across all packages
./scripts/deploy-tokyo.sh          # deploy all changed services to production
./scripts/deploy-tokyo.sh maisie   # deploy only the maisie service
./scripts/deploy-tokyo.sh --sync   # rsync only, no rebuild
```

---

## Hard Rules

These are non-negotiable. Each has a reason.

| Rule | Reason |
|------|--------|
| `bun:sqlite` not `better-sqlite3` | Bun native module incompatibility |
| Drizzle ORM for all DB access | Schema safety, migration tracking |
| Never `Promise.all` for UniFi API calls | Causes UDM controller to become unresponsive |
| Synology DSM: HTTPS port 5001 only | HTTP port 5000 hangs indefinitely |
| go2rtc: camera streams only | Crashes on MPEG-TS — only safe for WebRTC/MSE |
| GTX 1050 Ti: max 2 NVENC sessions | Consumer driver limitation; third session fails silently |
| HEVC 10-bit sources: add `-pix_fmt yuv420p` | GTX 1050 Ti can't encode 10-bit via NVENC |
| Extended thinking: `temperature=1` required | Anthropic API requirement; only Sonnet/Opus |

---

## Project Layout

```
packages/
  core/              # chassis: HTTP server, MQTT broker client, SQLite, plugin registry, agent runtime
  shared/            # PluginAction, PluginEvent, capability interfaces, shared types, MQTT topics
  dashboard/         # React + Vite SPA — served as static files by the agent
  plugin-*/          # all integrations as plugins
  synthetic-hdhr/    # HDHomeRun emulator — unified lineup of cable, camera, library channels
  tokyo-streamer/    # GPU-accelerated ffmpeg transcoding service
  ssdp-advertiser/   # SSDP broadcast for Plex discovery of synthetic-hdhr
```

**Channel number ranges** (synthetic-hdhr):
- `1–999` — Cable channels (real HDHomeRun PRIME)
- `20001–29999` — Library channels (Plex content, deterministic schedules)
- `90001–90999` — Camera channels (UniFi Protect)
- `95001+` — Other devices (Bambu at 95001)

---

## Deployment

Production runs on the Maisie host (set `LAN_IP` in `.env`), Ubuntu 24.04, Docker Compose.

```bash
./scripts/deploy-tokyo.sh [service]
```

The script: rsync → restore `go2rtc.tokyo.yaml` (overwritten by rsync) → docker build → docker up → lineup rebuild.

**Notes:**
- The production host has its own `.env` (not synced) with `LAN_IP` set to its LAN IP
- `config/go2rtc.yaml` contains camera RTSP credentials — gitignored. Deploy script restores from `go2rtc.tokyo.yaml` automatically.
- `docker-compose.override.yml` on Tokyo adds GPU passthrough and skips TLS cert volume mounts
- After synthetic-hdhr restarts, lineup rebuild fires automatically

---

## Reference

- `README.md` — vision, principles, getting started
- `docs/architecture.md` — system deep-dive
- `docs/building-a-plugin.md` — plugin authoring guide
- `docs/agent.md` — agent runtime and persona system
