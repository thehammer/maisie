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

## Estimated Total

| Sub-phase | Sessions | Cumulative |
|-----------|----------|------------|
| 3a: Canvas Surface + Palette | 3 | 3 |
| 3b: Contract Inference + Auto-Wire | 3 | 6 |
| 3c: Live Preview + Data Binding | 2 | 8 |
| 3d: Link DSL + Transforms | 3 | 11 |
| 3e: Composed Artifact Emission | 3 | 14 |
| 3f: Self-Hosting | ongoing | — |

Realistic total for the core canvas experience: **12–14 sessions** plus ongoing self-hosting work.

---

## What Phase 4 (Agent Platform) Inherits

Once visual authoring ships, the agent gains something concrete: it can *propose* canvas compositions. When the agent wants to add a card for a new concern (overdue packages, weekly trends), it can construct a canvas document, validate it against the registries, and surface it to the user as a preview — exactly the same artifact a human would produce. Generic agent tools (`resolve_address`, `invoke_address`, `run_pipeline`) plus canvas document construction give the agent full authoring capability.
