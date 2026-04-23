# Presentation Platform — Implementation Plan

*Last updated 2026-04-23*

Phased implementation plan for the component model described in `docs/components.md`. Mirrors the structure of `docs/implementation-plan.md` (the entity model plan). Each sub-phase is deployable on its own. All existing dashboard cards continue to work throughout.

**Reference documents:**
- `docs/components.md` — the Component Model reference manual (target state)
- `docs/model.md` — the Entity Model (already implemented; the data side of the pair)
- `docs/grammar.md` — MEL formal grammar (will be extended for component productions)
- `docs/super-plan.md` — master plan; this is Phase 2

---

## Dependency Graph

```
2a: Layout Primitives + Base Component Contract
   ↓
2b: Component DSL (Grammar + Parser)
   ↓
2c: Component Registry + Persistence
   ↓
2d: Structural Contract Matcher (can start in parallel with 2b)
   ↓
2e: Component Rendering Engine (needs 2a + 2b + 2d)
   ↓
2f: Component Catalog Integration
   ↓
2g: Entity-Component Binding + DefaultTile
```

Sub-phases 2b and 2d can proceed in parallel after 2a lands. Everything else is linear.

**Estimated total: 7–10 focused sessions.**

---

## Phase 2a — Layout Primitives + Base Component Contract

**Goal:** Formalize the rendering layer. Existing `FieldRenderer` entries become "base components" with a uniform interface. Layout primitives (stack, row, grid, overlay, scroll, card, spacer) ship as React components with typed props.

**What ships:** A component runtime where base components and layout primitives are first-class entities with declared input contracts. Nothing user-authorable yet — this is the substrate.

### Files to create

- `packages/shared/src/component.ts` — the component type definitions (base, layout, derived — all sharing `ComponentDef`)
  ```typescript
  export type ComponentKind = 'base' | 'layout' | 'derived'
  
  export interface ComponentDef {
    name: string
    kind: ComponentKind
    description?: string
    input?: TypeExpr               // structural input contract
    props?: Record<string, PropDecl>
    render?: ComponentTree         // only for 'derived'
  }
  
  export interface PropDecl {
    type: TypeExpr
    default?: MaisieValue
    description?: string
  }
  
  export type TypeExpr =
    | { kind: 'scalar'; type: MaisieFieldType }
    | { kind: 'record'; fields: Record<string, TypeExpr>; optional?: string[] }
    | { kind: 'collection'; element: TypeExpr }
    | { kind: 'function'; params: Array<{name: string; type: TypeExpr}>; returns: TypeExpr }
    | { kind: 'component'; input?: TypeExpr }   // component-typed prop
    | { kind: 'any' }
  ```

- `packages/dashboard/src/components/layout/` — React implementations of layout primitives
  - `Stack.tsx`, `Row.tsx`, `Grid.tsx`, `Overlay.tsx`, `Scroll.tsx`, `CardContainer.tsx`, `Spacer.tsx`
  - Each takes `children`, basic style props (gap, padding, align, fit)
  - `Overlay.tsx` supports anchored children via a `position` child prop

- `packages/dashboard/src/lib/components/base-registry.ts` — the registry of base components
  - Maps existing `RendererConfig` entries to ComponentDef entries
  - Exports a `BASE_COMPONENTS: Record<string, ComponentDef>` table
  - Input contracts for each (text expects string, gauge expects number, etc.)

- `packages/dashboard/src/lib/components/layout-registry.ts` — registry of layout primitives
  - Maps each layout primitive to a ComponentDef
  - Special `children` prop typed as `collection<component>`

### Files to modify

- `packages/shared/src/index.ts` — export `component.ts`

### Tests

- `packages/shared/src/__tests__/component.test.ts` — type validation for ComponentDef structure
- `packages/dashboard/src/lib/components/__tests__/base-registry.test.ts` — every base component has a valid ComponentDef

### Proof of concept

At the end of 2a, the dashboard has a programmatic way to describe every base component and layout primitive. Nothing user-visible changes yet.

### Estimated scope

1–2 sessions.

---

## Phase 2b — Component DSL (Grammar + Parser)

**Goal:** Extend MEL grammar to support component definitions. `define name { input, props, render }` parses as a `ComponentDef` with a typed render tree.

### Grammar extensions (in `docs/grammar.md`)

New productions:

```
definition  := "define" name "{" member* "}"
member      := description_field
             | data_field        (already exists — for entities)
             | function_field    (already exists — for entities)
             | props_field       NEW
             | input_field       NEW
             | render_field      NEW

props_field   := "props" ":" "{" prop_decl* "}"
prop_decl     := name ":" type_expr ("=" expression)?
input_field   := "input" ":" type_expr
render_field  := "render" ":" render_tree

render_tree   := component_call | layout_call | expression
component_call := name "(" prop_args? ")"
layout_call    := layout_name "(" children_list? prop_args? ")"
prop_args      := prop_arg ("," prop_arg)*
prop_arg       := name ":" expression | expression   (named or positional)
children_list  := expression ("," expression)*
```

A `define` with a `render` field parses as a component. A `define` without `render` (but with data/function fields) parses as an entity. Both valid, mutually exclusive.

### Files to create

- `packages/shared/src/component-parser.ts` — or extend existing `parser.ts`. Recommend extending the existing parser since entity and component syntaxes overlap significantly.
- Grammar tests — round-trip parsing of several example components, including:
  - Simple component (MovieTile from docs/components.md)
  - Component with props
  - Component with component-typed props (Strip)
  - Component composing another component in its render tree
  - Mixed entity + component in the same file

### Files to modify

- `packages/shared/src/parser.ts` — add `props_field`, `input_field`, `render_field` productions; detect component vs entity from members present
- `packages/shared/src/ops.ts` — add `ComponentCallNode` and `LayoutCallNode` ExprNode variants (or a dedicated ComponentTree type — TBD during implementation)
- `packages/shared/src/printer.ts` — pretty-print component definitions

### Tests

Extend `packages/shared/src/__tests__/parser.test.ts` with component-definition tests. Include round-trip tests.

### Proof of concept

Parse the full `MovieTile` + `Strip` example from `docs/components.md` into ComponentDef values. Print them back and re-parse for round-trip validation.

### Estimated scope

2 sessions.

---

## Phase 2c — Component Registry + Persistence

**Goal:** Components live in the catalog alongside entities. Persisted to SQLite, loaded at boot, registered in a ComponentRegistry. CRUD API.

### Files to create

- `packages/plugin-core/src/component-registry.ts` — the ComponentRegistry class
  - `register(component: ComponentDef): void`
  - `unregister(name: string): boolean`
  - `get(name: string): ComponentDef | undefined`
  - `list(): ComponentDef[]`
  - `findByInputShape(shape: TypeExpr): ComponentDef[]` — structural match against candidate inputs
  - Constructor pre-registers all base components and layout primitives
  
- `packages/plugin-core/src/derived-component-store.ts` — SQLite persistence (mirror `derived-entity-store.ts`)
  - `save(component: ComponentDef): Promise<void>`
  - `loadAll(): Promise<ComponentDef[]>`
  - `delete(name: string): Promise<void>`
  - `get(name: string): Promise<ComponentDef | null>`

- `packages/plugin-core/src/component-routes.ts` — Hono routes
  - `GET /api/components` — list all
  - `GET /api/components/:name` — one
  - `POST /api/components` — create (body: `{source: string}` or `{component: ComponentDef}`)
  - `PUT /api/components/:name` — update
  - `DELETE /api/components/:name` — delete

- `packages/agent/src/services/component-loader.ts` — boot-time hydration

### Files to modify

- `packages/agent/src/services/schema.ts` — add `derivedComponents` table
- `packages/agent/src/services/db.ts` — migrate the new table
- `packages/agent/src/api/index.ts` — mount component routes
- `packages/agent/src/index.ts` — call component loader at startup

### Tests

- `packages/plugin-core/src/__tests__/component-registry.test.ts`
- `packages/plugin-core/src/__tests__/derived-component-store.test.ts`
- `packages/plugin-core/src/__tests__/component-routes.test.ts` — full CRUD flow

### Proof of concept

`POST /api/components` with the MovieTile source. `GET /api/components/components.MovieTile` returns the parsed ComponentDef. `GET /api/components` lists all base + layout + derived components.

### Estimated scope

1–2 sessions.

---

## Phase 2d — Structural Contract Matcher

**Goal:** A pure function that determines whether a value's type satisfies a component's input contract, with pointed error messages when it doesn't.

### Files to create

- `packages/shared/src/contract.ts` — the matcher
  - `satisfies(value: TypeExpr, contract: TypeExpr): MatchResult`
  - `MatchResult = { ok: true } | { ok: false; errors: MatchError[] }`
  - `MatchError = { path: string[]; expected: TypeExpr; actual: TypeExpr; message: string }`
  - Rules per `docs/components.md` Section 5:
    - Scalar: match types with Maisie semantic subtyping (url satisfies string, percentage satisfies number, etc.)
    - Record: required fields present with compatible types; extra fields allowed
    - Collection: every element's type satisfies the element contract
    - Function: parameter arity ≥ required, return type compatible
    - Component: input contract compatibility

- `packages/shared/src/type-inference.ts` — infer a TypeExpr from a MaisieValue at runtime
  - Used at render-time validation when only the value is known, not its declared type
  - `inferType(value: MaisieValue): TypeExpr`

### Files to modify

- Nothing in existing code — this is a new pure module

### Tests

- `packages/shared/src/__tests__/contract.test.ts` — extensive coverage:
  - Scalar matches and mismatches (including semantic subtypes)
  - Record with all required fields
  - Record missing fields → clear error
  - Collection with mixed elements → first mismatch reported with path
  - Function arity and return compatibility
  - Component contracts (Strip expects `component<record>`, MovieTile is compatible)
  - Deep nesting (record inside collection inside record)

### Proof of concept

A unit test evaluating: "does `plex.list_recently_added`'s output satisfy `MovieTile.input`?" Returns `{ok: true}` or detailed errors showing which fields are missing or mismatched.

### Estimated scope

2 sessions.

---

## Phase 2e — Component Rendering Engine

**Goal:** Take a `ComponentDef`, resolve its input data and props, and render via React. Derived components traverse their render tree recursively; base components map to React elements; layout primitives arrange children.

### Files to create

- `packages/dashboard/src/lib/components/renderer.ts` — the engine
  - `renderComponent(def: ComponentDef, input: MaisieValue, props: MaisieRecord): ReactNode`
  - Walks the render tree (from 2b's parser output)
  - For each component invocation:
    - Resolves the component by name (via ComponentRegistry)
    - Evaluates prop expressions (via evalExprAsync, reusing the entity infrastructure)
    - Recursively renders
  - For each layout invocation:
    - Maps to the React layout primitive (from 2a's registry)
    - Renders children

- `packages/dashboard/src/components/ComponentRenderer.tsx` — React wrapper
  - Fetches the ComponentDef if given a name; uses provided def otherwise
  - Validates contract match before rendering
  - Shows structural errors with the contract-matcher output if validation fails
  - Delegates to the engine

### Files to modify

- `packages/dashboard/src/components/DynamicCard.tsx` — when a card specifies a `component` config, defer to `ComponentRenderer` instead of inferring renderers from the card descriptor

### Tests

- Integration tests under `packages/dashboard/src/__tests__/` (or a new `packages/plugin-core/src/__tests__/component-rendering.test.ts` running against the server side, since most of the logic is server-neutral)

### Proof of concept

Render MovieTile against a synthetic `{title, coverUrl, rating}` record. Verify the DOM structure (image + badge + text positioned correctly). Then render Strip(itemComponent: MovieTile) against a small collection. Verify the horizontal scroll with three tiles.

### Estimated scope

2–3 sessions.

---

## Phase 2f — Component Catalog Integration

**Goal:** Components appear in the entity editor's autocomplete, the wizard's component picker, and the overall catalog browser.

### Files to modify

- `packages/dashboard/src/lib/editor/mel-completion.ts` — fetch components from `/api/components` and offer them as completions (alongside entities) for bare identifiers and component positions in render trees
- `packages/dashboard/src/components/CardWizard.tsx` — Step 1 source picker now also shows components (or more precisely, entities paired with compatible components via the contract matcher)
- `packages/plugin-core/src/actions.ts` — `getCardCatalog` grows to include component descriptors alongside entity descriptors (with a kind marker distinguishing them)

### Tests

- `packages/plugin-core/src/__tests__/catalog-bridge.test.ts` — extend to verify components appear in the catalog

### Proof of concept

Open the MEL editor. Type `StudTile` → autocomplete suggests `MovieTile`, `BookTile`, `PhotoTile` (any matching names). Type `Strip(itemComponent:` → autocomplete suggests component-typed values. Open the card wizard → a "Browse by component" view shows components grouped by input shape.

### Estimated scope

1 session.

---

## Phase 2g — Entity-Component Binding + DefaultTile

**Goal:** Cards can bind an entity to a component explicitly, with props. The system validates the binding structurally. When no component is specified, a `DefaultTile` renders the entity from its fields.

### Files to create

- `packages/dashboard/src/components/default-tile.ts` — `DefaultTile` as a built-in derived component
  - Inspects the input at render time
  - Priority: image field → base layer; string field named title/name → primary label; status field → badge; percentage field → overlay gauge; else label-value pair list
  - Ships in the component registry at boot

### Files to modify

- `packages/shared/src/renderers.ts` (or `packages/plugin-core/src/types.ts`) — extend `CardConfig` with `component?: string` and `componentProps?: MaisieRecord`
- `packages/dashboard/src/hooks/useLayout.ts` — include new fields
- `packages/dashboard/src/components/DynamicCard.tsx` — when `widget.component` is set, delegate to `ComponentRenderer`; otherwise fall back to existing rendering OR `DefaultTile` for entity-backed cards
- `packages/dashboard/src/components/CardWizard.tsx` — Step 3 offers component selection with filter by compatible input; component selection writes `component` to the card config

### Tests

- Integration: create a derived entity + component, bind them via wizard, verify correct rendering and structural error surfaces if contract breaks

### Proof of concept

Build the full `exterior-lights` example from `docs/model.md`. Save it. In the wizard, select it and pick `Strip(itemComponent: SwitchTile)` for the switches field. Save the card. The dashboard shows a horizontal strip of switch tiles with toggle buttons wired to `exterior-lights.sync_toggle`, `.on`, `.off`. Modify a switch entity in HA; the strip updates via MQTT invalidation.

### Estimated scope

2 sessions.

---

## Backward Compatibility

Nothing breaks at any sub-phase:

- **Existing cards**: unchanged. Cards without `component` set render exactly as today.
- **Entity model**: unchanged. The Entity API continues to work.
- **MEL grammar**: additive — new productions only. Existing expressions parse identically.
- **Dashboard layouts**: unchanged. Persisted layouts continue to load.
- **FieldRenderer**: unchanged. Base components in the new registry wrap it without replacing it.

---

## Estimated Total

| Sub-phase | Sessions | Cumulative |
|-----------|----------|------------|
| 2a: Layout Primitives + Base Component Contract | 1–2 | 1–2 |
| 2b: Component DSL (Grammar + Parser) | 2 | 3–4 |
| 2c: Component Registry + Persistence | 1–2 | 4–6 |
| 2d: Structural Contract Matcher | 2 | 6–8 |
| 2e: Component Rendering Engine | 2–3 | 8–11 |
| 2f: Component Catalog Integration | 1 | 9–12 |
| 2g: Entity-Component Binding + DefaultTile | 2 | 11–14 |

Sub-phases 2b and 2d can be parallelized, compressing the realistic total toward **11 sessions**.

---

## What Visual Authoring (Phase 3) Inherits

When Phase 2 is complete, Phase 3 has:

- A typed runtime for components (canvas rendering is via `ComponentRenderer`)
- A registry of components to drag from
- A contract matcher to auto-wire bindings
- A DSL to serialize composed results back to stored artifacts

Phase 3 builds the drag-and-drop canvas, the inference UX, and the link DSL on top. It doesn't need to invent any new primitives at the data/rendering layer.
