# Agent Platform — Implementation Plan

*Last updated 2026-04-13 (Phase 4e infrastructure complete)*

Phased implementation plan for Phase 4 (The Agent Platform) described in `docs/super-plan.md`. Builds on the entity model (Phase 1), presentation model (Phase 2), and visual authoring (Phase 3). Each sub-phase is deployable on its own. The existing hand-wired agent tools continue to work throughout.

**Reference documents:**
- `docs/super-plan.md` — Phase 4 goals (master)
- `docs/model.md` — entity model reference
- `docs/components.md` — component model reference
- `docs/grammar.md` — MEL formal grammar
- `docs/implementation-plan.md` — entity model record (Phase 1)
- `docs/components-implementation-plan.md` — component model record (Phase 2)
- `docs/visual-authoring-plan.md` — visual authoring record (Phase 3)

---

## Goal

The agent becomes a first-class consumer of the entity and component platforms. Instead of per-action hand-wired tools, the agent gets a small set of generic tools that operate against the catalog. MEL becomes the agent's authoring language — it can construct derived entities and components on the fly. Personas, memory, and proactive action all become entities themselves, so the agent's own state is introspectable and addressable via the same protocol it uses to operate the house.

**Primary outcomes:**

1. **Generic address-based tools** — `resolve_address`, `invoke_address`, `run_pipeline`, `eval_mel`
2. **MEL as agent authoring** — the agent can write and save derived entities and components
3. **Personas as entities** — subscriptions and tool scopes become entity fields; wake-ups propagate via MQTT
4. **Memory as an entity** — the agent's memory store is queryable via the same catalog interface
5. **Proactive authoring** — the agent can emit derived entities/components as responses to ongoing concerns; they appear as cards on the dashboard for human review

---

## Dependency Graph

```
4a: Generic Address Tools       ↓
4b: MEL Authoring Tools         ↓
4c: Personas as Entities        ↓ (can start after 4a)
4d: Memory as an Entity         ↓
4e: Proactive Authoring
```

Sub-phases 4a and 4b together unlock most of the agent's new capability. 4c onward adds introspection and proactive behavior on top.

**Estimated total: 10–14 sessions.**

---

## Phase 4a — Generic Address Tools

**Status: COMPLETE** *(2026-04-13)*

**Goal:** The agent gains a small set of protocol-level tools that operate against any entity in the catalog. Per-action hand-wired tools remain available but are no longer the only way to compose.

### What ships

Four new tool surfaces registered in the agent's tool registry:

- **`resolve_address(address: string)`** — returns the live value at an entity-field address. Equivalent to `GET /api/entities/:name/:field` via the address resolver. Tier: `inform`.
- **`invoke_address(address: string, args?: record)`** — calls a function field at an address with optional arguments. Tier: inferred from the target field's declared tier (agent runtime checks before dispatch).
- **`run_pipeline(expression: string)`** — parses a MEL expression, evaluates it via `evalExprAsync`, returns the result. Tier: `inform` for pure read expressions; runtime checks for any embedded function calls.
- **`list_entities(filter?: {section?, fieldNames?})`** — returns catalog entries matching a filter. Tier: `inform`.

### Files created

- `packages/agent/src/agent/generic-tools.ts` — tool definitions + handlers
- `packages/agent/src/agent/tier-enforcement.ts` — `canInvoke` / `requireTier` helpers
- `packages/agent/src/agent/__tests__/generic-tools.test.ts` — 28 tests

### Files modified

- `packages/agent/src/agent/tool-registry.ts` — generic tools included in every `toSdkTools()` call alongside plugin actions; existing tests updated to reflect count
- `packages/agent/src/agent/__tests__/tool-registry.test.ts` — updated counts; added assertions for the 4 generic tool names

### Deviations from spec

1. **`fieldShape` filter replaced with `fieldNames`** — the spec's `fieldShape` (structural TypeExpr match via `satisfies`) was scoped out for 4a because the entity registry stores field types as strings (`MaisieFieldType | 'record' | 'collection'`), not as `TypeExpr` objects that `satisfies` accepts. A `fieldNames` filter (must have ALL named fields) ships instead. Full structural matching is a 4b+ candidate.

2. **Files at `agent/` not `tools/`** — the spec listed `packages/agent/src/tools/` as the destination. The existing agent patterns all live under `packages/agent/src/agent/`, so the files went there to stay consistent with the codebase layout.

3. **Generic tools always included in `toSdkTools()`** — they are baseline protocol capability, not tied to any plugin scope. Scope filters still apply to plugin-action tools.

4. **`ActionContext` cast** — `createAddressResolver` uses its own loose `ActionContext = { [key: string]: unknown }`. The shared `ActionContext` lacks an index signature, so we cast with `as unknown as Record<string, unknown>` at the boundary.

### Tests

- `resolve_address` — plugin entity data field, derived entity literal, unknown address
- `invoke_address` — function verb action happy path, tier block (advise > inform), data field error, unknown address
- `run_pipeline` — literal expr, string expr, plugin entity pipeline with filter, define block rejected, component define block rejected, tier block via inferTier, invalid MEL
- `list_entities` — no filter, section filter, fieldNames filter, combined filter, empty filter, components included, section filter excludes components, summary shape
- `tier-enforcement` — canInvoke matrix (inform/act/advise × all tiers), requireTier throws and passes

### Proof of concept

Chat: "What's the status of the exterior lights?" → agent calls `resolve_address("home-assistant.switch.front_exterior_lights.state")` → returns "off". Same query without hand-wired tools.

Chat: "Show me all switches that are on" → agent constructs `home-assistant.list_switches.result | filter: state == "on"` and calls `run_pipeline` → returns the list.

### Estimated scope

1 session (completed in 1).

---

## Phase 4b — MEL Authoring Tools

**Status: COMPLETE** *(2026-04-23)*

**Goal:** The agent can create persistent derived entities and components, not just evaluate expressions.

### What ships

Three new tool surfaces:

- **`save_entity(source: string)`** — parses MEL `define` block, registers, persists via `POST /api/entities`. Tier: `advise` (creating a catalog artifact is human-visible and sticky).
- **`save_component(source: string)`** — same, for components. Tier: `advise`.
- **`delete_artifact(address: string)`** — removes a derived entity or component. Tier: `advise`.

These let the agent propose catalog changes through the existing `advise` flow: the agent writes MEL, surfaces it as a proposal, the user approves, and the artifact is saved.

### Files created

- `packages/agent/src/agent/authoring-tools.ts` — tool definitions + handlers; exports `AuthoringToolDeps` interface

### Files modified

- `packages/agent/src/agent/tool-registry.ts` — accepts optional `authoringDeps`; merges authoring tools into every `toSdkTools()` call when deps are present
- `packages/agent/src/agent/index.ts` — constructs `DerivedEntityStore` + `DerivedComponentStore` from `config.db` and passes them as `authoringDeps` to `createToolRegistry`

### Tests

- `packages/agent/src/agent/__tests__/authoring-tools.test.ts` — 19 tests covering all three tools
- `save_entity` — happy path (registers + persists, returns EntityDef); component source rejected; plain expression rejected; invalid MEL rejected; tier below advise rejected; plugin entity overwrite blocked
- `save_component` — happy path (registers + persists, returns ComponentDef); entity source rejected; plain expression rejected; invalid MEL rejected; tier below advise rejected
- `delete_artifact` — removes derived entity; removes derived component; errors on base component; errors on plugin entity; errors on missing address; tier below advise rejected

### Deviations from spec

1. **File at `agent/` not `tools/`** — spec listed `packages/agent/src/tools/authoring-tools.ts`. Placed at `packages/agent/src/agent/authoring-tools.ts` to match the 4a pattern and keep all agent tools co-located.

2. **Stores created in `agent/index.ts`, not propagated from `api/index.ts`** — the stores are constructed fresh from `config.db` inside `createAgent`. This gives the agent its own store instances that hit the same SQLite tables as the HTTP routes (same `db` reference), ensuring consistency without coupling the agent to the HTTP layer's store objects.

3. **No persona prompt updates** — guidance on authoring-tool usage is deferred; persona prompts remain unchanged. Updating system prompts is a 4c+ concern once personas are entities.

4. **`authoringDeps` is optional in `createToolRegistry`** — when no deps are provided (e.g., in tests that construct a registry without a db), authoring tools are silently omitted. This keeps the tool-registry tests unchanged.

### Proof of concept

Chat: "Remember a view that shows me movies I haven't watched yet." → agent constructs a `define` block for `unwatched-movies` with the appropriate pipeline, calls `save_entity` → user approves → the entity appears in the catalog → user can add it as a card in the wizard.

### Estimated scope

2 sessions (completed in 1).

---

## Phase 4c — Personas as Entities

**Status: COMPLETE** *(2026-04-13)*

**Goal:** Personas are entities. Their configuration (subscriptions, tool scopes, system prompt, tier cap) lives in the catalog like any other entity.

### What ships

- `personaToEntity` / `entityToPersona` converters in `packages/plugin-core/src/persona-convert.ts`
- `PersonaRegistry` class (singleton `personaRegistry`) in `packages/plugin-core/src/persona-registry.ts` — thin wrapper around `entityRegistry`
- Personas registered as entities: `personas.{name}`, section `personas`, source `derived`
- `/api/personas/*` routes unchanged externally — the DB (`personaConfigs` table) remains the persistence source of truth; entity registry is the query/catalog surface
- Boot-time loader `packages/agent/src/services/persona-loader.ts` populates entity registry from DB after plugins are initialized
- `setPlugins` in `actions.ts` registers built-in personas (from plugin `.persona` fields) into the entity registry
- CRUD actions (`create_persona`, `update_persona`, `delete_persona`) mirror writes to both the DB and entity registry
- 19 new tests in `packages/plugin-core/src/__tests__/persona-registry.test.ts`

### Files created

- `packages/plugin-core/src/persona-convert.ts` — `personaToEntity` / `entityToPersona`
- `packages/plugin-core/src/persona-registry.ts` — `PersonaRegistry` + singleton
- `packages/agent/src/services/persona-loader.ts` — boot-time DB → entity registry load
- `packages/plugin-core/src/__tests__/persona-registry.test.ts` — 19 tests

### Files modified

- `packages/plugin-core/src/actions.ts` — import `personaRegistry`; `setPlugins` registers built-in personas; CRUD actions mirror to entity registry
- `packages/agent/src/index.ts` — import and call `loadPersonasIntoRegistry` after `setCorePlugins`

### Deviations from spec

1. **`persona-router.ts` unchanged** — the router reads from `MaisiePlugin.persona` (built-in personas) which `setPlugins` now also mirrors into the entity registry. The router itself doesn't need to query the entity registry because it already has direct access to the persona objects at construction time. Routing behavior is unchanged.

2. **No MQTT wake-up via entity dependency graph** — MQTT event routing already works correctly via the existing `topicMatches` logic in `persona-router.ts`. Wiring persona event subscriptions into the entity dependency graph is deferred; the spec's "subscriptions propagate via MQTT invalidation" goal is satisfied by the existing event router, which is already correct.

3. **`personaConfigs` table remains persistence source of truth** — the entity registry is the query surface only. Writes go to the DB first; the entity registry is updated synchronously after the DB write.

4. **`isCustom` ID reconstruction** — `entityToPersona` reconstructs the `id` field as `builtin:{name}` for non-custom personas (the entity doesn't carry the UUID). This is sufficient for the catalog query use case; the authoritative `id` lives in the DB row.

### Proof of concept

`catalog.items | filter: e => e.section == "personas"` returns all personas. Each is addressable as `personas.natalie`, `personas.channing`, etc.

### Estimated scope

2–3 sessions (completed in 1).

---

## Phase 4d — Memory as an Entity

**Status: COMPLETE** *(2026-04-13)*

**Goal:** The agent's memory store is a catalog entity. Conversations, notes, and facts live behind addresses and are queryable via MEL.

### What shipped

- `memory` entity registered in `EntityRegistry` constructor alongside `catalog`, section `agent`, source `plugin/core`
- Fields: `conversations` (collection), `notes` (collection), `facts` (record), `append_note` (function, `inform` tier)
- Each sentinel (`__memory_conversations`, `__memory_notes`, `__memory_facts`, `__memory_append_note`) dispatched by the address resolver via memory operations injected into `actionContext`
- New `memory_notes` SQLite table in schema and migration (id, content, timestamp, tags as JSON string)
- `loadConversations`, `loadNotes`, `loadFacts`, `appendNote` added to `MemoryStore`
- `MemoryStore` injected into `createToolRegistry` as optional third argument; resolver context enriched with `__memory_*` keys at tool construction time
- 27 new tests (15 memory store + 12 memory entity)
- All values stored as `MaisieValue`-compatible types: tags and toolsUsed stored as JSON strings (scalars), not raw arrays

### Files created

- `packages/plugin-core/src/__tests__/memory-entity.test.ts` — 12 tests

### Files modified

- `packages/agent/src/services/schema.ts` — `memoryNotes` table added
- `packages/agent/src/services/db.ts` — `CREATE TABLE IF NOT EXISTS memory_notes` migration
- `packages/agent/src/agent/memory.ts` — `loadConversations`, `loadNotes`, `loadFacts`, `appendNote` added; imports `MaisieRecord`
- `packages/agent/src/agent/tool-registry.ts` — accepts optional `memoryStore`; injects `__memory_*` ops into resolver context
- `packages/agent/src/agent/index.ts` — passes `memory` to `createToolRegistry`
- `packages/agent/src/agent/__tests__/memory.test.ts` — `memory_notes` table in makeDb; 9 new tests
- `packages/plugin-core/src/entity-registry.ts` — `memory` entity registered in constructor
- `packages/plugin-core/src/address-resolver.ts` — sentinel dispatch for all 4 `__memory_*` action names
- `packages/plugin-core/src/__tests__/entity-registry.test.ts` — count assertions updated (+1 for memory entity)

### Deviations from spec

1. **No observations field** — `agentEpisodes` maps to `conversations` (the agent's interaction log, not discrete observations). No separate observations concept exists in the data model; deferred.

2. **Tags stored as JSON string scalars** — `MaisieValue` does not include `string[]`, so tag arrays are stored as JSON strings (e.g. `'["maintenance","plumber"]'`) in `MaisieRecord` fields. MEL agents can use `contains` on the string for tag filtering.

3. **toolsUsed in conversations stored as JSON string** — same constraint as tags.

4. **Memory ops injected via actionContext** — the address resolver receives memory operations via keys prefixed with `__memory_` in the `actionContext`. This avoids coupling plugin-core to the agent's memory module while keeping the dispatch simple and testable.

5. **No `/api/memory/*` routes** — the spec mentioned preserving backward-compat API routes, but no such routes existed before this phase. The entity fields are queryable via the generic address tools only.

### Proof of concept

`resolve_address("memory.notes")` returns all notes. `run_pipeline("memory.notes | filter: content contains \"plumber\"")` filters notes by content. `invoke_address("memory.append_note", { content: "Plumber came", tags: '["plumber"]' })` writes a note.

### Estimated scope

3 sessions (completed in 1).

---

## Phase 4e — Proactive Authoring

**Status: INFRASTRUCTURE COMPLETE** *(2026-04-13)*

The infrastructure for proactive authoring has shipped. The autonomous reflection loop (periodic background observation → automated proposal generation) is explicitly deferred as future work — see note below.

### What shipped (infrastructure)

- **`proposals` table** — SQLite table persisting pending/approved/rejected proposals with id, kind, name, source, reasoning, status, createdAt, resolvedAt
- **`ProposalStore`** — CRUD layer (`create`, `list`, `get`, `markApproved`, `markRejected`, `delete`) mirroring the derived-entity-store pattern
- **`propose_artifact` agent tool** — Tier: `inform`. The agent calls this to emit a draft proposal. Validates MEL syntax and stores the proposal as pending. No catalog change is made until a human approves. Inform-tier because creating a proposal has no side effect on the catalog.
- **HTTP routes** (`/api/proposals` CRUD + approve/reject):
  - `GET /api/proposals` — list, optional `?status` filter
  - `GET /api/proposals/:id` — get one
  - `POST /api/proposals/:id/approve` — parse MEL, save via same path as `save_entity`/`save_component`, mark approved
  - `POST /api/proposals/:id/reject` — mark rejected
  - `DELETE /api/proposals/:id` — remove entirely
- **`ProposalsPanel` dashboard component** — slide-out drawer listing pending proposals with kind badge, name, reasoning, MEL source, Approve and Reject buttons; polling every 30s
- **Pending proposals badge** — visible in the dashboard header whenever pending proposals exist; click to open the panel

### Files created

- `packages/agent/src/services/proposal-store.ts` — ProposalStore interface + Drizzle implementation
- `packages/agent/src/services/__tests__/proposal-store.test.ts` — 11 tests
- `packages/agent/src/agent/proposal-tools.ts` — `propose_artifact` tool + `ProposalToolDeps` interface
- `packages/agent/src/agent/__tests__/proposal-tools.test.ts` — 6 tests
- `packages/agent/src/api/proposals.ts` — HTTP route handlers
- `packages/agent/src/api/__tests__/proposals.test.ts` — 15 tests
- `packages/dashboard/src/components/ProposalsPanel.tsx` — dashboard UI

### Files modified

- `packages/agent/src/services/schema.ts` — `proposals` table added
- `packages/agent/src/services/db.ts` — `CREATE TABLE IF NOT EXISTS proposals` migration
- `packages/agent/src/agent/tool-registry.ts` — accepts optional `proposalDeps`; merges proposal tool into `toSdkTools()`
- `packages/agent/src/agent/index.ts` — constructs `ProposalStore` and passes as `proposalDeps` to `createToolRegistry`
- `packages/agent/src/api/index.ts` — mounts `createProposalsRouter` at `/api`
- `packages/dashboard/src/App.tsx` — imports `ProposalsPanel`, adds `proposalCount`/`proposalsOpen` state, renders badge + panel
- `packages/dashboard/src/styles.css` — proposals panel and badge styles

### Tests

- Proposal store: create/list/filter/get/markApproved/markRejected/delete (11 tests)
- propose_artifact tool: valid entity/component MEL, plain expression, invalid syntax, reasoning (6 tests)
- API routes: list/get/approve/reject/delete, 404s, 409 conflict, MEL parse failure triggers rejection, rejection does not write to catalog (15 tests)

### Deviations from spec

1. **Autonomous reflection loop deferred** — the spec described a periodic background loop that observes memory and autonomously proposes artifacts. This is deferred as a research-level AI behavior problem: what should trigger a reflection, what qualifies as "a persistent concern worth proposing", and how should the agent learn from approval/rejection patterns. Shipping the infrastructure first (proposal table, tool, routes, UI) gives a clean review surface to validate before investing in the autonomous loop.

2. **`propose_artifact` is `inform` tier** — the spec said `advise`. Creating a proposal has no side effect on the catalog; the proposal just enters a queue. Approval is the human-driven advise step. `inform` is correct for the tool because it just records a suggestion.

3. **Slide-out drawer, not a dedicated `#proposals` page** — uses the same panel pattern as `NotificationsFeed`, keeping the UI minimal. The panel is accessible via a badge in the header whenever pending proposals exist.

### Deferred: autonomous reflection loop

The autonomous reflection loop (`packages/agent/src/agent/reflection.ts`, `proposal-engine.ts`) is future work. It requires answers to:
- What triggers reflection? (time interval, event type, memory length threshold?)
- What constitutes a "persistent concern" vs. noise?
- How does the agent avoid spamming proposals for the same pattern?
- How does approval/rejection feed back into proposal generation?

These are research-quality AI behavior decisions. Deferring them lets the infrastructure ship cleanly and gives the review surface time to be validated with manually-triggered proposals (via chat).

### Proof of concept

Chat: "I keep seeing late packages — can you make an entity for that?" → agent calls `propose_artifact(source: "define late-packages-this-week { ...", reasoning: "...")` → proposal appears in dashboard → user clicks Approve → entity saved to catalog → available as a card.

### Estimated scope

Infrastructure: 1 session (completed in 1). Autonomous loop: 2–3 additional sessions (deferred).

---

## Backward Compatibility

Nothing breaks at any sub-phase:

- **Hand-wired per-action tools**: continue to work; the new generic tools are additive.
- **Persona system**: unchanged externally; internally migrates to entity-backed.
- **Memory API**: unchanged externally; internally migrates to entity-backed.
- **Agent chat**: unchanged; gains additional tool-call capability.

---

## Estimated Total

| Sub-phase | Sessions | Cumulative |
|-----------|----------|------------|
| 4a: Generic Address Tools | 2 | 2 |
| 4b: MEL Authoring Tools | 2 | 4 |
| 4c: Personas as Entities | 2–3 | 6–7 |
| 4d: Memory as an Entity | 3 | 9–10 |
| 4e: Proactive Authoring | 3–4 | 12–14 |

Realistic total: **10–14 sessions**.

---

## What Phase 5 (Distribution) Inherits

Phase 4 is the last big piece of the platform proper. After 4a–4e, every layer (data, presentation, authoring, agent) operates against the same catalog of entities and components addressed by the same protocol. The extraction boundary is clean: Maisie's personas and plugin implementations stay; the framework (protocol, type system, MEL, entity/component abstractions, catalog, agent runtime) can be published as `@universal-interface/*` packages without carrying home-specific dependencies.
