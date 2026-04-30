# Maisie Universal Interface — Master Plan

*Last updated: 2026-04-23*

---

## Vision

Maisie is becoming a universal interface layer for the home — and eventually for any domain with multiple heterogeneous subsystems.

The core idea: every integration exposes its capabilities through a single typed definition, and the framework materializes that definition into three surfaces simultaneously — a REST API, a React dashboard, and an AI agent. Write it once, get it three ways. This is already working for a subset of capabilities. The goal of this plan is to take that pattern to its logical conclusion: a complete, strongly-typed, pipeline-composable protocol that covers every integration in the house.

The system is being designed with two constraints that matter for the long term:

1. **The intermediate layers must make zero domain assumptions.** The protocol, type system, expression language, component model, and agent runtime should be publishable as open-source packages usable outside the home AI context — for a healthcare portal's subsystems, a factory floor dashboard, or a SaaS product's admin interface.

2. **The framework is a superset of Matter.** It covers smart home devices (lights, thermostats, locks, sensors) but also arbitrary APIs, SSH/shell access, media servers, NAS systems, 3D printers, HDHomeRun tuners, and anything else that exposes a programmatic interface. Matter is a device protocol. Maisie is a capability protocol.

---

## Design Principles

### One Definition, Three Surfaces

The `PluginAction` pattern must extend to cover everything. There should be no capability that exists only as an HTTP endpoint or only in the agent's tool set. The single definition is the source of truth. The framework derives the rest.

### Typed Protocol, Not Ad Hoc JSON

Every entity in the system has a semantic type. Not just a Zod schema, but a declared type from a shared vocabulary: `bytes`, `percentage`, `status`, `timestamp`, `progress`, `image`, `stream`, `list<T>`, `toggle`, `action`, `function`. This vocabulary is what allows a generic UI renderer to pick the right component for a value without being told explicitly. It's also what allows the agent to reason about units, comparisons, and thresholds correctly.

### Address-Based Access

Every addressable data point in the system has a path:

```
home-assistant.list_switches.result
synology.get_storage_health.usedPercent
exterior-lights.switches
exterior-lights.sync_toggle
```

This addressing scheme is what makes pipeline expressions, entity bindings in UI components, and agent tool calls composable. The address is the stable reference; plugins declare what addresses they publish and derived entities declare what they resolve to.

### Composable Structurally, Not Nominally

Types compose structurally. A value of type `{name: string, coverUrl: url}` satisfies a component that expects `{coverUrl: url}` regardless of what the value is named or where it came from. This is what makes generic containers possible — one `Strip` component works for movies, books, photos, or any other collection of tile-shaped data.

### Domain-Agnostic Core

The protocol, type system, expression language, component model, and agent runtime contain no references to home automation, network devices, cameras, or media. They are generic. Maisie-specific knowledge lives only in plugins. This is the open-source seam described in Phase 5.

### Safety by Tier

Every agent-callable operation declares an autonomy tier:

| Tier | Agent behavior |
|------|---------------|
| `inform` | Call freely; log result to memory |
| `advise` | Call; surface result for human approval before downstream action |
| `act` | Call and act autonomously; logged but not held for review |

Destructive or irreversible operations must be `advise`. Derived entity tiers are inferred from the composition (the highest tier in the chain wins). Tier enforcement is runtime, not convention.

---

## Vocabulary

These terms are used consistently throughout this document and the codebase.

| Term | Definition |
|------|-----------|
| **Plugin** | A Maisie integration (unifi, synology, home-assistant, plex, etc.) |
| **Action** | A single capability exposed by a plugin — one definition, three surfaces |
| **Entity** | The fundamental unit of the system (base or derived) — a named record of data fields and function fields with typed interfaces. See `docs/model.md`. |
| **Derived Entity** | A user-authored entity whose fields are MEL expressions composing over other entities |
| **MEL** | Maisie Expression Language — the surface syntax for defining derived entities and components. See `docs/grammar.md`. |
| **Capability** | A named group of required actions that a plugin contracts to implement |
| **Card** | A tile/panel on the dashboard grid; binds an entity to a component |
| **Page** | A full-screen view (Media, TV, Cameras, Entities, ...) |
| **Component** | A typed, first-class renderer. Base components are primitives (text, image, badge); layout primitives structure composition (stack, overlay, scroll); derived components are user-authored compositions. See `docs/components.md`. |
| **Derived Component** | A user-authored component with a structural input contract and a render tree composing other components |
| **Pipeline** | A composable chain of operators applied to a typed stream of entities |
| **Address** | The dotted path that identifies any entity, field, function, or component in the catalog |
| **Catalog** | The homogeneous registry of all entities and components — browsable, filterable, itself queryable as an entity |
| **Tier** | Autonomy level for agent-callable operations: inform, advise, act |
| **View** | A named pairing of an entity (optionally through a function chain) with a component and prop values. The canonical unit of "how to show this data." Formal as of 3k. |

---

## Structure

The plan is organized into a sequence of platform phases plus one evergreen stream. Each completed phase persists as a chapter in the manual; phases in progress or planned describe the target.

```
Phase 0: Foundations              [COMPLETE]
Phase 1: The Data Platform        [COMPLETE — 2026-04-22]
Phase 2: The Presentation Platform [COMPLETE — 2026-04-23]
Phase 3: Visual Authoring         [3a-3e + 3g-3n COMPLETE — 2026-04-24; 3f ongoing]
Phase 4: The Agent Platform       [CORE COMPLETE — 2026-04-23; 4e autonomous loop deferred]
Phase 5: Distribution             [PLANNED]
Phase 6: Alternative Clients      [DEFERRED]

Ongoing: Integrations             [EVERGREEN]
```

---

## Phase 0 — Foundations

**Status: Complete.**

What had to exist before the platform could be built.

### What shipped

**API Catalog** — `docs/api-catalog/`, five documents mapping every external API available to the system: UniFi (992 lines), Synology (1780 lines), Home Assistant, Plex/Sonarr/Radarr/Prowlarr, and device/tool APIs (HDHomeRun, Bambu, Calibre, DAKboard, go2rtc). These are the inputs to everything else.

**Protocol Specification** — `docs/protocol.md`, 314 lines. Defines the PluginAction contract, the three-surface rule (http/ai/ui), the semantic type vocabulary (22 scalar types + record/collection/json), the capability model, verb conventions, URL derivation rules, and autonomy tiers.

**Core Framework Implementation** — the resource registry, semantic type annotations via `field()`, `defineAction()`, plugin loading, the generic action router that auto-generates REST endpoints. `packages/shared/`, `packages/plugin-core/`, `packages/agent/`.

**First Plugin Wave** — `plugin-bambu`, `plugin-calibre`, `plugin-google`, `plugin-home-assistant`, `plugin-hp-printer`, `plugin-plex`, `plugin-radarr`, `plugin-sonarr`, `plugin-synology`, `plugin-unifi`. All follow the protocol. `plugin-core` is the framework itself.

**Production Infrastructure** — Tokyo host running Docker Compose: maisie (agent + HTTP API + dashboard), mosquitto (MQTT), synthetic-hdhr (HDHomeRun emulator for library channels), tokyo-streamer (GPU-accelerated HLS transcoding), go2rtc (camera relay), ssdp (Plex discovery), audiobookshelf.

**Dashboard Foundation** — React SPA with working pages for Media, TV, Cameras, Network, NAS, and Personas. `DynamicCard` renders from `CardDescriptor` schemas with semantic field types. Write path, per-card configurator, card templates, compound cards, layout persistence to SQLite.

**Library Channels** — Plex content as HDHR channels with deterministic schedules; production-ready.

### Reference

- `docs/protocol.md` — protocol specification
- `docs/architecture.md` — system deep-dive
- `docs/building-a-plugin.md` — plugin authoring guide

---

## Phase 1 — The Data Platform

**Status: Complete (2026-04-22).** 693 tests. 7 sub-phases.

Entities as the unified unit of data + behavior. Every capability in the system — a sensor reading, a light switch, a list of movies — is an entity with a typed interface. Base entities come from plugins; derived entities are user-authored compositions. Both share the same shape: data fields + function fields.

### What shipped

**MEL — Maisie Expression Language**
- Formal grammar (`docs/grammar.md`)
- Recursive descent parser: literals, dotted paths, pipe chains, lambdas, let bindings, if/then/else, `define` blocks for entities
- Pretty-printer with operator precedence
- Round-trip guarantees

**Async Expression Evaluator**
- `evalExprAsync` with `AddressResolver` interface
- Async ref resolution (plugin actions called on demand)
- LetNode and PipeNode evaluators
- Single-param lambda convention + row-scope env extension (filter predicates work as bare expressions)
- Dotted-ref resolution (lambda params drill via field access)

**Standard Library**
- 13 FunctionDefs: filter, map, pluck, count, sum, any, all, first, last, unique, limit, sort, group
- Primitives: reduce, sortBy, groupBy, take, get, set, merge, comparison, arithmetic, boolean, string, control (if/call/identity)

**Entity Model**
- `EntityDef`, `FieldDef`, `DataFieldDef`, `FunctionFieldDef` types
- Structural validation
- 1:1 plugin → entity bridge at boot
- Entity registry with `findBySection`, `findByInterface`
- Catalog is itself an entity (queryable via MEL: `catalog.items | filter: ...`)

**Derived Entity Persistence**
- `derived_entities` SQLite table with upsert save/loadAll/delete
- Boot-time hydration into the registry
- Hono CRUD routes: GET/POST/PUT/DELETE `/api/entities`, GET/POST `/api/entities/:name/:field`

**Address Resolver**
- Longest-prefix entity matching
- Plugin entity resolution (calls PluginAction)
- Derived entity resolution (evaluates expression)
- `self` references with cycle detection and lazy proxy
- Safety tier inference for derived function fields

**Event Propagation**
- Entity dependency graph tracking which derived entities reference which base entities (transitively)
- MQTT bridge: plugin events → derived entity invalidation topics
- Dashboard hook for subscription and refetch on invalidation

**Entity Editor (MEL IDE)**
- CodeMirror 6 with MEL syntax highlighting (StreamLanguage tokenizer)
- Run/Save toolbar, split-pane layout with live preview
- Autocomplete: pipe operators after `|`, entity fields after `.`, entity names and keywords for bare identifiers, type names in type position
- Inline error reporting via debounced validate endpoint
- Eval endpoint handles both expressions and `define` blocks (previews each field with `self`-aware environment)

### Reference

- `docs/model.md` — Entity Model reference manual
- `docs/grammar.md` — MEL formal grammar
- `docs/implementation-plan.md` — 7-phase implementation record

---

## Phase 2 — The Presentation Platform

**Status: Complete (2026-04-23).** 1003 tests. 7 sub-phases, ~10 sessions.

Components as the unified unit of UI. Mirrors the data platform in structure: base components + layout primitives are the primitives; derived components are user-authored compositions with structural input contracts. Components are first-class values, allowing generic containers (one `Strip` for movies, books, photos) and higher-order composition.

### What's specified

- Base components (text, number, image, badge, gauge, progress bar, timestamp, toggle, button, slider, ...)
- Layout primitives (stack, row, grid, overlay, scroll, card, spacer)
- Derived component DSL — `define ... { input, props, render }`
- Components as first-class values — passable as props, computable from expressions, stored in the catalog
- Structural contract matcher with pointed error messages
- Defaults and the `DefaultTile` fallback renderer
- Entity-component binding in card configs with structural validation
- Reactivity flows through the existing entity event system

### What shipped

7 sub-phases per `docs/components-implementation-plan.md`:

- **2a** — `ComponentDef`, `TypeExpr`, `PropDecl`, layout primitives (Stack/Row/Grid/Overlay/Scroll/CardContainer/Spacer) as React components, base + layout ComponentDef registries
- **2b** — MEL grammar extended with component productions (`input`, `props`, `render`, type expressions, layout_call, component_call); ParsedComponent; printer round-trip
- **2c** — ComponentRegistry (with pre-registered base + layout); derived_components SQLite table; CRUD routes at `/api/components`; boot-time loader
- **2d** — Structural contract matcher (`satisfies`) with semantic subtypes, pointed error paths, and runtime `inferType` for any MaisieValue
- **2e** — Rendering engine walks ExprNode trees, dispatches component/layout calls, evaluates MEL inline, cycle detection; base components route to FieldRenderer; ComponentRenderer React wrapper with validation
- **2f** — Editor autocomplete includes components; `get_component_catalog` action discoverable via PluginAction surface
- **2g** — CardConfig gains `component` + `componentProps`; DynamicCard delegates to ComponentRenderer when set; DefaultTile built-in auto-renders any record; wizard Step 3 offers component selection

### Reference

- `docs/components.md` — Component Model reference manual
- `docs/components-implementation-plan.md` — implementation phasing (to be written next)

---

## Phase 3 — Visual Authoring

**Status: Core complete (2026-04-23); extensions 3g–3n complete (2026-04-24).** 1569 tests. Sub-phases 3a–3e and 3g–3n shipped. 3f (self-hosting) is ongoing.

The UX surface where entities and components are designed visually. The structural type system enables bidirectional authoring: start from data (bottom-up, see what component contracts you satisfy), start from design (top-down, derive the entity shape you need), or expand outward from any point. The tooling should support all three directions without privileging any.

### What shipped (3a–3e, 3g–3n)

13 sub-phases per `docs/visual-authoring-plan.md`:

- **3a** — Canvas surface with palette (entities + components) + inspector; drag from palette to canvas; placement selection, movement, and deletion. @dnd-kit/core for drag-and-drop.
- **3b** — Wires between placement ports. Structural validation via `satisfies` from Phase 2d. Color-coded wires: green (compatible), red (incompatible with error details), gray (unknown). SVG cubic bezier curves with fat invisible hit targets.
- **3c** — Live preview drawer under the canvas. Each component placement renders via ComponentRenderer, using wired data when available or synthesized fixtures (from the component's declared input contract) otherwise. 250ms debounce.
- **3d** — Link DSL for transforms: identity, pick, rename, compute, chain. Compiles to ExprNode lambdas via `compileLinkExpr`. Transform pill on wires; dedicated TransformEditor in the inspector with per-kind forms. `empty-record` primitive added.
- **3e** — Save as Component / Save as Entity. `emitComponent` walks the wire graph inward from the root, building a nested component-call/layout-call render tree; `emitEntity` captures the composition as a derived entity. Inline save form with name + description. Catalog refresh on save.
- **3g** — Richer plugin entity types. `zodToTypeExpr` converts Zod output schemas to full `TypeExpr` values. Structural matcher works end-to-end.
- **3h** — Function placements on canvas. 13 std lib ops as draggable items. `entity → function → component` compositions fully supported.
- **3i** — Split palette with compatibility highlighting. Entity/component/function panes; green/yellow/gray badges; sort by compatibility; inspector overlays right column on selection.
- **3j** — Auto-suggest transform chains. BFS over function signatures finds bridging chains; popover with one-click apply inserts function placements + wires.
- **3k** — Views as first-class catalog entries. `views` table, registry, CRUD, "Save as View" canvas action. Cards bind views directly. ViewCard resolves entity → chain → component at render time.
- **3l** — Canvas persistence + round-trip editing. `canvas_documents` table, autosave (1500ms debounce), restore on mount, clear button with confirm dialog. `hydrateView/Entity/Component` functions reconstruct CanvasDocuments from saved artifacts. "Edit in Canvas" button in Studio editor.
- **3m** — Right-click context menus + visible delete affordances. ContextMenu component with target-specific actions (placement / wire / surface / palette item). × buttons on placements (hover/selected) and on selected wires. @dnd-kit pointer-event conflict fixed.
- **3n** — Schema visibility on canvas nodes + generalized type inferencer. `inferFunctionOutput` in shared resolves output specs (`element_of`, `field_of`, `collection_of_field_of`, `group_of`) against actual upstream types and inline params. `std.get` added. Placement nodes show shallow output shape; wired functions show inferred output. Inline parameter inputs on function placements with Enter/Escape to blur.

### What's ongoing (3f)

Self-hosting — incrementally replacing hand-coded Studio pieces with authored components. Not time-bounded. Candidates: palette, inspector, canvas preview, placement node. Each replacement is its own 1–2 session iteration.

### Goals

**Canvas with drag-and-drop.** Components and entities are draggable onto a canvas. Dropping a component onto an entity (or vice versa) proposes a binding. The canvas surface is the composition substrate.

**Auto-wire with inference.** Structural matches are unambiguous in most cases — a component expecting `{name, coverUrl}` can only connect to a record that has those fields. The UX completes the binding silently for unambiguous cases.

**First-class "link" DSL for ambiguity.** When matching is ambiguous (two image fields for a flip-cover's front and back; multiple compatible target components), surface the choice explicitly. Link expressions can carry small transforms (`pick`, `rename`, `compute-from`) — a mini-DSL for field-to-slot mappings.

**Live preview with example data.** Populate the canvas with real data from the catalog (or synthesized fixtures for unsaved entities). Rendering updates as compositions change. The feedback loop is immediate.

**Paired-artifact composition.** Dragging a flip-cover tile into a carousel creates two artifacts: a new derived component (the carousel parameterized by flip-cover) AND a derived entity contract (a collection of records matching flip-cover's input). The canvas outputs both.

**Self-hosting.** The authoring UX itself is built from the entity and component system. Canvas state, selected items, field palettes, previews — all entities. Drag targets, property panels, live previews — all components. The editor proves the platform by being built on it. Bootstrap order: minimal React shell → replace parts with authored components until the editor is self-hosted.

### Dependencies

Phase 2 (Presentation Platform) must exist as a running system — components resolvable, contracts checkable, catalog queryable — before visual authoring can run on top.

---

## Phase 4 — The Agent Platform

**Status: Core complete (2026-04-23).** 1273 tests. All five sub-phases shipped; the optional autonomous reflection loop in 4e is deferred.

The agent is now a first-class consumer of the entity and component platforms. Per-action hand-wired tools remain available but are no longer the only way to compose — the agent can operate against any entity in the catalog via generic address tools and MEL.

### What shipped

5 sub-phases per `docs/agent-platform-plan.md`:

- **4a** — Generic address tools: `resolve_address`, `invoke_address`, `run_pipeline`, `list_entities`. Tier enforcement via `requireTier` before any side-effecting dispatch.
- **4b** — MEL authoring tools: `save_entity`, `save_component`, `delete_artifact`. All at `advise` tier so agent-authored artifacts surface for human approval.
- **4c** — Personas as entities: `personaRegistry` delegates to `entityRegistry`; `personas.natalie` is a real address. Backward compatible — existing `/api/personas/*` routes unchanged.
- **4d** — Memory as an entity: `memory.conversations`, `memory.notes`, `memory.facts` queryable via MEL; `memory.append_note` callable. Runtime dispatch via sentinel action names in the address resolver.
- **4e** — Proactive authoring infrastructure: proposals SQLite table + store + `propose_artifact` agent tool + HTTP routes (approve/reject/delete) + dashboard drawer for review. Approval reuses the same save path as manual creation.

### What's deferred

**Autonomous reflection loop** — the 4e infrastructure lets the agent propose artifacts when asked. The autonomous version (agent periodically reflecting on memory + state, generating proposals for persistent concerns) is a research-quality problem: what triggers reflection, what qualifies as a concern, how to learn from approvals. The review surface ships first; the loop follows once the surface has been validated in practice.

---

## Phase 5 — Distribution

**Status: Planned.**

Packaging the platform for reuse outside Maisie. The intermediate layers were built domain-blind; the extraction is mostly a labeling and publishing exercise.

### Extraction sequence

1. `@universal-interface/plugin-sdk` — `defineAction`, `defineEntity`, `defineComponent`, type vocabulary, `field()`
2. `@universal-interface/protocol` — the PluginAction contract, address scheme, capability model
3. `@universal-interface/mel` — parser, pretty-printer, async evaluator, standard library
4. `@universal-interface/components` — component spec, renderer contract, base component + layout primitive definitions
5. `@universal-interface/agent-core` — agent runtime, tool registry, tier enforcement
6. `@universal-interface/dashboard-kit` — the React renderer (optional; a reference renderer that others can fork or replace)

### Publication criteria

- Zero references to `maisie`, home automation, or any specific integration
- Test suite covering the package contract in isolation
- README explaining the use case with a non-home-automation example
- Semantic versioning at `0.x` — no stability promise until the Maisie implementation has been running in production for six months

### Governance

- MIT license
- Issues and PRs accepted from the community
- Maisie remains the reference implementation — breaking changes to published packages require migration paths
- Carefeed (Appendix A) as the second reference implementation to validate non-home applicability

---

## Phase 6 — Alternative Clients

**Status: Deferred.**

Renderers beyond the web dashboard. Each one validates that the component spec is truly renderer-agnostic.

**iOS/Swift** — SwiftUI implementation of the component spec. Fetches page configs from the Maisie API, renders via SwiftUI type dispatch, subscribes to entity addresses over WebSocket. Shares MEL expressions for data binding.

**CLI REPL** — Terminal version of the MEL editor. Pipeline expressions with tab completion from the live catalog. Results rendered using the semantic type vocabulary (not raw JSON). Named query saving. Useful for automation and headless debugging.

**Terminal renderer** — Text-mode implementation of the component spec. Useful for CLI dashboards, server consoles, and proving the spec is genuinely render-agnostic.

Depends on Phase 5 extraction being stable enough that external implementations can target it without vendored copies.

---

## Ongoing — Integrations

Not a phase. A perpetual workstream. The platform's value grows with coverage.

### Current plugin depth

| Plugin | Data depth | Action depth | Events | Notes |
|--------|-----------|--------------|--------|-------|
| plugin-unifi | deep | basic | — | WebSocket listener not wired; polling only |
| plugin-synology | basic | none | — | Docker/thermal/files/backup/SNMP pending |
| plugin-home-assistant | basic | basic | — | Climate/sensors/locks/covers/WS push pending |
| plugin-plex | mid | mid | webhook | Remote control + collections + playlists pending |
| plugin-sonarr | mid | mid | webhook | Queue mgmt + calendar pending |
| plugin-radarr | mid | mid | webhook | Queue mgmt + calendar pending |
| plugin-bambu | basic | mid | — | AMS details + HMS alerts + print history pending |
| plugin-calibre | deep | deep | — | — |
| plugin-google | mid | basic | — | — |
| plugin-hp-printer | deep | basic | — | — |

### Pending new plugins

- Transmission (already connected in the house; no plugin)
- Readarr (already connected; no plugin)
- BLE gateway (Python daemon exists under `packages/ble-gateway/`; needs a MaisiePlugin wrapper to surface SleepNumber, Govee, etc. as entities)

### Coverage strategy

Integration work proceeds as needed rather than gated behind a phase. When a platform capability (derived entity, component, wizard feature) needs richer plugin data to demonstrate, that plugin's coverage is expanded as part of the demo. When a user workflow is blocked by missing integration, coverage catches up. There is no "done" for this stream — home APIs expand forever.

---

## Appendix A — Carefeed Implementation Plan

The Carefeed healthcare portal has subsystems analogous to Maisie's home integrations: a bed board, referrals, communications, scheduling, billing. Each is a separate API. The same framework applies: one plugin per subsystem, one protocol, three surfaces.

**Proposed plugins:** `plugin-bed-board` (census, admissions, discharges, room assignments), `plugin-referrals` (inbound referral pipeline, status, documents), `plugin-communications` (message threads, notifications, fax routing), `plugin-scheduling` (visit schedule, staff assignments, calendar).

**What changes:** Personas have healthcare domain knowledge instead of home automation. Safety tiers are stricter — patient data mutations are always `advise`, never `act`. The dashboard layout reflects clinical workflows. Authentication and audit logging meet healthcare compliance requirements.

**What stays identical:** PluginAction contract, entity model, component model, MEL, catalog, addressing, agent runtime.

The framework is already designed for this. The Carefeed implementation plan is its own document that will be written once the `@universal-interface/*` packages are extracted and published.

---

## Key Risks

**Composition complexity.** The entity and component models are powerful. The editor must make simple things simple — a basic card should not require understanding the whole type system. Progressive disclosure in the UX is non-negotiable.

**Migration complexity.** The platform coexists with hand-coded pages and legacy dashboards. The migration path must be incremental — individual cards move over, the hand-coded code stays until replaced.

**Over-engineering the DSL.** MEL is useful precisely because it's small. Adding features freely would turn it into a programming language project. The rule: a new feature belongs in MEL only if several real compositions need it and no existing combination suffices.

**`advise` tier UX.** The agent safety model only works if the human actually sees and acts on `advise` proposals. The dashboard needs a clear, non-annoying UI for agent proposals before wide-scope `advise` is useful.

**Structural contract ambiguity.** Most structural matches are unambiguous, but the ones that aren't must be surfaced clearly rather than resolved silently. A wrong auto-inference that appears to work until it doesn't is worse than a mandatory user choice.

**Self-hosting bootstrap.** Phase 3's self-hosting goal risks infinite regress. The bootstrap order must be explicit: hand-coded canvas shell first, then progressively replace parts with authored components. Don't chase self-hosting for parts that aren't ready to be authored.

**GPU constraint.** The GTX 1050 Ti supports max 2 NVENC sessions. As library channels and stream components grow, session allocation must be tracked and failures must surface gracefully.
