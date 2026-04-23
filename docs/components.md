# The Maisie Component Model

*Reference manual — last updated 2026-04-22*

---

## Introduction

The component model is the presentation-layer counterpart to the entity model. Where entities compose typed data and functions, components compose typed presentation. The two halves mirror each other:

| | Base | Derived |
|---|------|---------|
| **Data** | plugin actions | derived entities (MEL expressions) |
| **Presentation** | primitive components | derived components (layout + bindings) |

Base components are atomic React elements that render a single typed value — text, image, badge, button, toggle. Layout primitives are structural containers — stack, row, grid, overlay, scroll. Derived components are user-authored compositions that take an entity shape as input and render it using a tree of base components, layout primitives, and other derived components.

Components in this model are **first-class values**. They can be named, stored in the catalog, passed as arguments, and composed. A generic `Strip` component takes another component as a prop, producing a horizontal scroll of whatever tile you give it. A `TabbedStrip` takes a collection of (tab-name, items, tile-component) triples, producing an N-tab interface parameterized by item type. The authoring model composes the same way the entity model does — same type vocabulary, same addressing scheme, same catalog.

This document describes the complete model: base components, layout primitives, derived component authoring, first-class composition, structural contracts, defaults, the catalog, and the binding to entities.

---

## 1. Base Components

A base component is a pure, atomic rendering of a single value or command. It is a React element with a declared input contract and no composition — you cannot pass a base component another component.

Each base component has an input type that determines what value it can render, and a small config surface for presentation options. The existing `RendererConfig` system describes this layer today.

### Scalar Components

| Component | Input type | Config |
|-----------|------------|--------|
| `text` | `string` | `maxLength`, `code?` |
| `number` | `number` | `decimals`, `prefix?`, `suffix?` |
| `boolean` | `boolean` | `trueLabel`, `falseLabel` |
| `bytes` | `number` | `unit?` |
| `percentage` | `number` | `style: 'bar' \| 'text' \| 'gauge'`, `warnAt`, `critAt` |
| `status` | `string` | `colorMap?` |
| `image` | `string (url)` | `aspectRatio`, `fit` |
| `timestamp` | `string (ISO)` | `format: 'relative' \| 'datetime' \| ...` |
| `epoch_ms` | `number` | `format` |
| `duration` | `number (seconds)` | `style: 'compact' \| 'full'` |
| `progress` | `{current, total, label?}` | `showFraction`, `showLabel` |
| `temperature` | `number (°C)` | `unit: 'C' \| 'F'`, thresholds |
| `signal` | `number (dBm)` | `bars` |
| `url` | `string` | `label?`, `newTab` |
| `json` | any | `expanded?` |
| `gauge` | `number (0-100)` | `warnAt`, `critAt`, `label?` |

### Interactive Components

| Component | Input type | Behavior |
|-----------|------------|----------|
| `toggle` | `boolean` | Renders a switch; writes back on change via declared endpoint |
| `button` | `function()` | Renders a button; invokes the function on click |
| `slider` | `function(n: number)` | Renders a slider; invokes with chosen value |
| `text-input` | `function(s: string)` | Renders an input; invokes with typed value |
| `form` | `function(...args)` | Renders fields for each parameter; invokes with submitted record |

The interactive components bind to function-typed fields on entities. The function signature determines which component is appropriate — a no-arg function renders as a button, a single-number-arg function as a slider, and so on.

### Stubs

Several components are declared but not yet fully implemented:

- `stream` — renders a placeholder today; needs HLS/WebRTC/MJPEG playback
- `slider`, `text-input`, `form` — currently fall back to buttons; full implementations pending

The contract is stable; the implementations are future work. Components can be added to this table only by deliberate protocol change — new base components require updating this spec, the shared type definitions, and the React renderer.

---

## 2. Layout Primitives

Layout primitives are structural components. They have no data content of their own; their purpose is to arrange children in space. They are the composition mechanism — the thing that makes derived components more than just named base components.

### The minimal set

| Primitive | Arranges children... |
|-----------|---------------------|
| `stack` | Vertically, stacked top-to-bottom |
| `row` | Horizontally, in a row |
| `grid` | In a two-dimensional grid with `columns` or `cols` config |
| `overlay` | Layered on top of each other; later children render above earlier ones |
| `scroll` | In a scrollable container; `direction: 'horizontal' \| 'vertical'` |
| `card` | In a bordered container with a title slot |
| `spacer` | Empty space for alignment |

Each layout primitive accepts `children` — a collection of component invocations. Children may be base components, other layout primitives, or derived components. The recursion is unbounded.

Layout primitives accept positional and styling props:

- `align: 'start' \| 'center' \| 'end'`
- `gap: number` — pixels between children
- `padding: number`
- `fit: 'fill' \| 'content'` — how the container sizes itself

The primitive set is deliberately small. Anything more specific (masonry, carousel, split-pane) is a derived component. The rule: if it has a fixed visual behavior but composes from the minimal set, it belongs in userland.

### Overlay semantics

`overlay` is the primitive that enables the richest compositions. Children stack in Z-order, optionally anchored to corners or edges:

```
overlay(
  image(src: self.coverUrl, fit: cover),
  badge(value: self.tomato, position: top-right),
  text(self.title, position: bottom-left, style: hover-reveal)
)
```

The `position` prop on an overlay child declares where within the overlay box it anchors. Without `position`, children fill the overlay.

---

## 3. Derived Components

A derived component is a named composition. It declares an input type (what data shape it accepts), optional props (including other components), and a render tree.

```
define MovieTile {
  description: "A movie tile with cover, rating badge, and hover title."

  input: record<{
    title:    string
    coverUrl: url
    rating:   status
  }>

  render: overlay(
    image(src: self.coverUrl, fit: cover, aspectRatio: "2/3"),
    badge(value: self.rating, position: top-right),
    text(self.title, position: bottom, reveal: on-hover)
  )
}
```

Key elements:

- **`description`** — human-readable explanation; surfaces in the catalog and authoring tools
- **`input`** — the data contract; the shape this component renders
- **`props`** (optional) — other parameters the component takes; may include other components
- **`render`** — the composition tree, referencing `self.{field}` for input data and `self.props.{name}` for props

### Self references

Inside a derived component, `self` binds to the composition's inputs:

- `self.{field}` — an input field (from the record-shaped `input`)
- `self.props.{name}` — a prop value
- `self.input` — the raw input (useful when input is a collection, not a record)

The address resolver treats these the same as entity `self` — same scoping rules, same cycle detection.

### The render tree is an expression

The `render` block is a MEL-like expression that produces a visual composition. It has three kinds of nodes:

- **Component invocations** — `text(self.title)`, `image(src: self.coverUrl)`, `MovieTile(...)`. Named by component address.
- **Layout primitives** — `stack(...)`, `overlay(...)`, `scroll(...)`. Structural containers.
- **MEL expressions** — for data-level transforms: `self.items | map: (row) => MovieTile(row)`, `if self.status == "ok" then ...`.

The boundary between the two languages is clean: component invocations produce visual nodes; MEL expressions produce values that are bound into those nodes.

---

## 4. Components as First-Class Values

Components are values. They have a type, they can be stored in variables, passed as arguments, and returned from expressions.

The type of a component is `component<InputShape>` where `InputShape` is its input contract. A function from `number` to a component value has type `function(n: number) → component<...>`. The component-as-value principle is how generic composition works without nominal generics.

### Passing components as props

A derived component's `props` can include `component`-typed entries. At the use site, the caller supplies a specific component value. The receiver invokes it inside its render tree.

```
define Strip {
  description: "A scrolling list of items, rendered with a provided item component."

  props: {
    itemComponent: component
    direction:     string = "horizontal"
    gap:           number = 12
  }

  input: collection<record>

  render: scroll(
    direction: self.props.direction,
    gap: self.props.gap,
    children: self.input | map: (row) => self.props.itemComponent(row)
  )
}
```

Usage:

```
Strip(input: plex.list_recently_added, itemComponent: MovieTile)
Strip(input: calibre.list_books,        itemComponent: BookCover)
Strip(input: photos.recent,             itemComponent: PhotoThumbnail)
```

The same `Strip` handles all three cases. The item component is supplied at the call site; the strip doesn't know or care what it's rendering.

### Components returned from expressions

Because components are values, expressions can compute them:

```
define AdaptiveTile {
  input: record<{ kind: string, data: record }>

  render:
    let component =
      if self.kind == "movie" then MovieTile
      else if self.kind == "book" then BookCover
      else if self.kind == "photo" then PhotoThumbnail
      else DefaultTile
    component(self.data)
}
```

The `let` binding holds a component value; the body invokes it. The if-then-else branches each produce a component value. This is the same pattern MEL already uses for functions.

### Higher-order composition

A component can take components that themselves take components:

```
define TabbedStrip {
  description: "N tabs, each a Strip with its own item component."

  props: {
    tabs: collection<{
      label:         string
      items:         collection<record>
      itemComponent: component
    }>
  }

  render: tabs(
    for each tab in self.props.tabs: {
      label: tab.label,
      content: Strip(input: tab.items, itemComponent: tab.itemComponent)
    }
  )
}
```

The tabs themselves are data; each one parameterizes a `Strip` with its own tile type. The whole structure is data-driven and reusable across domains — same `TabbedStrip` works for "Movies / Books / Music", for "Network / Storage / Power", or for any other multi-domain browser.

---

## 5. Structural Contracts

A component's input contract is checked against the data it binds to at composition time — when a card or parent component says "render this collection with this item component." This is structural, not nominal, typing.

### Compatibility rule

A value of type `V` satisfies a component's input type `I` if:

- If `I` is a scalar type, `V` matches the scalar (including Maisie semantic subtyping — a value typed `url` satisfies an input typed `string`).
- If `I` is a record with required fields `{f1: T1, f2: T2, ...}`, `V` is a record with at least those fields, each satisfying its declared type. Extra fields are allowed.
- If `I` is `collection<E>`, `V` is a collection where every element satisfies `E`.
- If `I` is `function(params) → T`, `V` is a function with at least those parameters and a return type satisfying `T`.
- If `I` is `component<X>`, `V` is a component whose input satisfies `X`.

### When validation happens

Two validation points:

1. **Authoring time** — when a card is saved with a component binding, the framework checks the binding against the component's input contract using what it knows about the entity's field types. Mismatches surface immediately in the editor with pointed error messages.

2. **Render time** — when actual data flows into the component, the framework checks each item against the contract. Validation at render time catches cases where the entity's schema is known loosely (e.g., `record` without specific fields) but individual records do or don't have the required fields.

### Error messages

Structural errors name the specific mismatch:

```
Cannot bind plex.list_recently_added to MovieTile:
  MovieTile expects each item to have:
    - coverUrl: url     ✗ (found: string — compatible)
    - rating:   status  ✗ (field missing)
  Collection element type has: { title, addedAt, summary, ... }
```

The goal is that the person binding the component knows exactly what's missing and where. If the component expects `rating: status` but the entity provides `imdbRating: number`, the error says so — and the fix is either a derived-entity field rename or adding a transform in the card config.

---

## 6. Defaults and the Fallback Renderer

A component can declare a default for any `component`-typed prop:

```
props: {
  itemComponent: component = DefaultTile
}
```

When the prop is omitted at the call site, the default is used. This is how containers like `Strip` can have sensible behavior even when the caller doesn't supply a tile.

### DefaultTile — auto-render-from-fields

`DefaultTile` is a built-in derived component that inspects its input at render time and produces a reasonable tile without any authored configuration. Rules:

- If input has an `image` or `url` field named `coverUrl` / `thumbnail` / `image`, show it as the base layer.
- If input has a string field named `title` / `name`, show it as the primary label.
- If input has a `status` field, show it as a badge.
- If input has a `percentage` field, show it as a small overlay gauge.
- Otherwise, fall back to a field list (label-value pairs).

The defaults give the dashboard a working out-of-the-box rendering for any entity — you don't have to author a tile component to see your data. You author one when you want to improve it.

### Defaults for layout props

Numeric and string props have literal defaults:

```
props: {
  direction: string = "horizontal"
  gap:       number = 12
}
```

Defaults participate in structural contracts the same way: a caller may omit a defaulted prop, and the component renders with the declared default value.

---

## 7. The Component Catalog

Derived components live in the catalog alongside entities. The catalog is homogeneous — consumers of the catalog don't distinguish base components from derived ones, or entities from components.

### Addressing

Every named component has an address:

```
text                    # built-in base component
badge                   # built-in base component
overlay                 # layout primitive
components.MovieTile    # user-defined derived component
components.Strip        # user-defined derived component
```

Base components and layout primitives share a flat namespace because they're always available. Derived components are namespaced under `components.` to distinguish them from entities.

### Persistence

Derived components are stored in a `derived_components` table in SQLite. The schema mirrors `derived_entities`:

| Column | Purpose |
|--------|---------|
| `name` | Primary key — the component name |
| `description` | Human-readable summary |
| `input_type` | JSON: the input contract |
| `props` | JSON: prop declarations with defaults |
| `render` | JSON: the render tree (expression) |
| `createdAt`, `updatedAt` | Timestamps |

Components are loaded into a `ComponentRegistry` at agent boot, same pattern as the `EntityRegistry`. The registry is queryable — `registry.list()`, `registry.findByInputShape(shape)`, `registry.findCompatibleWith(entity)`.

### The catalog is itself a component

Every entity is also queryable as a component catalog entry, because the framework can check which derived components' input contracts are satisfied by an entity's output shape.

```
catalog.entities
  | filter: entity => Strip.canBind(entity)
  → collection<entity>    # entities that can be wrapped in a Strip
```

This is how the authoring tools help you — "show me every entity that this component can render."

---

## 8. Binding Entities to Components

A card is a pin-point binding between an entity and a component. The card config says: render entity E using component C, with these prop values.

```json
{
  "id": "recently-added-movies",
  "entity": "plex.list_recently_added",
  "component": "components.Strip",
  "props": {
    "itemComponent": "components.MovieTile",
    "direction": "horizontal"
  }
}
```

The framework, at render time:

1. Resolves the entity — fetches `plex.list_recently_added` via the address resolver.
2. Validates the binding — checks the entity's output shape against `Strip.input` (and transitively against `MovieTile.input` because Strip's itemComponent must accept Strip's element type).
3. Renders — invokes the component with the resolved data and prop values.

### The wizard

The card wizard composes this binding interactively:

- **Step 1** — pick an entity from the catalog.
- **Step 2** — pick a compatible component. The wizard filters the component catalog to those whose input satisfies the entity's output.
- **Step 3** — fill in the component's props. For `component`-typed props, offer the set of components whose input matches the downstream data shape.
- **Save** — persist the card config with the full binding.

If the user picks an entity and a component whose contracts don't match, the wizard offers auto-fixes: project the entity's fields (via a derived entity with `pick`/`rename` transforms) to match the component's expected shape.

### Function fields and composite binding

An entity often has both data fields and function fields. A card can render both:

- The entity's primary data field binds to the component's `input`.
- Function fields bind to the component's function-typed slots (buttons, toggles, forms).
- Unbound function fields can still appear as generic action buttons at the card level.

This is how the `exterior-lights` entity from `docs/model.md` renders:

- `switches: collection<switch>` binds to `Strip(itemComponent: SwitchTile)`
- `sync_toggle: function()` binds to a card-level "Toggle All" button
- `on: function()`, `off: function()` each get their own button

The card config names each binding explicitly.

---

## 9. Events and Reactivity

Component composition doesn't change the reactivity model — entity events flow through the same MQTT invalidation mechanism.

When a base entity changes:
1. The plugin emits an MQTT event.
2. The entity dependency graph identifies affected derived entities.
3. Cards bound to any of those entities receive invalidation notifications.
4. The affected card re-fetches its entity and re-renders with the same component tree.

Components don't need to subscribe to events themselves. They receive their data as props; when the props change (because the card re-fetched the entity), they re-render through normal React state propagation. The reactive behavior is entirely at the entity layer.

One consequence: a complex component tree that renders thousands of tiles only re-renders the tiles whose data changed, thanks to React's reconciliation. The entity invalidation is coarse (whole entity), but the visual update is fine (only the changed items).

---

## 10. Authoring and Evolution

Derived components are authored in the same editor as derived entities — the MEL editor with a mode toggle. Both are expressions, both have addresses, both live in the catalog.

The component DSL is an extension of MEL with new productions:

- `render:` block for the composition tree
- Layout primitive function calls (`stack`, `row`, etc.)
- Component invocations (any registered component name)
- `component` type in type expressions

The parser and evaluator extend naturally. The grammar spec (`docs/grammar.md`) grows by a few productions; the core expression machinery doesn't change.

### Component versions

Derived components evolve over time. The catalog supports non-breaking changes freely (adding props with defaults, adding optional render paths). Breaking changes (removing a prop, changing input contract) are surfaced — the registry knows which cards bind which components and can flag broken bindings for review.

### Sharing and templates

A component template library — pre-built derived components for common patterns — ships with the dashboard. Initial set:

- `MediaTile` — thumbnail + title + subtitle + optional badge
- `StatTile` — single-value display with optional gauge/sparkline
- `ActionCard` — a card with a primary action and optional secondary actions
- `Strip` — horizontal scroll
- `Grid` — two-dimensional tile grid
- `List` — vertical item list
- `TabbedContainer` — N-tab switcher
- `SplitPane` — two-pane layout with resizable divider

Users can start from a template, customize it, and save as a new component. Templates are read-only but branchable.

---

## Summary

1. **Base components** render single typed values (text, image, badge, gauge, toggle, button, ...)
2. **Layout primitives** structure composition (stack, row, grid, overlay, scroll, card, spacer)
3. **Derived components** are named compositions with typed input contracts
4. **Components are first-class values** — named, stored, passed as arguments, computed from expressions
5. **Structural contracts** validate at composition and render time with pointed error messages
6. **Defaults** enable generic containers and fallback rendering from unknown data
7. **The catalog** is homogeneous — base, layout, and derived components all share an address space
8. **Entity-to-component binding** happens in card configs; the wizard filters by structural compatibility
9. **Reactivity** flows through the existing entity event system; components re-render on prop change

The model mirrors the entity model exactly. Data and presentation compose the same way, with the same vocabulary, addressed and persisted the same way. Together they give Maisie a complete authoring surface: any data in the house, any presentation of it, all reusable, all composable, all addressable.
