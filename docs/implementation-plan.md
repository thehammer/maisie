# Entity Model — Implementation Plan

*Last updated 2026-04-22*

**Status: ALL PHASES COMPLETE.** Phases 1 through 7 shipped on 2026-04-22. Final test count: 689 pass. The entity model is live end-to-end: async MEL evaluator, entity registry, derived entity persistence, self references with safety tier inference, CodeMirror editor with autocomplete and inline errors, catalog as a queryable entity, MQTT-driven event propagation, and the wizard understanding entities with function fields.

Phased implementation plan for the entity model described in `docs/model.md`. Each phase is deployable on its own. The existing PluginAction system continues to work unchanged throughout.

**Reference documents:**
- `docs/model.md` — the entity model (target state)
- `docs/grammar.md` — MEL (Maisie Expression Language) formal grammar
- `docs/protocol.md` — the existing PluginAction protocol
- `docs/super-plan.md` — the master project plan

---

## Dependency Graph

```
Phase 1: Async Evaluator + Parser
   ↓
Phase 2a: Entity Types + Registry + Plugin Bridge
   ↓
Phase 2b: Persistence + CRUD API + Address Resolver
   ↓ (then parallel)
   ├── Phase 3: Self-references + Safety tiers
   ├── Phase 4: Entity Editor/IDE
   ├── Phase 5: Event propagation
   ├── Phase 6: Catalog as entity
   └── Phase 7: Wizard evolution
```

Phases 3–7 can proceed in any order after Phase 2b. Phase 4 is the highest-value target after 2b because it's the authoring tool. Phase 3 is needed before the editor can fully support `self` references.

---

## Phase 1: Async Expression Evaluator + Parser

**Goal:** An async, server-capable expression evaluator that can resolve entity addresses and invoke functions. A parser that converts the surface syntax (from `docs/grammar.md`) into ExprNode trees.

**What ships:** The evaluator, the parser, the pretty-printer, and the standard library — all in `packages/shared/`. The existing sync `evalExpr` and client-side pipeline continue unchanged.

### 1a: Async evaluator

The current `evalExpr` in `ops.ts` is synchronous and resolves `RefNode` by looking up a key in a `Record<string, MaisieValue>` environment. The entity model requires refs like `home-assistant.list_switches` to resolve by calling a `PluginAction.execute()`, which is async.

**Files to create:**

- `packages/shared/src/eval.ts` — the async expression evaluator
  - `evalExprAsync(node: ExprNode, resolver: AddressResolver, env, defs): Promise<MaisieValue>`
  - `AddressResolver` interface: `resolve(address: string): Promise<MaisieValue>` and `invoke(address: string, args: MaisieRecord): Promise<MaisieValue>`
  - New ExprNode variants: `LetNode` (`{ kind: 'let', bindings: [...], body }`) and `PipeNode` (`{ kind: 'pipe', value, steps }`)
- `packages/shared/src/std-lib.ts` — standard library extracted from `ops.ts`
  - Move `STD_LIB`, `STD_LIB_ENTRIES`, `callStd`, all `DEF_*` definitions
  - Add: `std.any`, `std.all`, `std.first`, `std.last`, `std.unique`
  - `ops.ts` re-exports for backward compatibility
- `packages/shared/src/__tests__/eval.test.ts` — mock resolver, async resolution, let bindings, pipes, lambdas, error propagation

**Files to modify:**

- `packages/shared/src/ops.ts` — add `LetNode` and `PipeNode` to `ExprNode` union; extract std lib

### 1b: MEL parser and pretty-printer

The parser converts MEL (Maisie Expression Language, per `docs/grammar.md`) into ExprNode trees. The pretty-printer converts ExprNode trees back to readable MEL. Both are needed from day one — the entity editor (Phase 4) accepts MEL source, not JSON.

**Files to create:**

- `packages/shared/src/parser.ts` — recursive descent parser
  - Input: string (`home-assistant.list_switches | filter: name contains "exterior"`)
  - Output: `ExprNode` tree (or `EntityDef` for `define` blocks)
  - Implements the full grammar from `docs/grammar.md`: pipes, let bindings, if/then/else, lambdas, field access, comparisons, arithmetic, define blocks
- `packages/shared/src/printer.ts` — pretty-printer
  - `printExpr(node: ExprNode): string`
  - `printEntity(entity: EntityDef): string`
  - Round-trip: `parse(print(parse(input))) === parse(input)`
- `packages/shared/src/__tests__/parser.test.ts` — round-trip tests, edge cases, error messages

**Proof of concept:** Parse this string into an ExprNode tree, evaluate it with a mock resolver, get the correct result:

```
let switches = home-assistant.list_switches | filter: name contains "exterior"
switches | pluck: state
```

**Estimated scope:** 4–5 sessions.

---

## Phase 2a: Entity Types + Registry + Plugin Bridge

**Goal:** Define `EntityDef` as a TypeScript type, build the entity registry, and bridge existing PluginActions into entities automatically at boot.

**What ships:** The `EntityDef` type, the `EntityRegistry` class, and automatic synthesis of entities from plugin actions. The catalog starts returning entities instead of raw action descriptors (backward-compatible — the shape is a superset).

### Key abstraction

```typescript
interface EntityDef {
  name: string
  description?: string
  source: 'plugin' | 'derived'
  pluginName?: string
  section?: string
  fields: Record<string, FieldDef>
}

interface DataFieldDef {
  kind: 'data'
  type: MaisieFieldType | 'record' | 'collection'
  expression?: ExprNode        // for derived fields
  actionName?: string          // for base fields
}

interface FunctionFieldDef {
  kind: 'function'
  params: { name: string; type: MaisieFieldType }[]
  returnType: MaisieFieldType | 'record' | 'collection'
  expression?: ExprNode        // for derived functions
  actionName?: string          // for base functions
  tier: 'inform' | 'advise' | 'act'
}

type FieldDef = DataFieldDef | FunctionFieldDef
```

**Files to create:**

- `packages/shared/src/entity.ts` — `EntityDef`, `FieldDef`, `DataFieldDef`, `FunctionFieldDef` types; `validateEntityDef()` function
- `packages/plugin-core/src/entity-registry.ts` — `EntityRegistry` class
  - `register(entity: EntityDef): void` — validates and indexes
  - `get(name: string): EntityDef | undefined`
  - `list(): EntityDef[]`
  - `findByInterface(fields: Record<string, MaisieFieldType>): EntityDef[]`
  - `findBySection(section: string): EntityDef[]`
  - At boot: walks registered plugins and synthesizes `EntityDef` from `PluginAction` definitions

**Files to modify:**

- `packages/plugin-core/src/registry.ts` — after plugin registration, feed actions into `EntityRegistry`
- `packages/plugin-core/src/actions.ts` — `getCardCatalog` queries `EntityRegistry` instead of walking `_loadedPlugins` directly (backward-compatible `CardDescriptor` shape preserved)

**Proof of concept:** Start the server. `GET /api/cards/catalog` returns the same entries as before, but now they're backed by the entity registry. `EntityRegistry.list()` returns entities for every plugin action with `ui !== false`.

**Estimated scope:** 2–3 sessions.

---

## Phase 2b: Persistence + CRUD API + Address Resolver

**Goal:** Persist derived entities to SQLite, provide a CRUD API, and wire the address resolver so that `GET /api/entities/exterior-lights/switches` evaluates a derived entity's expression against live data.

**What ships:** The `derived_entities` table, Hono routes for entity CRUD, and the address resolver connecting entity fields to live data.

**Known gap from Phase 1 — must be addressed here:** Predicate scope in pipeline ops. When MEL source is `collection | filter: name contains "x"`, the predicate's bare identifier `name` needs to resolve to each item's `name` field during evaluation. Phase 1 handles this correctly for JS-function predicates (used in tests) but the async evaluator must extend the environment with item fields when evaluating a predicate inside a collection op. The address resolver should push a "collection item scope" onto the env before calling each predicate — bare identifier refs resolve to item fields, with explicit `self.` or dotted paths still falling through to the resolver. Add tests for: `list | filter: state == "on"`, `list | sort: addedAt desc`, `list | map: (x) => x.name` (both the shorthand bare-field and explicit-lambda forms).

**Files to create:**

- `packages/plugin-core/src/derived-entity-store.ts` — SQLite persistence
  - Drizzle table `derivedEntities`: `id`, `name`, `description`, `fields` (JSON), `createdAt`, `updatedAt`
  - `save(entity: EntityDef): Promise<void>`
  - `loadAll(): Promise<EntityDef[]>`
  - `delete(name: string): Promise<void>`
- `packages/plugin-core/src/address-resolver.ts` — runtime address resolver
  - Implements `AddressResolver` interface from Phase 1
  - `resolve(address: string)` — parses address, looks up entity in registry, evaluates field (calls plugin action for base, evaluates expression for derived)
  - `invoke(address: string, args)` — for function fields
- `packages/plugin-core/src/entity-routes.ts` — Hono routes
  - `GET /api/entities` — list all entities (base + derived)
  - `GET /api/entities/:name` — get one entity def
  - `POST /api/entities` — create derived entity (accepts surface syntax or JSON)
  - `PUT /api/entities/:name` — update derived entity
  - `DELETE /api/entities/:name` — delete derived entity
  - `GET /api/entities/:name/:field` — resolve a data field to live value
  - `POST /api/entities/:name/:field` — invoke a function field

**Files to modify:**

- `packages/agent/src/services/schema.ts` — add `derivedEntities` table
- `packages/agent/src/api/index.ts` — mount entity routes

**Proof of concept:** `POST /api/entities` with:

```
define exterior-lights {
  description: "Front and back exterior light switches"
  switches: collection = home-assistant.list_switches | filter: name contains "exterior"
}
```

Then `GET /api/entities/exterior-lights/switches` returns live switch data. `GET /api/cards/catalog` includes `exterior-lights`.

**Estimated scope:** 3–4 sessions.

---

## Phase 3: Self-References + Safety Tiers

**Goal:** Support `self` in derived entity expressions. Infer safety tiers for derived function fields.

**Dependency:** Phase 2b.

**Files to create:**

- `packages/shared/src/safety.ts` — safety tier inference
  - `inferTier(expression: ExprNode, registry: EntityRegistry): 'inform' | 'advise' | 'act'`
  - Walks expression tree, finds all function invocations, resolves their tiers, returns the max
  - Tier ordering: `inform` < `act` < `advise`
- `packages/shared/src/__tests__/safety.test.ts`

**Files to modify:**

- `packages/plugin-core/src/address-resolver.ts` — add `self` resolution; when evaluating a derived entity's field, bind `self` to a lazy proxy that resolves `self.{field}` by evaluating the entity's own fields; cycle detection (if resolving field A requires field A, throw)
- `packages/plugin-core/src/entity-registry.ts` — validate `self` references target existing fields; compute and cache safety tiers at registration

**Proof of concept:** Create the full `exterior-lights` entity from `docs/model.md` with `switches`, `sync_toggle`, `on`, `off`. `POST /api/entities/exterior-lights/sync_toggle` reads `self.switches`, evaluates the let bindings, and calls the right function on each switch. Safety tier of `sync_toggle` is inferred as `act` (or `advise` depending on HA action tiers).

**Estimated scope:** 2 sessions.

---

## Phase 4: Entity Editor/IDE

**Goal:** A CodeMirror 6 editor in the dashboard for writing, testing, and saving derived entity definitions.

**Dependency:** Phase 2b. Can start as soon as 2b lands. Benefits from Phase 3 (`self` support) but doesn't require it.

**Why CodeMirror 6:** Modular, tree-shakeable, ~130KB gzipped. Supports custom language modes, autocomplete, linting, and bracket matching through composable extensions. Monaco is 2–3MB and overkill for an embedded editor.

### 4a: Editor + syntax highlighting + eval (2–3 sessions)

**Files to create:**

- `packages/dashboard/src/pages/EntityEditorPage.tsx` — dashboard page wrapper
- `packages/dashboard/src/components/EntityEditor.tsx` — the main editor component
  - CodeMirror 6 with line numbers, bracket matching, dark theme
  - Split layout: editor left, result panel right
  - Toolbar: Run, Save, entity name/description inputs
  - On Run: sends surface syntax to `POST /api/eval`, displays result via `FieldRenderer`
  - On Save: sends to `POST /api/entities`, entity appears in catalog
- `packages/dashboard/src/lib/editor/maisie-language.ts` — Lezer grammar for the expression language
  - Tokenizes keywords, operators, identifiers, strings, numbers, pipe ops
  - CodeMirror 6 `LanguageSupport` for syntax highlighting
  - Token categories mapped per `docs/grammar.md` section 6
- `packages/dashboard/src/lib/editor/maisie-theme.ts` — dark theme matching dashboard
- `packages/dashboard/src/styles/editor.css` — editor layout and panel styles

**Server endpoint:**

- `POST /api/eval` in `packages/plugin-core/src/eval-routes.ts`
  - Accepts `{ source: string }` (surface syntax) or `{ expression: ExprNode }` (JSON)
  - Parses (if surface syntax), evaluates with `evalExprAsync`, returns `{ result, type }` or `{ error }`

**Files to modify:**

- `packages/dashboard/src/App.tsx` — add route for editor page, nav link

### 4b: Autocomplete from live catalog (1 session)

**Files to create:**

- `packages/dashboard/src/lib/editor/maisie-completion.ts` — CodeMirror 6 autocomplete source
  - Fetches entity catalog on mount: `GET /api/entities`
  - After `.`: offers field names for the entity before the dot
  - After `|`: offers pipeline operators
  - Bare identifiers: offers entity names and function names
  - Completion items include type information

### 4c: Inline errors and type preview (1 session)

**Files to create:**

- `packages/dashboard/src/lib/editor/maisie-linter.ts` — CodeMirror 6 linter extension
  - On debounced change, sends to `POST /api/eval/validate`
  - Marks errors inline (underline, hover tooltip)
  - Shows inferred types as inline hints

**Server endpoint addition:**

- `POST /api/eval/validate` — parses and type-checks without executing; returns `{ valid, errors[], inferredType }`

**Proof of concept:** Open the Entity Editor page. Type:

```
define exterior-lights {
  description: "Front and back exterior light switches"
  switches: collection = home-assistant.list_switches | filter: name contains "exterior"
  on: function() = self.switches | map: (sw) => sw.turn_on()
}
```

See syntax highlighting. Get autocomplete for `home-assistant.` (lists HA entities). See `switches` evaluate in the result panel with live data. Click Save. Entity appears in catalog. The card wizard can create a card for it.

**Estimated scope:** 4–5 sessions total.

---

## Phase 5: Event Propagation

**Goal:** When a base entity's state changes, derived entities that reference it are invalidated and dashboard components re-render.

**Dependency:** Phase 2b. Uses the existing MQTT infrastructure (not SSE — the dashboard already has a working MQTT WebSocket connection via `useMqtt`).

**Files to create:**

- `packages/plugin-core/src/entity-dependency-graph.ts` — tracks which derived entities depend on which base entities (extracted from expression trees at registration). When a base entity emits an MQTT event, identifies all affected derived entities.
- `packages/plugin-core/src/entity-events.ts` — subscribes to MQTT topics from base entities; on event, walks dependency graph and publishes invalidation events for affected derived entities on MQTT topics like `home/entity/{name}/invalidated`
- `packages/dashboard/src/hooks/useEntitySubscription.ts` — hook that subscribes to entity invalidation topics via the existing `useMqtt`; triggers re-fetch for cards bound to that entity

**Files to modify:**

- `packages/plugin-core/src/entity-registry.ts` — build dependency graph at registration
- `packages/dashboard/src/components/DynamicCard.tsx` — use `useEntitySubscription` when card is entity-backed (replaces polling with push + on-demand fetch)

**Proof of concept:** Toggle an HA light switch via the HA app. The `exterior-lights.switches` field in the dashboard updates within 1–2 seconds without polling.

**Estimated scope:** 3 sessions.

---

## Phase 6: Catalog as Entity

**Goal:** The catalog becomes a queryable entity. `catalog | filter: fields contains { toggle: function() }` works.

**Dependency:** Phase 2b.

**Files to modify:**

- `packages/plugin-core/src/entity-registry.ts` — register a synthetic `catalog` entity at boot. Its `items` field evaluates to the collection of all `EntityDef` records. Type: `collection<entity-descriptor>`.
- `packages/shared/src/entity.ts` — define `EntityDescriptor` record type (name, description, fields, source, section)

**Proof of concept:** In the entity editor, type `catalog | filter: (e) => e.section == "smarthome"` and see all smart home entities.

**Estimated scope:** 1 session.

---

## Phase 7: Wizard Evolution

**Goal:** The card wizard becomes a recursive tree editor for rendering configs, understanding entities with both data and function fields.

**Dependency:** Phase 2b + Phase 4 (parser exists for expression editing within wizard).

**Files to modify:**

- `packages/dashboard/src/components/CardWizard.tsx` — Step 1 browses entities (not just plugin actions). Step 2 is optional for derived entities with baked-in pipelines. Step 3 becomes recursive: for each field show available components, allow nested config for record/collection sub-fields.
- `packages/dashboard/src/lib/component-options.ts` — add options for `function` type fields: button, toggle, slider, search box, form (based on parameter signature)
- `packages/dashboard/src/components/DynamicCard.tsx` — render function fields: no-param → button, boolean-return → toggle. Clicking invokes via entity API.

**Proof of concept:** Select `exterior-lights` in wizard. See fields: `switches` (collection), `sync_toggle` (function), `on` (function), `off` (function). Configure `switches` as Table with per-column renderers. Configure functions as Buttons with custom labels. Save. Card renders with interactive switches and function buttons.

**Estimated scope:** 3–4 sessions.

### Phase 7 — What shipped

- Function field rendering in `DynamicCard` (button invocation via `/api/entities/{name}/{field}`)
- Wizard function field discovery and display in Step 1
- Derived entities in `getCardCatalog` — appear in Step 1 catalog browser
- `DynamicCard` routes derived entity fetches to `/api/entities/{id}/{field}` and unwraps `{value}`
- Wizard Step 2 skipped for derived entities (pipeline baked into entity expression)
- `CardDescriptor.pluginName` made optional to distinguish derived vs plugin entities

### Phase 7 — Remaining work (follow-up)

- **Step 3 recursive tree editor**: For each field in a record/collection response, allow selecting a component and configuring nested sub-fields. This was deferred from Phase 7 because it is a substantial standalone piece of work. Currently Step 3 shows flat field selection and renderer overrides; the recursive config (e.g. per-column renderers for a table within a derived entity's collection field) requires a deeper wizard redesign.
- **Derived entity output field introspection**: Currently `outputFields` is always empty for derived entities in the catalog. A follow-up could evaluate the entity's expression against a sample to infer the field shape at wizard time, populating `outputFields` so Step 3 can offer per-field renderer config.

---

## Backward Compatibility

Nothing breaks at any phase:

- **PluginAction**: untouched. Plugins work exactly as today.
- **Sync `evalExpr` and `compileOp`**: stay in `ops.ts`, continue powering client-side pipeline.
- **`CardDescriptor` / `CardConfig`**: unchanged shape. Entity registry generates these for compat.
- **`DynamicCard` and `FieldRenderer`**: unchanged until Phase 7, and those changes are additive.
- **`CardWizard`**: unchanged until Phase 7.
- **All dashboard pages and hand-coded cards**: unchanged.
- **MQTT event bus**: unchanged, just new subscribers.
- **Drizzle schema**: additive (new table, no changes to existing).

---

## Estimated Total

| Phase | Sessions | Cumulative |
|-------|----------|------------|
| 1: Evaluator + Parser | 4–5 | 4–5 |
| 2a: Entity types + registry | 2–3 | 6–8 |
| 2b: Persistence + API + resolver | 3–4 | 9–12 |
| 3: Self-refs + safety | 2 | 11–14 |
| 4: Entity editor | 4–5 | 15–19 |
| 5: Events | 3 | 18–22 |
| 6: Catalog entity | 1 | 19–23 |
| 7: Wizard evolution | 3–4 | 22–27 |

Phases 3–7 are parallel after 2b. Realistic total for a solo developer: **22–27 focused sessions**.
