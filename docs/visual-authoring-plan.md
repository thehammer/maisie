# Visual Authoring — Implementation Plan

*Last updated 2026-04-23*

Phased implementation plan for Phase 3 (Visual Authoring) described in `docs/super-plan.md`. Builds on the entity model (Phase 1) and the component model (Phase 2). Each sub-phase is deployable on its own. The existing Studio MEL editor continues to work throughout.

**Reference documents:**
- `docs/super-plan.md` — Phase 3 goals (master)
- `docs/model.md` — entity model reference
- `docs/components.md` — component model reference
- `docs/grammar.md` — MEL formal grammar
- `docs/implementation-plan.md` — entity model implementation (Phase 1 record)
- `docs/components-implementation-plan.md` — component model implementation (Phase 2 record)

---

## Goal

A visual surface where entities and components are designed by direct manipulation. The structural type system makes this practical: compositions that aren't sensible are caught before they fail. The goal is bidirectional, outward-from-anywhere authoring — start with data, start with presentation, or work both sides toward a middle, supported throughout by the type system.

**Primary outcomes:**

1. A **canvas** page in Studio where entities and components can be arranged, connected, and previewed live
2. **Auto-wire with inference** — unambiguous contract matches connect silently
3. A **link DSL** — a mini expression language for resolving ambiguous bindings and field transforms
4. **Live preview** — the canvas shows the rendered result using the existing ComponentRenderer
5. **Paired-artifact emission** — composing on the canvas produces both a derived component and a derived entity contract, saveable to the catalog
6. **Self-hosting (long-term)** — the canvas, palette, and inspector are themselves authored components

---

## Dependency Graph

```
3a: Canvas Surface + Palette
   ↓
3b: Contract Inference + Auto-Wire
   ↓
3c: Live Preview + Data Binding
   ↓
3d: Link DSL + Transforms        (can start after 3b)
   ↓
3e: Composed Artifact Emission
   ↓
3f: Self-Hosting                 (incremental, runs alongside later phases)
```

Sub-phases 3a–3c form the minimum viable canvas. 3d and 3e add the real power (ambiguity resolution and composition output). 3f is a standing goal, not a time-bounded phase.

**Estimated total for 3a–3e: 12–18 sessions.**

---

## Phase 3a — Canvas Surface + Palette

**Goal:** A three-pane Studio layout with a palette (left), a canvas (center), and an inspector (right). Items drag from the palette to the canvas. Canvas state is a document.

### What ships

- New "Canvas" tab inside the Studio alongside the existing MEL editor
- Left palette: lists all entities and components from the catalog, grouped by kind (entities, base components, layout primitives, derived components)
- Drag from palette → canvas creates a "placement" in the canvas state
- Click a placement to select it; the inspector shows its details
- Delete selected placement (Backspace / delete button)
- Canvas state persisted client-side; save-to-server is deferred to 3e

### Canvas document model

```typescript
interface CanvasDocument {
  version: 1
  placements: Placement[]
  wires: Wire[]          // filled in 3b+
}

interface Placement {
  id: string             // uuid
  kind: 'entity' | 'component'
  targetName: string     // entity name or component name
  position: { x: number; y: number }
  config?: Record<string, unknown>  // optional component props, entity ops
}

interface Wire {
  id: string
  source: { placementId: string; field?: string }
  target: { placementId: string; slot?: string }
  transform?: LinkExpr   // from 3d; undefined = identity/auto-wire
}
```

### Files to create

- `packages/dashboard/src/pages/StudioPage.tsx` — add tab switcher for Editor / Canvas
- `packages/dashboard/src/components/canvas/Canvas.tsx` — the canvas surface
- `packages/dashboard/src/components/canvas/Palette.tsx` — left panel
- `packages/dashboard/src/components/canvas/Inspector.tsx` — right panel
- `packages/dashboard/src/components/canvas/Placement.tsx` — draggable node on canvas
- `packages/dashboard/src/lib/canvas/document.ts` — CanvasDocument type + helpers (addPlacement, removePlacement, movePlacement, etc.)
- `packages/dashboard/src/hooks/useCanvasDocument.ts` — React state hook for the canvas document

### Tests

- `packages/dashboard/src/lib/canvas/__tests__/document.test.ts` — document operations: add, remove, move, connect; id generation; immutability

### Proof of concept

Open Studio → Canvas tab. See all entities and components in the palette. Drag `home-assistant.list_switches` onto the canvas → a placement appears. Drag `Strip` onto the canvas → another placement appears. Click either → inspector shows its input contract, output, props. Delete a placement → it disappears.

### Estimated scope

3 sessions.

---

## Phase 3b — Contract Inference + Auto-Wire

**Goal:** When two placements are dropped on (or connected via UI), check structural compatibility. Unambiguous matches auto-wire. Ambiguities surface for user resolution.

### What ships

- Drop detection: dragging one placement onto another creates a candidate wire
- Explicit connect UI: click-and-drag from source placement's "output" port to target's "input" port
- Contract check via `satisfies(sourceType, targetInput)` from Phase 2d
- Result states:
  - **Green (auto-wire)** — compatible; wire persists
  - **Yellow (ambiguous)** — multiple fields match; user picks
  - **Red (incompatible)** — no match; error with missing/wrong fields listed
- Wires render visually as connecting lines between placements

### Wire state

```typescript
type WireStatus = 'compatible' | 'ambiguous' | 'incompatible'

interface WireValidation {
  status: WireStatus
  errors?: MatchError[]           // from satisfies()
  candidates?: FieldMapping[]     // when ambiguous
}
```

### Files to create

- `packages/dashboard/src/lib/canvas/wire-validator.ts` — validates a wire, returns WireValidation
- `packages/dashboard/src/components/canvas/Wire.tsx` — SVG line/curve between placements with color by status
- `packages/dashboard/src/components/canvas/AmbiguityPopover.tsx` — UI for resolving ambiguous matches

### Files to modify

- `packages/dashboard/src/components/canvas/Canvas.tsx` — wire rendering + drop-to-connect interactions
- `packages/dashboard/src/components/canvas/Placement.tsx` — add "output" / "input" ports

### Tests

- Wire validator: compatible, ambiguous, incompatible scenarios with realistic entity/component pairs
- End-to-end: drag entity onto component → wire validates correctly

### Proof of concept

Drag `plex.list_recently_added` onto canvas. Drag `Strip` onto canvas. Drag from Plex's output to Strip's input. Wire turns yellow with "pick a compatible tile component". Drag `DefaultTile` onto canvas; wire it to Strip's itemComponent prop. Everything turns green.

### Estimated scope

3 sessions.

---

## Phase 3c — Live Preview + Data Binding

**Goal:** The canvas shows the rendered output of the current composition using real data.

### What ships

- Preview pane attached to the canvas (or switchable between canvas and preview views)
- For each placement wired with green wires all the way to an entity source, render it via `ComponentRenderer` using the resolved entity data
- Synthetic fixtures for unresolved or incomplete compositions — sample data generated from the entity's declared type contract
- Live updates as the canvas changes (debounced)

### Files to create

- `packages/dashboard/src/components/canvas/Preview.tsx` — the preview surface
- `packages/dashboard/src/lib/canvas/fixture-generator.ts` — generate synthetic MaisieValue from a TypeExpr for preview fallback
- `packages/dashboard/src/lib/canvas/preview-compiler.ts` — compile canvas document → list of (placement, resolved data) pairs for rendering

### Files to modify

- `packages/dashboard/src/components/canvas/Canvas.tsx` — integrate preview pane

### Tests

- Fixture generator: scalar types produce sensible values (strings get "Example", numbers get 42, URLs get a placeholder URL, timestamps get now); records populate every field; collections get 3-item samples
- Preview compiler: picks correct rendering for each placement

### Proof of concept

With Plex → Strip → DefaultTile wired from 3b, the preview pane shows a horizontal scroll of movie cards with real recently-added data.

### Estimated scope

2 sessions.

---

## Phase 3d — Link DSL + Transforms

**Goal:** When contracts don't cleanly match, allow users to insert transform steps between placements. Transforms are expressions that reshape data to fit a target's contract.

### Link DSL

A small language for field mappings and transforms. Stored as an ExprNode and evaluated at render time.

```typescript
// Grammar additions (extends MEL)

link_expr := pick_expr | rename_expr | compute_expr | chain_expr
pick_expr    := "pick" "{" field_list "}"                  // project to subset
rename_expr  := "rename" "{" (from "->" to)* "}"           // rename fields
compute_expr := "compute" "{" (name ":" expression)* "}"   // add derived fields
chain_expr   := link_expr "|>" link_expr                   // compose transforms
```

Serialized as ExprNode (reusing Apply and Lambda forms). Visual editor produces the expression tree; users never need to write it by hand.

### What ships

- Transform node type in the canvas (a pill-shaped node between two placements)
- Transform editor UI: panel in the inspector for editing the transform
- "Add transform" action on a wire that's incompatible or ambiguous
- Transform types: pick, rename, compute, chain
- Transform evaluation: runs at render time, using the same evaluator

### Files to create

- `packages/dashboard/src/lib/canvas/link-expr.ts` — the link expression types + compiler to ExprNode
- `packages/dashboard/src/components/canvas/Transform.tsx` — visual transform node
- `packages/dashboard/src/components/canvas/TransformEditor.tsx` — inspector panel for editing a transform

### Files to modify

- `packages/dashboard/src/components/canvas/Wire.tsx` — render transforms as nodes on the wire path
- `packages/shared/src/parser.ts` — add pick/rename/compute productions (optional — if the visual editor always produces ExprNode directly, grammar extension isn't strictly needed)
- `packages/dashboard/src/components/canvas/AmbiguityPopover.tsx` — offer "add transform" option

### Tests

- link-expr: pick/rename/compute produce correct ExprNode trees
- Evaluation: transforms applied to real records produce the expected output

### Proof of concept

Bind `plex.list_recently_added` to a `MovieTile` that expects `{title, coverUrl, rating}`. The recent list has `title` and `thumbUrl` but not `rating`. The wire is red. Add a transform: rename `thumbUrl` → `coverUrl`, compute `rating: "ok"` (literal). Wire turns green. Preview renders correctly.

### Estimated scope

3 sessions.

---

## Phase 3e — Composed Artifact Emission

**Goal:** "Save" a canvas composition as durable artifacts — a derived component, a derived entity, or both.

### What ships

- Save button on the canvas with two modes: "Save as component" / "Save as entity"
- Canvas document → ComponentDef conversion for component save
- Canvas document → EntityDef conversion for entity save
- The composed component takes the wired data as input; its render tree is synthesized from the canvas layout
- The composed entity is a derived entity whose fields match the wired outputs
- Artifacts appear in the catalog immediately (resolver cache refresh)

### Rules for artifact synthesis

**Component emission:**
- Input contract inferred from what's wired to the root component in the canvas
- Props: any unconfigured inputs of the root
- Render tree: the root component's render, with wire-connected data substituted

**Entity emission:**
- For a canvas that produces a collection or record, emit a derived entity wrapping the whole pipeline
- Entity's data field is the derivation expression (pipeline + transforms)

**Both:**
- When the canvas composes a container (like Strip) with a parameterized tile, emit both: the component parameterized by tile, and the entity whose output shape satisfies Strip's input

### Files to create

- `packages/dashboard/src/lib/canvas/emit.ts` — canvas → artifact converters
  - `emitComponent(doc: CanvasDocument): ComponentDef`
  - `emitEntity(doc: CanvasDocument): EntityDef`
  - `canEmitComponent(doc): boolean`, `canEmitEntity(doc): boolean`

### Files to modify

- `packages/dashboard/src/components/canvas/Canvas.tsx` — Save action
- `packages/dashboard/src/components/canvas/Inspector.tsx` — show emission status and options

### Tests

- emit: canvas → ComponentDef round-trips through the parser/printer
- canEmit: detects valid vs. incomplete canvases

### Proof of concept

Build the full "movie strip" composition on canvas: `plex.list_recently_added` → `MovieTile` (via transform) → `Strip`. Click "Save as component" → `MovieStrip` appears in the catalog. Click "Save as entity" → `recent-movies-view` appears in the catalog. Add `MovieStrip(input: recent-movies-view)` as a card → it renders on the dashboard.

### Estimated scope

3 sessions.

---

## Phase 3f — Self-Hosting

**Goal:** The Studio UI is itself composed from authored entities and components. Canvas state is an entity; drag targets, property panels, and the palette are components.

### Strategy

This is incremental, not a time-bounded phase. The approach:

1. **Identify reusable patterns** — the palette is a filtered list of entities; the inspector is a record renderer; the canvas is a composed view. Each is a candidate for "author this as a component."

2. **Author one at a time** — start with the simplest (palette), replace the hand-coded React with an authored component binding, verify it works, move on.

3. **Prove composability** — by the time the core Studio pieces are authored, Maisie is running its own authoring tool. That's the proof of concept.

### What ships per iteration

- One previously-hand-coded component replaced with an authored component
- The authored artifact persists in the catalog and is loaded at dashboard boot
- The hand-coded version is removed

### Order of attack (proposed)

1. **Palette** — entities and components are catalog.items filtered by section; render with a simple list-group component
2. **Inspector** — each selected placement's details are a record; render via `DefaultTile` initially, then a custom `PlacementInspector` component
3. **Canvas preview** — the preview pane is a `ComponentRenderer` bound to the selected placement's resolved data
4. **Placement node** — each placement is a `CanvasNode` component with input/output ports as function fields

### Scope

No fixed estimate. Each iteration is 1–2 sessions. Target: one authored replacement per week after 3e lands, tracking until the canvas itself is self-hosted.

---

## Backward Compatibility

Nothing breaks at any sub-phase:

- **Studio MEL editor**: unchanged. Gains a Canvas tab alongside; users can use either.
- **Dashboard rendering**: unchanged. Cards render via DynamicCard + ComponentRenderer as today.
- **Entity API**: unchanged. Canvas save emits via existing POST routes.
- **Component API**: unchanged. Canvas save emits via existing POST routes.
- **Plugin actions**: unchanged.
- **Existing tests**: all pass throughout.

---

## Estimated Total (Sub-phases 3a–3f)

| Sub-phase | Sessions | Cumulative |
|-----------|----------|------------|
| 3a: Canvas Surface + Palette | 3 | 3 |
| 3b: Contract Inference + Auto-Wire | 3 | 6 |
| 3c: Live Preview + Data Binding | 2 | 8 |
| 3d: Link DSL + Transforms | 3 | 11 |
| 3e: Composed Artifact Emission | 3 | 14 |
| 3f: Self-Hosting | ongoing | — |

Realistic total for the core canvas experience: **12–14 sessions** plus ongoing self-hosting work.

Sub-phases 3a–3e shipped on 2026-04-23.

---

## Extension — Deep Composition (Sub-phases 3g–3l)

*Added 2026-04-23 after hands-on use of the canvas shipped in 3a–3e.*

The first round of canvas work proved the model but revealed a gap: most plugin entities are typed as loose `record` or `collection`, while components demand specific shapes. Direct structural matches are rare in practice. The pragmatic bridging pattern is `entity → function(s) → component` — transforms reshape the data at each boundary. These sub-phases make that pattern first-class.

### 3g — Richer plugin entity types ✓ COMPLETE 2026-04-13

**Goal:** Plugin entities carry deep TypeExpr outputs derived from their Zod schemas, not coarse `'record'` / `'collection'` strings.

**What ships:**
- `zodToTypeExpr(schema)` — converts a Zod object/array/scalar schema to a `TypeExpr`, preserving `MaisieFieldType` annotations from `field()` (so semantic types like `url`, `timestamp`, `percentage` propagate)
- `synthesizeEntityFromAction` uses the converter to produce a proper typed output
- `EntityDef.DataFieldDef.type` accepts `TypeExpr` (alongside the existing string form for backward compatibility)
- `dataFieldTypeExpr(type)` helper — normalises string or TypeExpr to TypeExpr; exported from `@maisie/shared`
- Type resolver in canvas (`resolveEntityPorts`) uses `dataFieldTypeExpr` instead of the old string-switch

**Files changed:**
- `packages/shared/src/zod-to-type-expr.ts` — converter (new)
- `packages/shared/src/field.ts` — fixed `getMaisieType` for Zod v4 (description is an own getter, not in `_def`)
- `packages/shared/src/entity.ts` — `DataFieldDef.type` broadened; `dataFieldTypeExpr` added
- `packages/shared/src/index.ts` — exports `zod-to-type-expr`
- `packages/plugin-core/src/entity-registry.ts` — uses `zodToTypeExpr(action.output)` in synthesis
- `packages/dashboard/src/lib/canvas/type-resolver.ts` — uses `dataFieldTypeExpr` for both string and TypeExpr field types

**Deviations / edge cases:**
- Zod v4 stores `description` as an own getter property on the schema instance, not in `_def.description` — `getMaisieType` fixed to check both paths
- Some test fixtures pass a bare `{ parse: () => ({}) }` as `any` in place of a real Zod schema; `zodToTypeExpr` now guards against non-Zod objects at the top
- `ZodLiteral` in Zod v4 stores values in `_def.values[]` (array), not `_def.value` — handled
- The spec called for a debug log on unknown kinds; removed since it fires on the mock schemas above and adds noise with no benefit

**Tests added:**
- `packages/shared/src/__tests__/zod-to-type-expr.test.ts` — 36 unit tests (scalars, annotated, record, optional, nullable, collection, union, any, depth guard)
- `packages/plugin-core/src/__tests__/zod-type-expr-integration.test.ts` — 8 end-to-end tests (entity synthesis → satisfies)

**Scope:** 1 session (estimated 2–3).

### 3h — Function placements on canvas ✓ COMPLETE 2026-04-13

**Goal:** Functions are first-class canvas items, alongside entities and components. Wires connecting `entity → function → component` become a valid and visible composition.

**What ships:**
- `FunctionDescriptor` type + `STD_FUNCTION_DESCRIPTORS` array in `@maisie/shared` — one entry per std lib op with explicit input TypeExpr, output TypeExpr, and inline parameter declarations
- `Placement.kind` gains `'function'`; canvas supports three placement kinds
- Function placements have input port (left), output port (right), and a parameter panel in the inspector
- `resolveFunctionPorts(id)` — synchronous port resolution from static registry data
- `updatePlacementConfig(doc, id, config)` — helper to merge inline param values onto any placement
- Palette "Functions" section with all 13 std lib functions, visually distinguished with `canvas-palette-item-function` class
- Inspector `FunctionInspector` component: description, per-param input controls (string/number/textarea for lambdas), port summary
- Preview compiler: `resolveValueForPlacement` recursively follows function placements as transform nodes in the chain; each hop calls `applyFunctionPlacement` via `evalExprAsync`
- Emit: `buildSourceExpression` handles function kind — builds an `ApplyNode(fnId, upstream, ...inlineParams)` from `placement.config`

**Files changed:**
- `packages/shared/src/function-registry-data.ts` — FunctionDescriptor types + STD_FUNCTION_DESCRIPTORS (new)
- `packages/shared/src/index.ts` — exports function-registry-data
- `packages/dashboard/src/lib/canvas/document.ts` — Placement.kind extended; updatePlacementConfig added
- `packages/dashboard/src/lib/canvas/type-resolver.ts` — resolveFunctionPorts added
- `packages/dashboard/src/lib/canvas/preview-compiler.ts` — function chain traversal via resolveValueForPlacement + applyFunctionPlacement
- `packages/dashboard/src/lib/canvas/emit.ts` — buildSourceExpression handles function kind
- `packages/dashboard/src/hooks/useCanvasDocument.ts` — updatePlacementConfig wired in
- `packages/dashboard/src/components/canvas/Palette.tsx` — Functions section added
- `packages/dashboard/src/components/canvas/Placement.tsx` — function kind renders with both ports
- `packages/dashboard/src/components/canvas/Canvas.tsx` — resolveFunctionPorts in type resolution; function kind in drag handler
- `packages/dashboard/src/components/canvas/Inspector.tsx` — FunctionInspector added

**Tests added:**
- `packages/shared/src/__tests__/function-registry-data.test.ts` — 24 tests (completeness, shape, types, params, getFunctionDescriptor)
- `packages/dashboard/src/lib/canvas/__tests__/document.test.ts` — function placement tests + updatePlacementConfig tests
- `packages/dashboard/src/lib/canvas/__tests__/type-resolver.test.ts` — resolveFunctionPorts tests
- `packages/dashboard/src/lib/canvas/__tests__/preview-compiler.test.ts` — function chain tests (entity→limit→component, double-hop, no-upstream fallback)
- `packages/dashboard/src/lib/canvas/__tests__/emit.test.ts` — entity→function→component emit tests

**Deviations / notes:**
- Lambda params in config are stored as raw strings; the preview-compiler passes them as string literals to the evaluator rather than parsing them as MEL expressions. Full lambda evaluation from the inspector textarea is deferred to a future iteration (parser integration is non-trivial and out of scope for 3h).
- `canEmitComponent`/`canEmitEntity` work unchanged — function placements always have outgoing wires so they're never the root.
- 1363 tests pass, typecheck clean, dashboard builds.

**Scope:** 1 session (estimated 3).

### 3i — Split palette with compatibility highlighting ✓ COMPLETE 2026-04-13

**Goal:** Entities on the left, components on the right, functions in a middle dock (collapsible). Selecting any placement highlights compatible items in the opposite palette.

**What ships:**
- Split palette layout: entity palette on left, canvas + function dock in center, component palette on right
- `EntityPalette.tsx`, `ComponentPalette.tsx`, `FunctionPalette.tsx` — replaces monolithic `Palette.tsx`
- `palette-sort.ts` — `classifyCompatibility`, `sortByCompatibility`, `annotateCompatibility` (pure functions)
- Compatibility badge per palette item: green (direct), yellow (chain/bridgeable), gray (incompatible/unknown)
- Sort within each group: compatible first, chain next, incompatible/unknown below
- Selection drives highlighting in both directions:
  - Entity selected → ComponentPalette highlights components that accept its output; FunctionPalette highlights functions that accept it as input
  - Component selected → EntityPalette highlights entities whose output satisfies the input; FunctionPalette highlights functions whose output feeds it
  - Function selected → EntityPalette shows functions-as-input, ComponentPalette shows functions-as-output
- Inspector overlays the component palette column when a placement or wire is selected
- Compatibility legend bar appears when any highlighting is active
- FunctionPalette is a collapsible horizontal dock at the bottom of the canvas center column
- Catalog-level type caches (`entityOutputTypes`, `componentInputTypes`) built from placement port resolution

**Deviations / notes:**
- `any` TypeExpr returns `compatible` (not `chain`) because `satisfies(any, X)` is already ok — the chain heuristic only fires on same-kind structural mismatches (record↔record, collection↔collection with incompatible elements)
- Inspector moved to an overlay on the right column rather than a permanent third pane; this keeps the component palette always visible and the inspector slides over it on selection
- Palette.tsx preserved unchanged (backward compat); the three new palette components are imported directly in Canvas.tsx

**Tests added:**
- `packages/dashboard/src/lib/canvas/__tests__/palette-sort.test.ts` — 24 tests covering classifyCompatibility, sortByCompatibility, annotateCompatibility, and an integration sort scenario

**Scope:** 1 session (estimated 2).

### 3j — Auto-suggest transform chains ✓ COMPLETE 2026-04-13

**Goal:** When direct compatibility fails, the system proposes function chains that bridge the source to the target.

**What ships:**
- `findBridgingChains(sourceType, targetType, maxDepth = 3)` — BFS over function signatures, returns candidate chains of function calls that compose to bridge the two types
- Popover on clicking an incompatible (red) wire: shows suggested chains with an Apply button
- One-click apply inserts the function placements and wires into the canvas
- Multiple suggestions sorted by chain length; user picks (up to 5 shown)
- Deduplication via visited-set on head-type fingerprint prevents BFS explosion

**Files changed:**
- `packages/dashboard/src/lib/canvas/chain-search.ts` — `findBridgingChains`, `inferFunctionOutput`, `ChainStep`, `BridgingChain`
- `packages/dashboard/src/lib/canvas/wire-validator.ts` — `WireValidation.suggestedChains` field; calls `findBridgingChains` on incompatible wires
- `packages/dashboard/src/lib/canvas/document.ts` — `applyChain` function; inserts fn placements + wires, positions evenly between source and target
- `packages/dashboard/src/components/canvas/ChainSuggestionPopover.tsx` — popover component
- `packages/dashboard/src/components/canvas/Canvas.tsx` — chain suggestion state, wire click handler, popover integration
- `packages/dashboard/src/hooks/useCanvasDocument.ts` — exposed `setDoc` for bulk document replacement
- `packages/dashboard/src/styles.css` — `.chain-suggestion-*` styles

**Tests added:**
- `packages/dashboard/src/lib/canvas/__tests__/chain-search.test.ts` — 18 tests (BFS algorithm, single/multi-step chains, no-chain, maxDepth, dedup, inferFunctionOutput)
- `packages/dashboard/src/lib/canvas/__tests__/document.test.ts` — 11 new `applyChain` tests (wire replacement, placement insertion, chain topology, position interpolation, config, immutability)

**Deviations / notes:**
- Trigger is clicking an incompatible wire (not hover) — click is more intentional and avoids noisy popovers during navigation
- Cache not implemented — BFS is fast enough (< 1 ms for depth 3 over 13 functions); add if profiling shows need
- `inferFunctionOutput` uses an explicit `PASSTHROUGH_FN_IDS` set (filter/sort/limit/unique) to distinguish element-preserving ops from element-transforming ops (pluck/map/group); avoids wrong type inference at search time
- popover anchors to the wire midpoint in canvas-relative coordinates

**Scope:** 1 session (estimated 2–3).

### 3k — Views as first-class catalog entries

**Goal:** The composition of entity + function chain + component becomes a named catalog entry — a **View**.

**What ships:**
- `ViewDef` type: `{ name, description, source: { entity, fieldPath }, chain: FnCall[], component: componentName, componentProps }`
- `views` SQLite table + `ViewStore` (save/loadAll/get/delete) + `viewRegistry`
- `POST /api/views`, `GET /api/views`, `GET /api/views/:name`, `DELETE /api/views/:name`
- Canvas "Save as View" action when the root binds both an entity source and a component
- Views appear in the catalog alongside entities and components
- Cards can bind a View directly — a card's `component` can point at a view name, which resolves to the full chain at render time
- Views are addressable (`views.recent-movies-strip`) and queryable via MEL

**Vocabulary note:** the term "view" is now formal (see `docs/super-plan.md` vocabulary).

**Scope:** 2–3 sessions.

### 3l — Canvas persistence + round-trip editing

**Goal:** Canvas state persists. Any saved entity, component, or view can be reopened in the canvas for editing.

**What ships:**
- `canvasDocuments` SQLite table for work-in-progress (keyed by a session or user id)
- Autosave on meaningful changes (debounced)
- "Edit in canvas" action on any catalog entry — loads the artifact's structure onto the canvas
- Round-trip: emit → reload → modify → re-emit produces equivalent results
- Clear canvas / new canvas affordances

**Scope:** 1–2 sessions.

---

## Dependency Graph (3g–3l)

```
3g (richer types) ──┬─→ 3h (function placements)
                    ├─→ 3i (split palette + highlighting)
                    └─→ 3j (auto-suggest chains) ──┬─→ 3k (Views)
                                                    └─→ 3l (persistence + round-trip)
```

3g is foundational — everything benefits, do first. 3h and 3i can parallel after 3g. 3j depends on 3h (needs function placements to suggest). 3k and 3l can sequence in either order.

---

## Proof-of-concept moment (validates 3g–3l together)

Drag `plex.list_recently_added` onto the canvas. Drag `Strip`. Wire them directly — wire turns yellow, popover suggests *"Add `map` (pluck title, coverUrl, addedAt) + bind to MovieTile."* One click: three placements appear (`list_recently_added` → `map` → `Strip`), all green, preview shows an actual horizontal strip of recent movies. Save as View → `recent-movies-strip` in the catalog → add as a dashboard card → it renders live.

That's the core authoring loop finished.

---

## Estimated Total (3g–3l)

| Sub-phase | Sessions | Cumulative (from 3a) |
|-----------|----------|----------------------|
| 3g: Richer plugin entity types | 2–3 | 16–17 |
| 3h: Function placements | 3 | 19–20 |
| 3i: Split palette + highlighting | 2 | 21–22 |
| 3j: Auto-suggest chains | 2–3 | 23–25 |
| 3k: Views as first-class | 2–3 | 25–28 |
| 3l: Persistence + round-trip | 1–2 | 26–30 |

Extension total: **12–16 sessions** on top of the original 12–14 of 3a–3f.

---

## What Phase 4 (Agent Platform) Inherits

Once visual authoring ships, the agent gains something concrete: it can *propose* canvas compositions. When the agent wants to add a card for a new concern (overdue packages, weekly trends), it can construct a canvas document, validate it against the registries, and surface it to the user as a preview — exactly the same artifact a human would produce. Generic agent tools (`resolve_address`, `invoke_address`, `run_pipeline`) plus canvas document construction give the agent full authoring capability.

With 3g–3l, the agent's proposals can reference saved Views directly — "I noticed you watch movies late at night; want me to pin `recent-movies-strip` to the main dashboard?" becomes a single artifact reference instead of a full composition.
