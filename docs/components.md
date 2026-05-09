# Maisie Component System

*Last updated: 2026-05-09*

---

## 1. Base Components

Base components render a **typed data value**. Each entry in `BASE_COMPONENTS`
(`packages/shared/src/component-registry-data.ts`) is a platform-level contract:
a stable name, a typed input, and an optional set of configuration props.

The component vocabulary is **finite by design**. Generic rendering is only
possible when the set is closed. Adding or removing an entry here is a deliberate
protocol change — not an implementation detail.

### Scalar components

| Component | Input type | Description |
|-----------|------------|-------------|
| `text` | `string` | Plain text, rendered as-is |
| `number` | `number` | Raw numeric value; `precision` prop for decimal places |
| `boolean` | `boolean` | Renders as Yes / No |
| `bytes` | `number` | Storage/transfer size — renders as "1.2 GB" |
| `percentage` | `number` | 0–100 percentage — renders as a progress bar |
| `status` | `string` | Named state badge — ok, warning, error, idle, busy, unknown |
| `image` | `string` (URL) | Thumbnail `<img>`; `width`, `height`, `alt` props |
| `timestamp` | `string` (ISO 8601) | Relative time: "2h ago" |
| `duration` | `number` (seconds) | "2h 34m" |
| `temperature` | `number` (°C) | "72°C" with threshold color; `warnAt`, `critAt` props |
| `signal` | `number` (dBm) | Segmented signal-strength indicator |
| `gauge` | `number` | Arc-style meter; `min`, `max` props |
| `progress` | `{ current, total, label? }` | Labeled progress bar |
| `url` | `string` (URL) | Clickable `<a>` link; `label`, `newTab` props |
| `toggle` | `boolean` | Toggle switch (read + write); `disabled` prop |
| `button` | `any` | Action trigger; `label`, `variant` props |
| `json` | `any` | Collapsible JSON viewer; `expanded` prop |
| `carousel` | `list<any>` | Animation-loop horizontal scroll; `itemComponent`, `speed`, `cardWidth`, `cardGap` props |

### Stubs

These components have typed contracts and are registered in the platform, but
their React implementations are incomplete. A stub renders something visible
and non-broken, never silently empty.

- `stream` — renders a placeholder today; needs HLS/WebRTC/MJPEG playback
- `slider`, `text-input`, `form` — currently fall back to buttons; full implementations pending
- `carousel` — renders a static horizontal list today; full implementation requires
  a requestAnimationFrame loop for seamless infinite scroll

Components can be added to the stubs section only by deliberate protocol change:
add the entry to `BASE_COMPONENTS`, add a case to `buildRendererConfig()` in
`base-component-renderer.tsx`, and document it here.

---

## 2. Layout Primitives

Layout primitives are **structural containers**. They take children, not a data
value. Their `input` type is undefined; their purpose is composition.

| Primitive | Description |
|-----------|-------------|
| `stack` | Vertical flex container; `gap`, `align` props |
| `row` | Horizontal flex container; `gap`, `align`, `wrap` props |
| `grid` | CSS grid; `columns`, `gap` props |
| `overlay` | Absolute-positioned z-stacked container |
| `scroll` | Overflow scrollable container; `direction` prop |
| `card` | Elevated card panel with background/border; `title`, `padding` props |
| `spacer` | Flexible space filler; optional fixed `size` prop |

The primitive set is deliberately small. Anything more specific that can be
expressed declaratively as a composition of these primitives belongs in userland
as a derived component — a named composition, not a platform entry.

**Exception: imperative rendering semantics.** Components that require
imperative platform access for correctness — requestAnimationFrame loops, physics
engines, WebGL contexts — are base component stubs, not derived components and not
exceptions to the model. They declare a typed input contract and props surface,
but their React implementation is platform-provided and cannot be expressed as a
composition of layout primitives.

The rule:
- Declarative composition from layout primitives → derived component (userland)
- Imperative rendering semantics (RAF, physics, WebGL) → base component stub (platform-provided)

`carousel` is the canonical example of the second category: its seamless infinite
scroll requires a requestAnimationFrame loop with circular card recycling. This
cannot be expressed in the declarative layout system. The working implementation
exists in `packages/dashboard/src/components/RecentlyAddedCard.tsx` and serves as
the behavioral specification for the full `carousel` component implementation.

---

## 3. TypeExpr — The Type Vocabulary

Component input types and prop types are expressed using `TypeExpr`, defined in
`packages/shared/src/component-registry-data.ts`.

```typescript
type TypeExpr =
  | { kind: 'any' }
  | { kind: 'scalar'; type: 'string' | 'number' | 'boolean' }
  | { kind: 'collection'; element: TypeExpr }
  | { kind: 'component'; input: TypeExpr }
```

The vocabulary is minimal by design — only the distinctions the rendering
framework actually needs are expressed here. Record shapes are expressed as
`{ kind: 'any' }` until the vocabulary gains a record kind.

---

## 4. Adding a Component

Adding a component to the platform vocabulary requires changes in three places:

1. **`packages/shared/src/component-registry-data.ts`** — Add the `ComponentDef`
   entry to `BASE_COMPONENTS` (or `LAYOUT_PRIMITIVES` for structural containers).

2. **`packages/dashboard/src/lib/components/base-component-renderer.tsx`** — Add
   a case to `buildRendererConfig()` mapping the component name to its
   `RendererConfig`, and implement the React renderer in `renderBaseComponent()`.
   A stub implementation (e.g., falling back to the `json` renderer) is
   acceptable while the full implementation is pending.

3. **`docs/components.md`** (this file) — Add the component to the table and
   document its input type, props, and any stub status.

The `ComponentRegistry` in `packages/plugin-core/src/component-registry.ts`
picks up new entries automatically — it iterates `Object.values(BASE_COMPONENTS)`
at construction time.

---

## 5. The Three-Surface Rule and Components

Every `PluginAction` that uses a base component renderer does so through the
`ui.componentHint` field. Setting `componentHint: 'carousel'` on an action's UI
declaration tells the dashboard to use the `carousel` base component to render
the action's output.

This keeps component selection explicit and auditable: the plugin author declares
which component renders their data, not an inference heuristic. The registry
validates that the named component exists at boot.
