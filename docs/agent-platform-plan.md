# Agent Platform — Implementation Plan

*Last updated 2026-04-23*

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

**Goal:** The agent gains a small set of protocol-level tools that operate against any entity in the catalog. Per-action hand-wired tools remain available but are no longer the only way to compose.

### What ships

Four new tool surfaces registered in the agent's tool registry:

- **`resolve_address(address: string)`** — returns the live value at an entity-field address. Equivalent to `GET /api/entities/:name/:field` via the address resolver. Tier: `inform`.
- **`invoke_address(address: string, args?: record)`** — calls a function field at an address with optional arguments. Tier: inferred from the target field's declared tier (agent runtime checks before dispatch).
- **`run_pipeline(expression: string)`** — parses a MEL expression, evaluates it via `evalExprAsync`, returns the result. Tier: `inform` for pure read expressions; runtime checks for any embedded function calls.
- **`list_entities(filter?: {section?, fieldShape?})`** — returns catalog entries matching a structural filter. Tier: `inform`.

### Files to create

- `packages/agent/src/tools/generic-tools.ts` — tool definitions + handlers
- `packages/agent/src/tools/tier-enforcement.ts` — checks that the tool's actual invocation respects the caller's permitted tier

### Files to modify

- `packages/agent/src/agent/index.ts` (or wherever tools register) — add the four generic tools to the base tool set
- `packages/agent/src/agent/__tests__/` — tests covering the new tools

### Tests

- `resolve_address` returns the live value for a plugin entity field; returns the evaluated value for a derived entity field
- `invoke_address` calls a function field; errors when called on a data field
- `run_pipeline` evaluates a simple MEL expression; rejects pipelines that include act-tier operations when the caller's permitted tier is lower
- `list_entities` filters by section; filters by field shape (structural match)

### Proof of concept

Chat: "What's the status of the exterior lights?" → agent calls `resolve_address("home-assistant.switch.front_exterior_lights.state")` → returns "off". Same query without hand-wired tools.

Chat: "Show me all switches that are on" → agent constructs `home-assistant.list_switches | filter: state == "on"` and calls `run_pipeline` → returns the list.

### Estimated scope

2 sessions.

---

## Phase 4b — MEL Authoring Tools

**Goal:** The agent can create persistent derived entities and components, not just evaluate expressions.

### What ships

Three new tool surfaces:

- **`save_entity(source: string)`** — parses MEL `define` block, registers, persists via `POST /api/entities`. Tier: `advise` (creating a catalog artifact is human-visible and sticky).
- **`save_component(source: string)`** — same, for components. Tier: `advise`.
- **`delete_artifact(address: string)`** — removes a derived entity or component. Tier: `advise`.

These let the agent propose catalog changes through the existing `advise` flow: the agent writes MEL, surfaces it as a proposal, the user approves, and the artifact is saved.

### Files to create

- `packages/agent/src/tools/authoring-tools.ts` — tool definitions + handlers

### Files to modify

- `packages/agent/src/agent/index.ts` — register the new tools
- Persona prompts in `packages/shared/src/persona.ts` or per-plugin persona defs — add guidance on when to use authoring tools vs. evaluation tools

### Tests

- `save_entity` accepts MEL source, persists, returns the created entity
- `save_entity` rejects invalid MEL with a clear error
- `save_component` similar
- `delete_artifact` removes; errors when called on a non-derived entity or missing address

### Proof of concept

Chat: "Remember a view that shows me movies I haven't watched yet." → agent constructs a `define` block for `unwatched-movies` with the appropriate pipeline, calls `save_entity` → user approves → the entity appears in the catalog → user can add it as a card in the wizard.

### Estimated scope

2 sessions.

---

## Phase 4c — Personas as Entities

**Goal:** Personas are entities. Their configuration (subscriptions, tool scopes, system prompt, tier cap) lives in the catalog like any other entity. Event subscriptions propagate via MQTT invalidation.

### What ships

- `persona` entity type: a named entity with fields `role`, `avatar`, `defaultTier`, `eventSubscriptions`, `toolScopes`, `systemPrompt`, `isCustom`
- Persona registry backed by the entity registry (not a separate store)
- `/api/personas/*` routes continue to work but delegate to the entity registry internally
- MQTT invalidation events wake personas whose subscriptions match the changed address
- The agent runtime resolves a persona by address (`personas.natalie`, `personas.channing`, etc.) and executes within its scope

### Files to modify

- `packages/plugin-core/src/persona-registry.ts` (if exists) or wherever personas live — delegate to entity registry
- `packages/agent/src/agent/persona-router.ts` — route events via the entity dependency graph
- `packages/shared/src/persona.ts` — turn PersonaConfig into an entity shape

### Tests

- Persona registers as an entity; queryable via `/api/entities/personas.natalie`
- Event matching subscription wakes the persona
- Tool scope enforced at call time

### Proof of concept

`catalog.items | filter: e => e.section == "persona"` returns all personas. Editing a persona's system prompt via `save_entity` takes effect on next wake.

### Estimated scope

2–3 sessions.

---

## Phase 4d — Memory as an Entity

**Goal:** The agent's memory store is a catalog entity. Conversations, notes, observations, and the derived "household knowledge" all live behind addresses and are queryable via MEL.

### What ships

- `memory` entity with fields: `conversations` (collection), `notes` (collection), `observations` (collection), `facts` (record)
- Each sub-collection has its own schema (timestamp, author, content, tags, etc.)
- `/api/memory/*` routes continue for backward compat
- Agent tools read and write via the generic address tools

### Files to modify

- `packages/agent/src/services/memory.ts` — backed by SQLite tables, exposed as an entity
- `packages/shared/src/field.ts` — no changes (existing types suffice)
- Persistence uses an existing or new Drizzle table

### Tests

- Memory writes via `invoke_address("memory.notes.append", {...})` persist
- Memory reads via `resolve_address("memory.notes")` return the collection
- MEL queries work: `memory.notes | filter: content contains "plumber" | sort: timestamp desc | limit: 3`

### Proof of concept

Chat: "What did I tell you about the plumber?" → agent runs the MEL query above and returns the most recent notes.

### Estimated scope

3 sessions.

---

## Phase 4e — Proactive Authoring

**Goal:** The agent authors derived entities and components autonomously (at `advise` tier) in response to ongoing concerns. Users see the proposals as cards on the dashboard.

### What ships

- Agent behavior layer: periodic reflection on memory + current state; proposes derived entities for persistent concerns (overdue packages, unusual network activity, printer alerts)
- A "proposals" section in the dashboard/inbox: each proposal shows the MEL source, the expected output, a Save button (advise-tier approval), and a Reject button
- Approved proposals persist via `save_entity` / `save_component`
- Agent learns from approvals and rejections (later — track metrics)

### Files to create

- `packages/agent/src/agent/reflection.ts` — periodic background loop
- `packages/agent/src/agent/proposal-engine.ts` — generates proposals
- `packages/dashboard/src/components/ProposalsPanel.tsx` — UI for reviewing

### Tests

- Proposal engine emits a proposal given a sample memory state
- Approval path: save → appears in catalog
- Rejection path: proposal discarded, logged

### Proof of concept

Over a week, the agent observes multiple packages arriving late. It proposes a `late-packages-this-week` derived entity. User approves → a card appears on the dashboard tracking the pattern.

### Estimated scope

3–4 sessions.

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
