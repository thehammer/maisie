# Maisie Universal Interface — Master Plan

*Last updated: 2026-04-15*

---

## Vision

Maisie is becoming a universal interface layer for the home — and eventually for any domain with multiple heterogeneous subsystems.

The core idea: every integration exposes its capabilities through a single typed definition, and the framework materializes that definition into three surfaces simultaneously — a REST API, a React dashboard, and an AI agent. Write it once, get it three ways. This is already working for a subset of capabilities. The goal of this plan is to take that pattern to its logical conclusion: a complete, strongly-typed, pipeline-composable protocol that covers every integration in the house.

The system is being designed with two constraints that matter for the long term:

1. **The intermediate layers must make zero domain assumptions.** The protocol, resource model, pipeline engine, and component spec should be publishable as open-source packages usable outside the home AI context — for a healthcare portal's subsystems, a factory floor dashboard, or a SaaS product's admin interface.

2. **The framework is a superset of Matter.** It covers smart home devices (lights, thermostats, locks, sensors) but also arbitrary APIs, SSH/shell access, media servers, NAS systems, 3D printers, HDHomeRun tuners, and anything else that exposes a programmatic interface. Matter is a device protocol. Maisie is a capability protocol.

---

## What We Have Today

The codebase is a working Bun monorepo. Phases 1 and 2 are complete — the protocol is specified in `docs/protocol.md` and the universal resource model, semantic type vocabulary, and plugin protocol v0.1 are all implemented. The "skills" architecture that existed before has been superseded; all integrations are now MaisiePlugins. Phase 3 (integration gaps) and Phase 4 (three surface layers) are in progress.

### Running Services (Production — Tokyo, 192.168.1.10)

| Container | Port | Role |
|-----------|------|------|
| maisie | 3001 | Agent + HTTP API + dashboard |
| mosquitto | 1883/9001/9002 | MQTT event bus |
| synthetic-hdhr | 5004 | HDHomeRun emulator (cable + camera + library channels) |
| tokyo-streamer | 5050 | GPU-accelerated HLS/MPEG-TS transcoding |
| go2rtc | 1984 | Camera relay (WebRTC/MSE for dashboard) |
| ssdp | — | SSDP broadcast for Plex discovery |
| audiobookshelf | 13378 | Audiobook library |

### Existing Plugin Packages

```
packages/plugin-bambu/
packages/plugin-calibre/
packages/plugin-core/
packages/plugin-google/
packages/plugin-home-assistant/
packages/plugin-hp-printer/      ← NEW: EWS monitoring, supply levels, discovery
packages/plugin-plex/
packages/plugin-radarr/
packages/plugin-sonarr/
packages/plugin-synology/
packages/plugin-unifi/
packages/ble-gateway/             ← IN PROGRESS: Python BLE daemon (SleepNumber, Govee); not yet a MaisiePlugin
```

### The PluginAction Model (Implemented)

Every plugin capability is a `PluginAction`:

```typescript
interface PluginAction<TInput, TOutput> {
  name: string           // snake_case — endpoint path + AI tool name
  description: string    // shared across all three surfaces
  input: z.ZodType<TInput>
  output: z.ZodType<TOutput>
  http: { method: 'GET' | 'POST' | 'DELETE' | 'PATCH', path?: string }
  ai: { tier: 'inform' | 'advise' | 'act', description?: string } | false
  ui: { label: string, section: string, icon?: string, realtimeTopic?: string } | false
  execute(input: TInput, context: ActionContext): Promise<TOutput>
}
```

The three-surface rule is enforced: `http`, `ai`, and `ui` must each be explicitly declared. `false` is a valid opt-out. Omitting the field is a boot error.

### API Catalog (Complete)

Five reference documents in `docs/api-catalog/` map every external API available to the system:

- `unifi.md` — UniFi Network + Protect + SSH (992 lines)
- `synology.md` — Full DSM API + SSH CLI (1780 lines)
- `home-assistant.md` — REST + WebSocket + entity model
- `media-stack.md` — Plex, Sonarr, Radarr, Prowlarr
- `devices-and-tools.md` — HDHomeRun, Bambu, Calibre, DAKboard, go2rtc, Tokyo

These catalogs are the inputs to Phase 1.

### Dashboard (Substantially Built)

The React SPA in `packages/dashboard/` has working pages for TV, Media, Cameras, Network, NAS, and Personas. The card system is config-driven: `DynamicCard` renders from `CardDescriptor` schemas with semantic field types, a write path (toggle + action renderers), per-card configurator, compound card layout, and a card template library. Layout is persisted to SQLite via `useLayout`. Existing hand-coded cards have been migrated to `DynamicCard` or wrapped with static descriptors.

Library channels (Plex content as HDHR channels with deterministic schedules) are production-ready in `packages/agent/src/skills/media/library-channels.ts`.

Audiobookshelf is integrated as a connected service.

### What's Still Missing

- Incomplete plugin coverage — Phase 3 integration gaps (see below) still largely open
- Agent's generic address-based tools (`resolve_address`, `invoke_address`, `run_pipeline`) not wired
- Full runtime layout editor (drag/drop works; sidebar config editing not complete)
- Component model implementation (spec in `docs/components.md`; zero code)
- Derived component syntax + layout primitive library (part of component model)
- Rich multi-field base entity synthesis (plugin actions today map 1:1 to single-field entities)
- Open-source package extraction (`@universal-interface/*`)
- CLI REPL (dashboard editor covers most REPL needs; CLI is future)
- iOS/Swift renderer (4f)

---

## Design Principles

### One Definition, Three Surfaces

The `PluginAction` pattern must extend to cover everything. There should be no capability that exists only as an HTTP endpoint or only in the agent's tool set. The single definition is the source of truth. The framework derives the rest.

### Typed Protocol, Not Ad Hoc JSON

Every entity in the system has a semantic type. Not just a Zod schema, but a declared type from a shared vocabulary: `bytes`, `percentage`, `status`, `timestamp`, `progress`, `image`, `stream`, `list<T>`, `toggle`, `action`. This vocabulary is what allows a generic UI renderer to pick the right component for a value without being told explicitly. It's also what allows the agent to reason about units, comparisons, and thresholds correctly.

### Address-Based Access

Every addressable data point in the system has a path:

```
{plugin}.{resource-type}.{id}.{field}
unifi.network-device.aa:bb:cc:dd:ee:ff.blocked
synology.volume.volume1.used_percent
home-assistant.sensor.kitchen_temperature.state
```

This addressing scheme is what makes pipeline expressions, entity bindings in UI components, and agent tool calls composable. The address is the stable reference; plugins declare what addresses they publish.

### PowerShell-Style Pipeline

Complex queries are expressed as composable operators on typed streams, not as hand-coded queries in each plugin:

```
unifi.network-device.list | filter: { blocked: false } | sort: lastSeen desc | limit: 10
```

The pipeline is a first-class abstraction — available in the REST API via query params, in the agent as a composition tool, and in the REPL as interactive syntax.

### Domain-Agnostic Core

The protocol, resource model, pipeline engine, and component spec contain no references to home automation, network devices, cameras, or media. They are generic. Maisie-specific knowledge lives only in plugins. This is the open-source seam described in detail below.

### Safety by Tier

Every agent-callable action declares an autonomy tier:

| Tier | Agent behavior |
|------|---------------|
| `inform` | Call freely; log result to memory |
| `advise` | Call; surface result for human approval before downstream action |
| `act` | Call and act autonomously; logged but not held for review |

Destructive or irreversible operations must be `advise`. The safety tier is enforced by the agent runtime, not by convention.

---

## Vocabulary

These terms are used consistently throughout this document and the codebase:

| Term | Definition |
|------|-----------|
| **Plugin** | A Maisie integration (unifi, synology, home-assistant, plex, etc.) |
| **Action** | A single capability exposed by a plugin — one definition, three surfaces |
| **Entity** | The fundamental unit of the system (base or derived) — a named record of data fields and function fields with typed interfaces. See `docs/model.md`. |
| **Derived Entity** | A user-authored entity whose fields are MEL expressions composing over other entities |
| **MEL** | Maisie Expression Language — the surface syntax for defining derived entities. See `docs/grammar.md`. |
| **Capability** | A named group of required actions that a plugin contracts to implement |
| **Card** | A tile/panel on the dashboard grid; binds an entity to a component |
| **Page** | A full-screen view (Media, TV, Cameras...) |
| **Modal** | An overlay dialog |
| **Section** | A labeled group within a card or page |
| **Row / Column** | Layout containers |
| **Component** | A typed, first-class renderer. Base components are primitives (text, image, badge); layout primitives structure composition (stack, overlay, scroll); derived components are user-authored compositions. See `docs/components.md`. |
| **Derived Component** | A user-authored component with a structural input contract and a render tree composing other components |
| **Pipeline** | A composable chain of operators applied to a typed stream of entities |
| **Address** | The dotted path that identifies any entity, field, function, or component in the catalog |
| **Catalog** | The homogeneous registry of all entities and components — browsable, filterable, itself queryable as an entity |

---

## Phase Overview

```
Phase 0: API Catalog          [COMPLETE]
Phase 1: Taxonomy & Protocol  [COMPLETE — docs/protocol.md, April 2026]
Phase 2: Core Framework       [COMPLETE — resource model, semantic types, plugin protocol v0.1]
Phase 3: Integration Gaps     [IN PROGRESS — webhooks done; UniFi/HA/Bambu gaps remain]
Phase 4: Three Surface Layers [IN PROGRESS]
  4a: API surface              [COMPLETE — plugin action router + entity address resolver (2026-04-22)]
  4b: Agent surface            [partial — tool registry wired; generic address tools not built]
  4c: REPL                     [COMPLETE — MEL editor with autocomplete + inline errors (2026-04-22)]
  4d: UX component spec        [partial — DynamicCard + CardDescriptor implemented; full JSON spec not extracted]
  4e: React implementation     [COMPLETE — DynamicCard, write path, card configurator, CardWizard with entity/function field support (2026-04-22)]
  4f: iOS/Swift (future)       [NOT STARTED]
```

**Component model (specified 2026-04-23, implementation pending)** — see `docs/components.md`. Parallel to the entity model for presentation. Key ideas:
- Base components (text, image, badge, toggle, button, gauge, ...) + layout primitives (stack, row, grid, overlay, scroll, card)
- Derived components are user-authored compositions with a structural input contract and a render tree
- Components are first-class values — can be named, stored in the catalog, passed as props, computed from expressions
- Generic containers via component-typed props (one `Strip` handles movies, books, photos, anything)
- Structural validation at authoring and render time with pointed error messages
- Defaults and a `DefaultTile` fallback renderer that auto-renders from record fields
- Shares the type vocabulary, address scheme, and reactivity with the entity model

**Entity model (added 2026-04-22)** — see `docs/model.md`, `docs/grammar.md`, `docs/implementation-plan.md`. 7 phases shipped, 693 tests. Key capabilities:
- Entities as the unified unit (base + derived share the same shape)
- MEL (Maisie Expression Language) — formal grammar, parser, pretty-printer
- Async expression evaluator with address resolution
- Derived entities persisted to SQLite, registered alongside plugin actions
- `self` references with cycle detection; safety tier inference
- Catalog is itself an entity: `catalog.items | filter: section == "system"`
- MQTT-driven invalidation propagates base entity changes to derived entities
- Dashboard entity editor at `/entities` route with CodeMirror + MEL syntax highlighting

---

## Phase 0: API Catalog

**Status: Complete.**

The five catalog documents in `docs/api-catalog/` map every external API available to the system. Each document describes the full API surface of its system — endpoints, parameters, response shapes, authentication, rate limits, and observed quirks.

These catalogs are the raw inputs to Phase 1. They answer the question: what are we actually capable of, and what is the full shape of the data we're working with?

---

## Phase 1: Taxonomy and Protocol Design

**Status: Complete.** `docs/protocol.md` written April 2026 (314 lines). Covers resource model, semantic type vocabulary, capability model, verb conventions, pipeline operator set, and safety tiers.

**Goal:** Derive a universal resource model from the catalog. Produce a protocol specification that the Phase 2 implementation can be built against.

**Input:** The five API catalog documents.

**Output:** `docs/protocol.md` — a complete specification of the resource model, semantic type vocabulary, capability model, verb conventions, pipeline operator set, safety tiers, and open-source package boundaries.

### Resource Model

Every thing exposed by a plugin is a Resource. Resources have a type, an identifier, and a set of entities (fields + commands).

```
Resource address: {plugin}.{resource-type}.{id}
Entity address:   {plugin}.{resource-type}.{id}.{field}

Examples:
  unifi.network-device.aa:bb:cc:dd:ee:ff
  unifi.network-device.aa:bb:cc:dd:ee:ff.blocked
  synology.volume.volume1
  synology.volume.volume1.used_percent
  home-assistant.sensor.kitchen_temperature.state
  plex.media-item.12345.title
```

Plugins declare their resource types and entity addresses in their manifest. The resource registry validates these declarations at boot and makes them available to the pipeline engine, agent, and UI renderer.

Key design decisions to resolve in `docs/protocol.md`:

- **Identity conventions**: how IDs are scoped (plugin-local vs. globally unique)
- **Mutable vs. observable entities**: fields that can be written vs. fields that can only be read or subscribed to
- **Resource relationships**: how a `network-device` relates to the `access-point` it's connected to
- **Resource lifecycle**: how resources come and go (a device appearing on the network, a Plex item being added to a library)

### Semantic Type Vocabulary

The protocol defines a type vocabulary layered on top of Zod primitives. These types carry semantics the framework can act on:

| Type | Base | Meaning |
|------|------|---------|
| `bytes` | `number` | Storage or transfer size in bytes; renders with unit suffix |
| `percentage` | `number` | 0–100; renders as progress bar or gauge |
| `status` | `string` | Enum of named states; renders as colored badge |
| `image` | `string` | URL; renders as `<img>` or thumbnail |
| `timestamp` | `string` | ISO 8601; renders as relative time |
| `progress` | `object` | `{ current, total, unit }`; renders as progress |
| `list<T>` | `array` | Typed list; renders as table or card list |
| `action` | `void` | A triggerable command; renders as button |
| `toggle` | `boolean` | Binary state with write capability; renders as toggle switch |
| `stream` | `string` | URL to a media stream; renders inline or launches player |
| `duration` | `number` | Seconds; renders as `HH:MM:SS` |
| `temperature` | `number` | Celsius; renders with unit, colorizes by threshold |
| `signal` | `number` | dBm; renders as signal-strength indicator |

The vocabulary must be finite and stable — new types require explicit additions to the spec. This is what keeps the renderer generic.

### Capability Model

The six fundamental operations a resource entity can support:

| Capability | Meaning |
|-----------|---------|
| `read` | Fetch current value on demand |
| `write` | Set a new value |
| `stream` | Receive a media stream |
| `event` | Receive push notifications on change |
| `subscribe` | Maintain a live subscription to current value |
| `execute` | Trigger a command with optional parameters |

Plugins declare which capabilities each entity supports. The framework validates that declared capabilities are backed by implementations at boot.

### Verb Conventions

Action names follow a strict vocabulary:

| Prefix | Meaning | Example |
|--------|---------|---------|
| `list_` | Return a collection | `list_devices` |
| `get_` | Return a single resource or entity | `get_device` |
| `set_` | Write a value | `set_device_blocked` |
| `create_` | Create a new resource | `create_vlan` |
| `delete_` | Remove a resource | `delete_device` |
| `invoke_` | Trigger an action with side effects | `invoke_speedtest` |
| `stream_` | Return a stream handle | `stream_camera` |
| `subscribe_` | Subscribe to live updates | `subscribe_device_presence` |

These conventions are enforced at plugin load. An action named outside this vocabulary fails the boot check.

### Pipeline Operator Spec

Pipeline expressions compose operators on typed entity streams. The full operator set:

**Filtering and shaping:**
- `filter: { field: value }` — keep entities matching predicate
- `select: [field, ...]` — project to subset of fields
- `sort: field [asc|desc]` — order by field
- `limit: N` — take first N
- `group_by: field` — group into buckets

**Aggregation:**
- `count` — count entities in stream
- `sum: field` — sum numeric field
- `avg: field` — average numeric field
- `min: field` / `max: field` — extremes

**Composition:**
- `parallel: [expr, ...]` — run multiple streams concurrently, merge results
- `sequence: [expr, ...]` — run operations in order, pass result forward
- `join: expr on field` — join two streams on a field

**Reliability:**
- `retry: N [delay: ms]` — retry on failure
- `cache: ttl_ms` — cache result for duration
- `timeout: ms` — fail after duration

Pipeline expressions are a string syntax parseable on both server and client. The server-side engine executes them. The client-side parser validates and autocompletes them in the REPL.

### `ui` Field Redesign

The current `ui` field on `PluginAction` is:

```typescript
ui: { label: string, section: string, icon?: string, realtimeTopic?: string } | false
```

This needs to become:

```typescript
ui: {
  type: 'data' | 'action' | 'both'
  label: string
  section: string
  icon?: string
  realtimeTopic?: string
  componentHint?: ComponentType  // suggest specific renderer
} | false
```

`false` should only be used for actions that are genuinely unexposable in a UI — binary stream proxies, internal auth helpers, webhook receivers. Currently too many actions set `ui: false` out of convenience. The protocol spec should establish a clear policy: if the data or action is meaningful to a human operator, it gets a UI declaration.

### Open-Source Seam

Define the exact package boundary between domain-agnostic (publishable) and Maisie-specific (stays in this repo).

**Publishable (zero domain assumptions):**

```
@universal-interface/protocol     — resource model, semantic type vocabulary, capability model
@universal-interface/pipeline     — pipeline parser, execution engine, operator implementations
@universal-interface/components   — component spec (JSON schema), type-to-component mapping
@universal-interface/plugin-sdk   — PluginAction, PluginEvent, defineAction(), defineEvent()
@universal-interface/agent-core   — agent runtime, tool registry, safety tier enforcement
```

**Maisie-specific (stays here):**

```
packages/plugin-unifi/
packages/plugin-synology/
packages/plugin-home-assistant/
packages/plugin-plex/
packages/plugin-*         (all integrations)
packages/dashboard/       (React app, Maisie-specific layout and branding)
packages/agent/           (Maisie personas, nightly routines, household memory)
```

The domain-agnostic packages know nothing about home automation, network devices, cameras, or media. They define how to describe capabilities, how to compose them, and how to render them. The plugins and personas are where Maisie's personality lives.

---

## Phase 2: Core Framework Implementation

**Status: Complete.** Universal resource model implemented, semantic type vocabulary in `packages/shared/`, all plugins migrated to protocol v0.1 conventions. The `packages/plugin-core/` registry validates capabilities at boot. Pipeline engine is specified but not yet implemented (see Phase 4).

**Goal:** Build the runtime infrastructure that the Phase 1 protocol specifies. This is the chassis all future plugins and surface layers depend on.

**Input:** `docs/protocol.md`

**Output:** Extended `packages/shared/`, new `packages/protocol/`, extended `packages/plugin-core/`

### Resource Registry

Plugins declare resources and their entity addresses at boot. The registry:
- Validates address format and entity declarations
- Resolves address expressions to live values via the action registry
- Tracks resource lifecycle (create/destroy events)
- Exposes a query interface for the pipeline engine

### Semantic Type Annotations

Extend `PluginAction` to support semantic type annotations on Zod schemas. This is additive — existing schemas continue to work; new code annotates its fields with the type vocabulary.

```typescript
// Today
output: z.object({
  usedBytes: z.number(),
  totalBytes: z.number()
})

// With semantic annotations
output: z.object({
  usedBytes: z.number().semantic('bytes'),
  totalBytes: z.number().semantic('bytes')
})
```

The annotation is a Zod refinement or metadata attachment — exact mechanism TBD in Phase 1, specified in `docs/protocol.md`.

### Pipeline Execution Engine

Server-side pipeline engine:
- Parses pipeline expressions from string syntax
- Validates operator chain against resource registry (type checking)
- Executes operators against live data from the action registry
- Streams results via SSE for long-running pipelines

Client-side:
- Same parser (shared package)
- Can execute read-only pipelines against cached data locally
- Sends pipeline expressions to server for execution against live data

### Address Resolver

The address resolver maps entity addresses to live values:

```
unifi.network-device.aa:bb:cc:dd:ee:ff.blocked
→ calls plugin-unifi's get_device action with id=aa:bb:cc:dd:ee:ff
→ returns device.blocked field
```

Write operations:
```
SET unifi.network-device.aa:bb:cc:dd:ee:ff.blocked = true
→ calls plugin-unifi's set_device_blocked action
```

The resolver handles caching, error propagation, and type coercion.

### Typed Event Bus

The MQTT event bus becomes typed. Events carry:
- Source address (which resource entity emitted this)
- Semantic type of the value
- The value itself, typed
- Timestamp

Subscribers can filter by address pattern (wildcards, prefix match). The agent's event routing uses this to wake personas on relevant events.

### Package Structure

```
packages/
  protocol/          # resource model, semantic types, address parser
  pipeline/          # pipeline parser and execution engine
  plugin-core/       # extended plugin SDK (existing package, extended)
  shared/            # existing shared types, extended with protocol types
```

---

## Phase 3: Fill Integration Gaps

**Status: In Progress.** Webhook receivers for Plex/Sonarr/Radarr done; RTSP URLs for UniFi Protect done. Most API-surface gaps remain open.

**Goal:** Use the catalog gap analyses to extend existing plugins to cover their full API surface. Run this in parallel with Phase 2.

**Input:** The five API catalog documents, each of which includes a gap analysis section.

**Output:** Complete plugin coverage for all meaningful API surfaces.

### UniFi (plugin-unifi)

| Gap | Status | Work |
|-----|--------|------|
| WebSocket listener | ❌ | Real-time client presence events — eliminate polling |
| WLAN toggle | ❌ | Enable/disable SSIDs by name or ID |
| Protect WebSocket | ❌ | Real-time motion/doorbell/smart detect events |
| RTSP URLs | ✅ done | Per-channel RTSP addresses from Protect |
| Device control | ❌ | Port override, PoE control, locate |
| Client statistics | ❌ | TX/RX rates, signal history per client |

Note: UniFi API calls must never use `Promise.all` — the UDM controller becomes unresponsive under parallel requests. All calls remain sequential.

### Synology (plugin-synology)

| Gap | Status | Work |
|-----|--------|------|
| Docker management | ❌ | Container list, start/stop, logs |
| Fan and temperature | ❌ | Thermal monitoring via DSM API |
| File operations | ❌ | Browse, upload, download, delete |
| Backup status | ❌ | Hyper Backup job status |
| SNMP polling | ❌ | Bandwidth counters per interface |
| Scheduled task status | ❌ | Task list, last run result |

Note: Always use HTTPS port 5001. HTTP port 5000 hangs indefinitely.

### Home Assistant (plugin-home-assistant)

| Gap | Status | Work |
|-----|--------|------|
| Climate | ❌ | Thermostat get/set, current temp, mode |
| Sensors | ❌ | All sensor domains: temperature, humidity, motion, door |
| Locks | ❌ | Lock/unlock, status |
| Covers | ❌ | Garage doors, blinds — open/close/position |
| Presence | ❌ | Person entities, zone tracking |
| Generic service call | ✅ done | `invoke_service` action — passthrough for any HA service |
| WebSocket push | ❌ | Subscribe to state changes via WS |
| media_player | ❌ | Play/pause/volume for HA-controlled players |

### Plex (plugin-plex)

| Gap | Status | Work |
|-----|--------|------|
| Watch history | ❌ | Per-user history, timestamps |
| On Deck | ❌ | In-progress content by user |
| Webhook receiver | ✅ done | Inbound play/stop/scrobble events wired to MQTT |
| Remote control | ❌ | Play, pause, seek, stop on a specific player |
| Collection management | ❌ | List, create, edit collections |
| Playlist operations | ❌ | Create, edit playlists |

### Sonarr / Radarr

| Gap | Status | Work |
|-----|--------|------|
| Wanted/Missing | ❌ | Episodes or movies not yet available |
| Command execution | ❌ | Queue downloads, refresh series/movies |
| Webhook receivers | ✅ done | Inbound grab/import/rename events wired to MQTT |
| Queue management | ❌ | View and clear the download queue |
| Calendar | ❌ | Upcoming expected releases |

### Bambu (plugin-bambu)

| Gap | Status | Work |
|-----|--------|------|
| AMS tray details | ❌ | Filament type, color, remaining % per tray |
| HMS alerts | ❌ | Hardware/maintenance alert codes |
| Camera stream | ❌ | RTSP from printer camera (via go2rtc) |
| Fan speeds | ❌ | Cooling fan status |
| Print history | ❌ | Completed job log |

### New Plugins

**HP Printer** — ✅ done (`packages/plugin-hp-printer/`):
- EWS monitoring (supply levels, status)
- Network discovery
- Wired into Plugins UI

**Audiobookshelf** — ✅ done:
- Integrated as a connected service (audiobook library)

**BLE Gateway** — 🚧 in progress (`packages/ble-gateway/`):
- Python daemon (`gateway.py`) bridges BLE devices to MQTT
- Handles SleepNumber, Govee, and generic BLE protocols
- Not yet a MaisiePlugin — TypeScript plugin wrapper needed

**Transmission** — ❌ not started, already connected in the house:
- Torrent list with status, progress, speed
- Add/remove/start/stop torrent
- Free space on download dir

**Readarr** — ❌ not started, already connected:
- Book library, wanted list, search
- Download queue
- Author management

---

## Phase 4: Three Surface Layers

**Status: In Progress.** The card/UI layer (4e) is well along. API and agent surfaces are partially wired. REPL not started.

**Completed:**
- `DynamicCard` renders from `CardDescriptor` schemas with semantic field types
- Write path: toggle and action renderers POST mutations, optimistic updates
- Per-card configurator sidebar
- Card template library (save/browse/apply)
- Compound card layout (sections, multi-row)
- Schema-level type inference (scalar → renderer type)
- Maisie function library (ops, renderers, pipeline expressions)
- Dashboard layout persisted to SQLite; `useLayout` hook
- All existing hand-coded cards wrapped or migrated to `DynamicCard`

**Still needed:**
- Pipeline execution engine (specified, not built)
- `EntityStateStore` for entity-address-driven subscriptions
- Address resolver (`GET /api/address/{plugin}/{type}/{id}/{field}`)
- REPL panel (dashboard + CLI)
- Full runtime layout editor (drag/drop exists; sidebar config not complete)
- Auto-generated OpenAPI spec from registry

Phase 4 delivers the three complete surfaces — API, Agent, and UI — built on the protocol and framework from Phases 1–2.

### 4a: API Surface

**Goal:** A complete, auto-generated REST catalog derived from the resource registry.

- All resource `list_` and `get_` actions available at deterministic URLs
- Pipeline expressions accepted as query parameters: `?pipeline=filter:blocked|sort:lastSeen+desc|limit:10`
- `GET /api/address/{plugin}/{resource-type}/{id}/{field}` — resolve any entity address to its current value
- `PUT /api/address/{plugin}/{resource-type}/{id}/{field}` — write to writable entities
- OpenAPI spec auto-generated from the registry at boot
- GraphQL-style field selection: `?select=name,ip,status`

The API surface should require zero hand-written route definitions once a plugin has declared its resource model.

### 4b: Agent Surface

**Goal:** Agent tools built from the protocol, not hand-written per plugin.

The current agent tool set is hand-wired to individual action names. The protocol-based approach generates the tool set from the registry:

- `list_resources(plugin, resource_type)` — discover what's available
- `get_entity(address)` — resolve any entity address
- `set_entity(address, value)` — write to any writable entity
- `execute_action(plugin, action, params)` — call any action by name
- `run_pipeline(expression)` — execute a pipeline expression, return results
- `subscribe_events(address_pattern)` — receive push events matching a pattern

Safety tier enforcement: the agent runtime checks the declared tier before executing. `advise` tier actions surface their proposed call and result to the human before proceeding.

### 4c: REPL

An interactive shell available in two forms:
- In-dashboard panel (embedded in a Page or Modal)
- CLI via `packages/cli/`

Features:
- Pipeline syntax with tab completion from the live resource registry
- Results rendered using the semantic type vocabulary (not raw JSON)
- History with search
- Named query saving
- Output can be piped to an action: `unifi.network-device.list | filter:{status:suspicious} | invoke set_blocked`

The REPL is the power-user surface. It exposes the full pipeline language without requiring code.

### 4d: UX Component Spec (Client-Agnostic)

**Goal:** A JSON schema that fully describes any dashboard page, card, or component without referencing any UI framework.

This spec is published as `@universal-interface/components`. It contains no React, no HTML — just types.

**Component hierarchy:**

```
Page
  Section+
    Row | Column
      Component+
```

**Component types:**

| Type | Description |
|------|-------------|
| `value` | A single typed value with label |
| `label` | Static text |
| `badge` | Colored status indicator |
| `status-dot` | Small presence indicator |
| `image` | Image with optional caption |
| `camera-feed` | Live video from a stream entity |
| `chart` | Time series or bar chart |
| `progress-bar` | Percentage or progress entity |
| `button` | Triggers an action entity |
| `toggle` | Reads and writes a toggle entity |
| `slider` | Reads and writes a numeric entity within a range |
| `select` | Reads and writes an enum entity |
| `entity-card` | Composite: a resource's primary fields in a card layout |
| `entity-list` | Composite: a list of resources as a table or card grid |
| `media-player` | Composite: play/pause/seek controls bound to a media entity |

**Entity bindings:**

Components reference data by entity address. The renderer resolves the address to a live value and re-renders on change.

```json
{
  "type": "value",
  "label": "Volume 1 Used",
  "bind": "synology.volume.volume1.used_percent"
}
```

```json
{
  "type": "toggle",
  "label": "Block Device",
  "bind": "unifi.network-device.aa:bb:cc:dd:ee:ff.blocked"
}
```

**Page config schema example:**

```json
{
  "id": "network",
  "title": "Network",
  "sections": [
    {
      "label": "WAN Health",
      "layout": "row",
      "components": [
        { "type": "value", "label": "Download", "bind": "unifi.wan.primary.download_mbps" },
        { "type": "value", "label": "Upload", "bind": "unifi.wan.primary.upload_mbps" },
        { "type": "status-dot", "label": "Status", "bind": "unifi.wan.primary.status" }
      ]
    },
    {
      "label": "Active Clients",
      "layout": "column",
      "components": [
        {
          "type": "entity-list",
          "resource": "unifi.network-device",
          "pipeline": "filter:{blocked:false}|sort:lastSeen desc|limit:20",
          "columns": ["name", "ip", "lastSeen", "signal"]
        }
      ]
    }
  ]
}
```

The spec must be complete enough that a React renderer, a Swift renderer, and a terminal renderer can all implement it independently.

### 4e: React Implementation

**Goal:** React components that implement the client-agnostic spec from 4d, integrated into the existing dashboard.

**ComponentRenderer:** A top-level React component that takes a component config object and renders the appropriate React element. Type dispatch is pure and testable:

```typescript
function ComponentRenderer({ config }: { config: ComponentConfig }) {
  switch (config.type) {
    case 'value':       return <ValueComponent {...config} />
    case 'toggle':      return <ToggleComponent {...config} />
    case 'entity-list': return <EntityListComponent {...config} />
    // ...
  }
}
```

**EntityStateStore:** A Zustand store (or equivalent) that:
- Holds live values keyed by entity address
- Subscribes to SSE/WebSocket push from the server
- Invalidates cache on relevant MQTT events
- Components subscribe to specific addresses — only re-render on their data

**Migration path:** The existing hand-coded React pages are not thrown away. A hybrid render strategy:
1. Config-driven rendering is the new default for new cards and pages
2. Existing pages continue to work as-is (legacy React components)
3. As existing pages are rebuilt, they migrate to config-driven rendering
4. Eventually, pages are stored in the database and editable at runtime

**Layout editor:** The `DraggableDashboardGrid` and `WidgetSlot` work already started gets extended to:
- Drag to reorder cards
- Add/remove cards from a palette
- Edit card configuration in a sidebar modal
- Persist layout to SQLite

### 4f: iOS/Swift (Future Appendix)

The client-agnostic component spec from 4d makes a native iOS implementation straightforward. The Swift app would:
- Fetch page configs from the Maisie API
- Render SwiftUI components using the same type dispatch pattern as React
- Subscribe to entity address updates via WebSocket
- Use the same pipeline expressions for data binding

This phase is not scheduled. It depends on 4d being complete and stable. The spec from 4d should be validated against a prospective Swift implementation to catch any React-specific assumptions before they calcify.

---

## Appendix A: Open Source Package Plan

The domain-agnostic packages identified in Phase 1 will be extracted and published under the `@universal-interface` namespace. This name reflects the purpose: a framework for building multi-surface interfaces over heterogeneous subsystems, regardless of domain.

**Extraction sequence:**

1. `@universal-interface/plugin-sdk` — first, since it's needed by all plugins; extract from current `packages/shared/`
2. `@universal-interface/protocol` — after Phase 1 is complete and the spec is stable
3. `@universal-interface/pipeline` — after Phase 2 implementation is working in Maisie
4. `@universal-interface/components` — after Phase 4d is complete and the spec is validated against React
5. `@universal-interface/agent-core` — last; requires the protocol and pipeline to be stable

**Publication criteria for each package:**
- Zero references to `maisie`, home automation, or any specific integration
- Test suite covering the package contract in isolation
- README explaining the use case and giving a non-home-automation example
- Semantic versioning starting at `0.x` — no stability promise until the Maisie implementation has been running in production for six months

**Governance:**
- MIT license
- Issues and PRs accepted from the community
- Maisie remains the reference implementation — breaking changes to published packages require migration paths

---

## Appendix B: Carefeed Implementation Plan

The Carefeed healthcare portal has subsystems analogous to Maisie's home integrations: a bed board, referrals, communications, scheduling, and billing. Each is a separate API. The same framework applies: one plugin per subsystem, one protocol, three surfaces.

**Proposed plugins:**
- `plugin-bed-board` — census, admissions, discharges, room assignments
- `plugin-referrals` — inbound referral pipeline, status, documents
- `plugin-communications` — message threads, notifications, fax routing
- `plugin-scheduling` — visit schedule, staff assignments, calendar

**What changes:**
- Personas (the AI specialists) have healthcare domain knowledge instead of home automation domain knowledge
- Safety tiers are stricter — patient data mutations are always `advise`, never `act`
- The dashboard layout reflects clinical workflows, not home status
- Authentication and audit logging meet healthcare compliance requirements

**What stays identical:**
- `PluginAction` definition
- Resource model and entity addressing
- Pipeline engine
- Component spec and renderer
- Agent runtime

The framework is already designed for this. The Carefeed implementation plan is a separate document that will be written once the `@universal-interface` packages are extracted and published.

---

## Implementation Order

For a single developer working through this sequentially:

1. **Write `docs/protocol.md`** — this is the prerequisite for everything else in Phase 2+. Spend real time here. Bad decisions in the protocol are expensive to fix later.

2. **Implement semantic type annotations** — additive change to existing `PluginAction`, no regressions. Validate by annotating the UniFi plugin's output types.

3. **Build the resource registry** — plugins declare resources at boot; registry validates and indexes them. Start with UniFi and Synology as test cases.

4. **Build the address resolver** — connect the registry to live data. Test with a simple entity read from the dashboard REPL.

5. **Build the pipeline engine** — start with `filter`, `sort`, `limit`. Add operators incrementally. Each operator is a small pure function.

6. **Fill the top integration gaps** (Phase 3) — UniFi WebSocket and Home Assistant WebSocket push are the highest-value items; they eliminate the polling that currently keeps the agent busy.

7. **Build the component spec** — JSON schema for page/card/component configs. Validate by converting the existing Network page to config-driven rendering.

8. **Build the React renderer** — `ComponentRenderer` + `EntityStateStore`. Migrate one page at a time.

9. **Build the API surface** — auto-generated routes from the registry. OpenAPI spec.

10. **Build the REPL** — last, because it depends on all of the above. Start with the dashboard panel; CLI can follow.

---

## Key Risks

**Protocol design scope creep.** Phase 1 could expand indefinitely. Time-box it. The protocol document should be a working draft that ships to implementation even if some decisions are marked provisional.

**Migration complexity.** The existing hand-coded skills architecture and the plugin model coexist in production. The migration path must be incremental — individual plugins move over, the skills code stays until replaced.

**Over-engineering the pipeline.** The pipeline is powerful, but most dashboard use cases are simple reads and lists. Don't let the pipeline engine become a query language project. Implement what the actual use cases require.

**`advise` tier UX.** The agent safety model only works if the human actually sees and acts on `advise` tier proposals. The dashboard needs a clear, non-annoying UI for agent proposals before `advise` is useful. Design this before shipping autonomous agent features.

**GPU constraint.** The GTX 1050 Ti supports max 2 NVENC sessions. As library channels grow, this becomes a scheduling problem. Note in the streaming layer that session allocation must be tracked and requests must fail gracefully at session 3, not silently.
