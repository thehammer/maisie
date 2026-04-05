# Maisie Universal Interface Protocol

*Phase 1 specification — last updated 2026-04-04*

---

## Overview

The Universal Interface Protocol is the contract that governs how plugins describe their capabilities and how the framework materializes those descriptions into usable surfaces. A capability defined once becomes an HTTP endpoint, an AI agent tool, and a dashboard card simultaneously. The protocol specifies the vocabulary, the contract, and the derivation rules that make this work.

The intermediate layers — resource model, semantic type vocabulary, capability model — make zero domain assumptions. They are equally applicable to home automation, healthcare portals, factory floor dashboards, or any system composed of heterogeneous subsystems. Maisie-specific knowledge lives only in plugins.

---

## Core Vocabulary

**Resource** — A named, typed data structure returned by a plugin action. Examples: a `Device` returned by `plugin-unifi`, a `PrintJob` from `plugin-bambu`, a `NasVolume` from `plugin-synology`. Resources have a type, an identifier, and a set of entities.

**Field** — A typed property of a resource, optionally annotated with a semantic `MaisieFieldType`. The annotation is what allows the framework to render and reason about fields without plugin-specific knowledge.

**Action** — The atomic unit of plugin capability. A single `PluginAction` definition from which the framework generates three surfaces: an HTTP endpoint, an AI tool, and a dashboard card. Actions have a name, input schema, output schema, and explicit declarations for each surface.

**Entity** — A specific addressable instance of a resource — a particular camera, a particular storage volume, a particular network device. Entities are referenced by address:

```
{plugin}.{resource-type}.{id}              # the resource
{plugin}.{resource-type}.{id}.{field}      # a specific field on the resource
```

Examples:
```
unifi.network-device.aa:bb:cc:dd:ee:ff
unifi.network-device.aa:bb:cc:dd:ee:ff.blocked
synology.volume.volume1.used_percent
home-assistant.sensor.kitchen_temperature.state
plex.media-item.12345.title
bambu.print-job.current.progress
```

**Capability** — A named group of required action names that a plugin must implement to claim the capability. A plugin declaring `capabilities: ['network']` must expose actions named `list_devices` and `get_wan_health`. The framework validates this contract at boot and refuses to start a plugin that does not satisfy its declared capabilities.

**Tier** — The autonomy level for AI-accessible actions. Controls whether the agent calls the action freely, surfaces the result for human review, or acts and moves on. See Autonomy Tiers.

---

## The Three-Surface Rule

Every `PluginAction` MUST explicitly declare `http`, `ai`, AND `ui`. Setting a surface to `false` is a valid opt-out. Leaving any surface undefined is a boot error — the registry rejects the plugin.

The framework materializes each declared surface:

**HTTP** — A REST endpoint registered with the Hono server. The request body (POST/PATCH/DELETE) or query string (GET) is validated against the action's `input` schema. The response is the serialized output. The full path is `/api/{plugin-name}/{derived-path}`, where the derived path follows the URL Derivation rules below.

**AI** — The action is registered in the agent's tool registry under its `name`. The declared `tier` governs how the agent may call it. The `description` (or the optional `ai.description` override) is passed to the LLM as the tool description. The agent runtime enforces tier constraints before every call.

**UI** — The action is included in the card catalog with its `ui.label`, `ui.section`, and output field descriptors. The dashboard auto-renders it as a card. If `ui.type` is `'action'`, it renders as a button or form. If `'data'`, it renders as a data card or table. If `'both'`, it shows current state with controls to change it.

`false` on a surface is an explicit opt-out and must be used sparingly. If the data or action is meaningful to a human operator, it belongs in the UI. Setting `ui: false` for convenience — because a card hasn't been designed yet — is a protocol violation, not a valid opt-out.

---

## Semantic Field Types

The `MaisieFieldType` vocabulary is layered on top of Zod primitives. A field annotated with a semantic type tells the renderer how to display it and tells the agent how to reason about it, without either needing plugin-specific logic.

Annotations are attached using the `field()` helper from `packages/shared/src/field.ts`:

```typescript
import { field } from '@maisie/shared'

const VolumeSchema = z.object({
  usedBytes:   field(z.number(), 'bytes'),
  usedPercent: field(z.number(), 'percentage'),
  status:      field(z.string(), 'status'),
  lastChecked: field(z.string(), 'timestamp'),
})
```

`field(schema, type)` encodes the annotation as a Zod schema description in the form `maisie:{type}`. It is read back with `getMaisieType()` from the same module.

Full type catalog:

| Type | Base type | Renders as | Typical source |
|------|-----------|------------|----------------|
| `string` | `string` | Plain text | Names, IDs, labels |
| `number` | `number` | Raw number | Counts, indices |
| `boolean` | `boolean` | Yes / No | Flags |
| `bytes` | `number` | `"1.2 GB"` with unit suffix | Storage and transfer sizes |
| `percentage` | `number` | Progress bar or gauge | Disk usage, CPU load, job progress |
| `status` | `string` | Colored badge | Health states: `ok`, `warning`, `error`, `idle`, `busy`, `unknown` |
| `image` | `string` | `<img>` thumbnail | Album art, avatars, camera snapshots |
| `timestamp` | `string` | Relative time: `"2h ago"` | Event times, last-seen |
| `duration` | `number` | `"2h 34m"` | Seconds elapsed, ETAs, remaining time |
| `progress` | `object` | Progress bar with fraction | `{ current, total, label? }` |
| `temperature` | `number` | `"72°C"` with threshold color | CPU, NVMe, printer chamber temps |
| `signal` | `number` | Signal-strength indicator | dBm from access points or printers |
| `toggle` | `boolean` | Toggle switch (read and write) | Blocked state, enabled flags |
| `action` | `void` | Button | Pause, resume, cancel commands |
| `stream` | `string` | Inline player or channel tile | HLS, RTSP, WebRTC URLs |
| `url` | `string` | Clickable `<a>` | External links |
| `json` | `any` | Collapsed viewer | Untyped structured data |

Status values are standardized. Plugins must map their state strings to the shared `MaisieStatus` vocabulary — `ok`, `warning`, `error`, `idle`, `busy`, or `unknown` — for the generic badge renderer to apply color treatment. Custom values are allowed but will not receive color treatment.

The vocabulary is finite and stable. New types require an explicit addition to this spec and to `packages/shared/src/field.ts`. This constraint is the price of generic rendering — and it is worth paying.

---

## The PluginAction Contract

```typescript
interface PluginAction<TInput, TOutput> {
  /** snake_case. Must start with a valid verb prefix. Used as HTTP path segment and AI tool name. */
  name: string

  /** Written for both humans and LLMs. Used in API docs, AI tool registry, and dashboard tooltips. */
  description: string

  /** Zod schema for the request. Validated on HTTP ingress; provided as tool parameters to the agent. */
  input: z.ZodType<TInput>

  /** Zod schema for the response. Fields should be annotated with MaisieFieldType via field(). */
  output: z.ZodType<TOutput>

  /** HTTP surface. All actions must be HTTP-accessible — this field has no false opt-out. */
  http: {
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH'
    /** Override the derived path. Use only when deriveHttpPath produces a collision or incorrect result. */
    path?: string
  }

  /** AI surface. false = not available to agents. Explicit false required — undefined is a boot error. */
  ai: {
    tier: 'inform' | 'advise' | 'act'
    /** Override description for AI context only. Rarely needed. */
    description?: string
  } | false

  /** Dashboard surface. false = not shown. Explicit false required — undefined is a boot error. */
  ui: {
    /** Data card, action control, or both. */
    type?: 'data' | 'action' | 'both'
    label: string
    section: string
    icon?: string
    /** MQTT topic pattern. Matching messages trigger re-fetch in dashboard components. */
    realtimeTopic?: string
    /** Suggest a specific renderer component. If omitted, the framework picks based on output field types. */
    componentHint?: string
  } | false

  execute(input: TInput, context: ActionContext): Promise<TOutput>
}
```

All action definitions should use `defineAction()` from `@maisie/shared` for full TypeScript inference:

```typescript
export const listDevices = defineAction({
  name: 'list_devices',
  description: 'List all active devices on the home network.',
  input: z.object({ vlan: z.number().optional() }),
  output: z.array(z.object({
    mac:       field(z.string(), 'string'),
    hostname:  field(z.string(), 'string').optional(),
    last_seen: field(z.number(), 'timestamp'),
  })),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Network Devices', section: 'network', realtimeTopic: 'home/network/devices/+' },
  async execute(input, _ctx) { /* ... */ },
})
```

---

## Verb Conventions

Action names must start with one of these prefixes. The registry rejects any action name that does not match.

| Prefix | Default HTTP method | Meaning |
|--------|--------------------|---------| 
| `list_` | `GET` | Return a typed collection |
| `get_` | `GET` | Return a single resource or entity |
| `set_` | `PATCH` | Write a field value |
| `create_` | `POST` | Create a new resource |
| `delete_` | `DELETE` | Remove a resource |
| `invoke_` | `POST` | Trigger an action with side effects |
| `stream_` | `GET` | Return a stream URL or handle |
| `subscribe_` | `GET` (SSE) | Open a live subscription |

Convention: use `set_` when the primary effect is a field value changing. Use `invoke_` when there are meaningful side effects beyond the value change (a device command, a print job operation, a network scan).

---

## URL Derivation

The framework derives each action's HTTP path from its name using `deriveHttpPath()` in `packages/plugin-core/src/registry.ts`.

Algorithm:
1. If `action.http.path` is explicitly set, use it as-is.
2. Strip the verb prefix (`list_`, `get_`, `set_`, `create_`, `delete_`, `invoke_`, `stream_`, `subscribe_`).
3. Replace remaining underscores with hyphens.
4. Prepend `/`.

The full endpoint URL is `/api/{plugin-name}/{derived-path}`.

| Action name | Derived path | Full URL (`plugin = unifi`) |
|-------------|-------------|------------------------------|
| `list_devices` | `/devices` | `GET /api/unifi/devices` |
| `get_wan_health` | `/wan-health` | `GET /api/unifi/wan-health` |
| `invoke_block_device` | `/block-device` | `POST /api/unifi/block-device` |
| `stream_camera` | `/camera` | `GET /api/unifi/camera` |
| `subscribe_device_presence` | `/device-presence` | `GET /api/unifi/device-presence` |

Use `http.path` to override when the default derivation produces a collision or an incorrect path.

---

## Card Catalog

The card catalog is the dashboard's index of all renderable actions. At runtime, `getCardCatalog()` in `packages/plugin-core/src/actions.ts` queries the plugin registry for all actions where `ui !== false`. Each entry is a `WidgetDescriptor`:

```typescript
interface WidgetDescriptor {
  id: string           // "{pluginName}.{actionName}" — stable, unique
  pluginName: string
  actionName: string
  label: string        // from ui.label
  section: string      // from ui.section
  outputFields: WidgetField[]
}

interface WidgetField {
  key: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown'
  label: string        // prettified key: "usedBytes" -> "Used Bytes"
  optional: boolean
}
```

`outputFields` is produced by `introspectSchema()` in `packages/plugin-core/src/schema-introspector.ts`, which walks the output Zod schema and maps each top-level field to a primitive type. For array outputs, it introspects the element type.

---

## Autonomy Tiers

Every AI-accessible action declares a tier. The agent runtime enforces it before every call.

| Tier | Agent behavior | Appropriate for |
|------|---------------|-----------------|
| `inform` | Call freely; result logged to agent memory | Read-only queries: device lists, health checks, status |
| `advise` | Call; surface result to human for approval before downstream action | Anything with side effects or that affects physical systems |
| `act` | Call and act autonomously; logged but not held for review | Well-understood automations with no destructive risk |

Destructive or irreversible operations — blocking a device, canceling a print job, removing media — must use `advise`. The tier is enforced by the agent runtime, not by convention. A persona can have its effective tier cap adjusted per-action, but cannot bypass the tier enforcement mechanism.

---

## Known Gaps and Phase 2 Targets

These are the current gaps between the implemented state and the full protocol specification.

**Semantic type annotations lost at introspection.** `field()` encodes annotations as Zod schema descriptions (`maisie:{type}`). The `introspectSchema()` function does not read them — `WidgetField.type` is always a raw Zod primitive. Fix: add `maisieType: MaisieFieldType | null` to `WidgetField` and call `getMaisieType()` in `introspectObject()` in `packages/plugin-core/src/schema-introspector.ts`.

**`ui.type` not enforced.** The `type` field on `ui` (`'data' | 'action' | 'both'`) is defined on the interface but the dashboard currently infers card type at runtime by checking whether the response is an array. Fix: require `ui.type` at registration and use it to drive renderer selection.

**No auto-generated OpenAPI spec.** The registry has all the information needed — action names, input/output schemas, HTTP methods, descriptions. No OpenAPI generation is wired. Fix: add an exporter to `plugin-core` that walks the registry and emits a spec at `GET /api/openapi.json`.

**No resource registry or entity addressing.** The entity address scheme (`unifi.network-device.aa:bb:cc:dd:ee:ff.blocked`) is specified but has no runtime implementation. There is no resolver that maps an address to a live value. Fix: implement `packages/protocol/` with the resource registry and address resolver.

**No pipeline engine.** Pipeline expressions are fully specified in `docs/super-plan.md` but not implemented. Fix: build the pipeline parser and execution engine in `packages/pipeline/`. Start with `filter`, `sort`, `limit` as pure functions; the parser and composition layer follow.

**`WidgetField.maisieType` missing.** The `WidgetField` type needs a `maisieType` property so the dashboard renderer can pick the right component. Until this is added, the renderer falls back to primitive type heuristics.

---

## Design Principles

**Write it once, get it three ways.** The `PluginAction` is the single source of truth for a capability. The framework derives every surface from it. No capability should exist only as a hand-written HTTP route, only in an agent's system prompt, or only as a hand-coded React component.

**Domain-agnostic intermediate layers.** The protocol, resource model, pipeline engine, and component spec contain no references to home automation, network devices, cameras, or media. They are generic. Maisie-specific knowledge lives only in plugins.

**The framework is a superset of Matter.** Matter is a device protocol. This is a capability protocol. It covers smart home devices but also arbitrary APIs, media servers, NAS systems, 3D printers, tuners, and anything else with a programmatic interface.

**Simple solutions that work over clever solutions that impress.** The pipeline is powerful, but most dashboard use cases are simple reads and lists. Implement what the actual use cases require, then stop. The protocol spec should be a working draft that ships to implementation even if some decisions are marked provisional.

**The vocabulary is finite.** The `MaisieFieldType` set must be stable. Adding a new type is a deliberate protocol change — it requires updating this spec, `packages/shared/src/field.ts`, and the renderer. This constraint is the price of generic rendering.

---

## Package Boundaries

Code is organized into two zones: domain-agnostic (extractable as open-source) and Maisie-specific.

**Domain-agnostic (publishable as `@universal-interface/*`):**

| Package | Contents |
|---------|----------|
| `@universal-interface/protocol` | Resource model, semantic type vocabulary, capability model, address scheme |
| `@universal-interface/plugin-sdk` | `PluginAction`, `PluginEvent`, `defineAction()`, `field()`, `getMaisieType()` |
| `@universal-interface/pipeline` | Pipeline expression parser and execution engine |
| `@universal-interface/agent-core` | Agent runtime, tool registry, safety tier enforcement |
| `@universal-interface/components` | Component spec (JSON schema), type-to-component mapping |

**Maisie-specific (stays in this repo):**

```
packages/plugin-*/     — all integrations
packages/dashboard/    — React SPA, Maisie branding, household-specific pages
packages/agent/        — personas, nightly routines, household memory
```

Extraction into `@universal-interface/*` packages happens after the shape is proven by at least four plugins implemented against the protocol. The domain-agnostic packages must contain zero references to home automation, network devices, cameras, or media before they ship.
