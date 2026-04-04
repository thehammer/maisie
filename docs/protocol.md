# Maisie Protocol — Universal Resource Model v0.1

> **Status:** Working draft. Decisions marked `[provisional]` are open to revision
> after initial implementation. Everything else is locked for Phase 2.

---

## Purpose

This document specifies the universal resource model that Maisie uses to describe
every capability exposed by every plugin. It is the source of truth for Phase 2
implementation.

The model has one core rule:

> **One definition. Three surfaces.**  
> Every plugin capability is defined once as a `PluginAction`. The framework
> derives the HTTP endpoint, AI tool, and dashboard component from that single
> definition. Nothing is hand-wired.

---

## Resource Model

A **Resource** is any addressable thing a plugin knows about — a network device,
a storage volume, a media item, a sensor, a camera, a print job.

### Address Scheme

Every resource instance has a globally unique address:

```
{plugin}.{resource-type}.{id}
```

Every field or command on a resource has an entity address:

```
{plugin}.{resource-type}.{id}.{field}
```

**Examples:**

```
unifi.network-device.aa:bb:cc:dd:ee:ff
unifi.network-device.aa:bb:cc:dd:ee:ff.blocked
synology.volume.volume1.used_percent
home-assistant.sensor.kitchen_temperature.state
plex.media-item.12345.title
calibre.book.4421.tags
bambu.print-job.current.progress
```

**Rules:**
- Plugin names use `kebab-case`, matching the plugin package name
- Resource type names use `kebab-case` (plural in list contexts, singular in get contexts)
- IDs are plugin-local. The framework scopes them globally by prepending `{plugin}.{type}.`
- IDs must be stable — MAC addresses, volume names, entity IDs, Plex rating keys.
  Avoid positional indices. `[provisional: whether to require a `stable_id` declaration]`

### Identity

Plugins declare resource types in their manifest. Each resource type declaration
includes which field is the stable ID:

```typescript
interface ResourceTypeDecl {
  type: string                 // "network-device"
  idField: string              // "mac" — which output field is the stable ID
  label: string                // "Network Device"
  labelField?: string          // "hostname" — human-readable name field
}
```

`[provisional: exact manifest schema — resolved in Phase 2 plugin-sdk work]`

---

## Semantic Field Types

Fields carry semantic types that let the framework render and reason about values
without plugin-specific knowledge.

| Type | Base | Meaning | Default Render |
|------|------|---------|----------------|
| `string` | string | Plain text | `<span>` |
| `number` | number | Generic number | formatted integer |
| `boolean` | boolean | True/false | ✓ / ✗ |
| `bytes` | number | Size in bytes | `1.2 GB`, `340 MB` |
| `percentage` | number | 0–100 | progress bar |
| `status` | string | Named state | colored badge |
| `image` | string | URL to image | `<img>` thumbnail |
| `timestamp` | string | ISO 8601 date | relative: "2h ago" |
| `duration` | number | Seconds | `2h 34m` |
| `progress` | object | `{ current, total, label? }` | progress bar + fraction |
| `temperature` | number | Celsius | `72°C` with threshold color |
| `signal` | number | dBm | signal bars indicator |
| `toggle` | boolean | Binary writable state | toggle switch |
| `action` | void | Triggerable command | button |
| `stream` | string | URL to media stream | player / channel tile |
| `list<T>` | array | Typed collection | table or card list |
| `url` | string | Clickable link | `<a>` |
| `json` | object | Untyped structured data | collapsed JSON viewer |

**Status values** use a shared vocabulary. Plugins must map their state strings to one of:

| Value | Color | Meaning |
|-------|-------|---------|
| `ok` | green | Healthy, connected, running |
| `warning` | yellow | Degraded, near limit, attention needed |
| `error` | red | Failed, disconnected, offline |
| `idle` | gray | Online but inactive |
| `busy` | blue | Active, in progress |
| `unknown` | gray | State not determinable |

Custom status values are allowed but won't get color treatment from the generic renderer.

### Type Annotation in Zod

Field types are declared as Zod metadata attached to schema fields:

```typescript
import { z } from 'zod'
import { field } from '@maisie/shared'  // or packages/shared — same thing for now

const VolumeSchema = z.object({
  id:          z.string(),
  name:        z.string(),
  usedBytes:   field(z.number(), 'bytes'),
  usedPercent: field(z.number(), 'percentage'),
  status:      field(z.string(), 'status'),
  totalBytes:  field(z.number(), 'bytes'),
})
```

`field(schema, type)` attaches `._def.maisieType = type` to the Zod schema.
The framework reads this at action registration time to build the field catalog.

`[provisional: exact Zod metadata mechanism — could use `.brand()`, `.describe()`,
or a wrapper. Resolve in Phase 2 shared package work.]`

---

## PluginAction — The Three-Surface Definition

Every capability is a `PluginAction`. This is the complete type:

```typescript
interface PluginAction<TInput = unknown, TOutput = unknown> {
  // Identity
  name: string              // snake_case verb — used as endpoint + AI tool name
  description: string       // shared across all three surfaces

  // Schema
  input:  z.ZodSchema<TInput>    // HTTP request body + AI tool parameters
  output: z.ZodSchema<TOutput>   // HTTP response + AI tool return

  // Surface declarations (all three are required — no undefined)
  http: HttpSurface
  ai:   AiSurface | false
  ui:   UiSurface | false

  // Implementation
  execute(input: TInput, context: ActionContext): Promise<TOutput>
}
```

### `false` Policy

`false` on a surface is an explicit opt-out. It should be used sparingly:

- `ai: false` — the action has no meaningful agent use (e.g., raw binary proxy, OAuth redirect)
- `ui: false` — the action has no meaningful dashboard use (e.g., internal webhook receiver, raw stream bytes)

**If the data or action is meaningful to a human operator, it gets a UI declaration.**
Setting `ui: false` out of convenience is a code smell — it means the three-surface
contract is being avoided, not respected.

### HTTP Surface

```typescript
interface HttpSurface {
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH'
  path?: string    // override default path; default is derived from action name
}
```

Default path derivation from `name`:

| Action name | Default path |
|-------------|-------------|
| `list_devices` | `GET /devices` |
| `get_device` | `GET /devices/:id` |
| `set_device_blocked` | `PATCH /devices/:id/blocked` |
| `invoke_speedtest` | `POST /speedtest` |
| `delete_device` | `DELETE /devices/:id` |

`[provisional: exact path derivation rules — resolve in Phase 2 HTTP routing work]`

### AI Surface

```typescript
interface AiSurface {
  tier: 'inform' | 'advise' | 'act'
  description?: string    // override action description for AI context
}
```

| Tier | Agent behavior |
|------|---------------|
| `inform` | Call freely; log result to memory |
| `advise` | Call; surface result for human review before downstream actions |
| `act` | Call autonomously; logged but not held for review |

Destructive or irreversible operations must be `advise` unless the user has elevated
them for a specific persona. The agent runtime enforces this.

### UI Surface

```typescript
interface UiSurface {
  type: 'data' | 'action' | 'both'
  label: string           // human-readable name for this action
  section: string         // which card/section this belongs to
  icon?: string           // optional icon name
  realtimeTopic?: string  // MQTT topic for live refresh
  componentHint?: ComponentType  // suggest specific renderer
}
```

`type` tells the renderer what kind of surface to build:

| Value | Meaning |
|-------|---------|
| `data` | Displays output fields — renders as a data card or table |
| `action` | Triggers something — renders as a button or form |
| `both` | Displays current state AND provides controls to change it |

`componentHint` is optional. If omitted, the framework picks the default renderer
for the output schema's field types. Use it only when the default is wrong.

---

## Verb Conventions

Action names must start with one of these prefixes. The framework rejects any
action whose name doesn't match.

| Prefix | HTTP default | Meaning |
|--------|-------------|---------|
| `list_` | `GET` | Return a typed collection |
| `get_` | `GET` | Return a single resource or entity |
| `set_` | `PATCH` | Write a field value |
| `create_` | `POST` | Create a new resource |
| `delete_` | `DELETE` | Remove a resource |
| `invoke_` | `POST` | Trigger an action with side effects |
| `stream_` | `GET` | Return a stream URL or handle |
| `subscribe_` | `GET` (SSE) | Open a live subscription |

---

## Capability Model

A **Capability** is a named group of action names that a plugin contracts to implement.
Plugins declare which capabilities they provide in their manifest. The framework
validates the contract at boot and refuses to start a plugin that doesn't implement
every action in each declared capability.

```typescript
// In plugin manifest:
{
  capabilities: ['network', 'presence']
}

// The 'network' capability requires these action names:
capability('network', ['list_devices', 'get_wan_health'])
capability('presence', ['list_devices', 'get_device'])
```

Capabilities are defined in `packages/shared` so any plugin or runtime code can
import them. Adding a new action to a capability is a breaking change for all plugins
that declare it — do so carefully.

**Known capabilities (current):**

| Name | Required actions |
|------|-----------------|
| `network` | `list_devices`, `get_wan_health` |
| `storage` | `list_volumes`, `get_storage_health` |
| `media` | `list_media`, `get_media_item` |
| `presence` | `list_devices`, `get_device` |
| `camera` | `list_cameras`, `stream_camera` |
| `printing` | `get_print_status` |
| `library` | `list_books`, `get_book` |

`[provisional: full capability list — grows as plugins are built out]`

---

## Pipeline Expressions (Phase 1b)

Pipeline expressions are deferred to Phase 1b — after the first working plugin
using the new `PluginAction` schema. The basic shape is committed here as guidance;
the parser and execution engine are Phase 2 work.

```
{plugin}.{resource-type}.list
  | filter: { field: value }
  | sort: field [asc|desc]
  | limit: N
  | select: [field, ...]
```

**Phase 2 implementation note:** For the initial build, expose pipeline parameters
as query params on list endpoints:

```
GET /devices?filter[status]=ok&sort=lastSeen&sort_dir=desc&limit=10
```

The pipeline engine will be a first-class abstraction later. Start with query params.

---

## Package Boundaries

Code is organized into two zones: domain-agnostic (publishable) and Maisie-specific.

### Domain-Agnostic (publishable as `@universal-interface/*`)

These packages contain zero knowledge of home automation, network devices, cameras,
or media. They define the protocol, not the content.

| Package | Contents |
|---------|----------|
| `@universal-interface/protocol` | Resource model types, semantic type vocabulary, capability model, verb conventions |
| `@universal-interface/plugin-sdk` | `PluginAction`, `PluginEvent`, `defineAction()`, `defineEvent()`, Zod helpers |
| `@universal-interface/pipeline` | Pipeline expression parser and execution engine |
| `@universal-interface/agent-core` | Agent runtime, tool registry, safety tier enforcement |
| `@universal-interface/components` | Component spec (JSON schema), type-to-component mapping |

### Maisie-Specific (stays in this repo)

```
packages/plugin-*/     — all integrations
packages/dashboard/    — React app, Maisie branding, home-specific pages
packages/agent/        — Maisie personas, nightly routines, household memory
packages/shared/       — current home for shared types (will be split into protocol + maisie-types)
packages/core/         — HTTP server, MQTT, SQLite chassis (will absorb agent-core)
```

**Current state:** All code lives in the monorepo. The extraction into
`@universal-interface/*` packages happens after the shape is proven — probably
after Phase 3 when at least 4 plugins are implemented against the protocol.

---

## ActionContext

The execution context passed to every `execute()` call:

```typescript
interface ActionContext {
  db: Database              // bun:sqlite instance
  mqtt: MqttClient          // publish/subscribe
  log: Logger               // structured logging
  plugin: string            // calling plugin name
  persona?: string          // if called by an AI persona
  requestId: string         // for tracing
}
```

---

## Implementation Order (Phase 2)

1. **`packages/shared`**: Add `field()` helper, semantic types enum, verb prefix validator
2. **`packages/plugin-core`**: Add `ResourceRegistry`, update `PluginAction` type with new `ui` surface, boot-time validation (verb prefixes, three-surface requirement, capability contracts)
3. **`packages/agent/src/api`**: Add generic list/get routing from ResourceRegistry
4. **Pick one plugin to rewrite against the spec** — `plugin-unifi` is the right first target (most complex, best test of the model)
5. **Dashboard auto-rendering**: A generic `ResourceCard` component that renders any action's output using field type metadata
6. Repeat for remaining plugins (Phase 3)

---

## Open Questions

These are documented here, not in someone's head.

1. **Resource relationships** — how does a `network-device` reference the `access-point`
   it's connected to? Options: (a) field of type `ref<unifi.access-point>`, (b) conventions
   only, (c) explicit join in pipeline. `[resolve before plugin-unifi rewrite]`

2. **Event lifecycle** — resources come and go. When a device disappears from the network,
   does the resource type emit a lifecycle event or does the caller poll? Lean toward
   lifecycle events via MQTT for presence-sensitive resources.

3. **Writable fields** — `set_*` actions work for simple fields. For complex mutations
   (block + notify + log), is `set_` enough or do we need `invoke_`? Convention: use
   `set_` when the primary effect is the field value changing. Use `invoke_` when
   there are significant side effects beyond the value change.

4. **Schema versioning** — how do we handle an action's output schema changing without
   breaking the UI? `[defer to Phase 2 — not needed until we have plugins with real
   version histories]`
