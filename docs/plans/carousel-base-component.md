# Plan: carousel-base-component

## Goal

Add `carousel` as a base component stub in `packages/shared/src/component-registry-data.ts`. Update `docs/components.md` to include `carousel` in the base components section and add the imperative-rendering rule for base component stubs.

## Why

`RecentlyAddedCard.tsx` implements a smooth-scrolling horizontal carousel using `requestAnimationFrame` — the animation is imperative, not declarative. This is the canonical example of a component that needs RAF for semantics, not just performance. Per the model rule being established: **imperative rendering semantics (requestAnimationFrame loops, physics engines, WebGL) are base component stubs, not derived components and not exceptions.** They declare a typed contract; their implementation is platform-provided.

`carousel` belongs as a base component stub because:
1. It requires RAF for seamless infinite scroll (a derived component using layout primitives cannot express this)
2. Its interface is typed and stable: takes a list + a tile component
3. It is not a composition of existing base/layout components — it needs implementation-level access

## Current State (confirmed by reading source)

**`packages/shared/src/component-registry-data.ts`** — defines `BASE_COMPONENTS` (17 entries: text, number, boolean, bytes, percentage, status, image, timestamp, duration, temperature, signal, gauge, progress, url, toggle, button, json) and `LAYOUT_PRIMITIVES` (7 entries: stack, row, grid, overlay, scroll, card, spacer).

Each `ComponentDef` in `BASE_COMPONENTS` has shape:
```typescript
{
  name: string
  kind: 'base'
  description?: string
  input?: TypeExpr        // the data type this component renders
  props?: Record<string, PropDef>
}
```

**`packages/plugin-core/src/component-registry.ts`** — `ComponentRegistry` constructor pre-registers all `BASE_COMPONENTS` and `LAYOUT_PRIMITIVES` at lines 16–18 by iterating `Object.values()`. Adding `carousel` to `BASE_COMPONENTS` in shared will automatically register it there.

**`packages/dashboard/src/lib/components/base-component-renderer.tsx`** — `renderBaseComponent()` handles the React dispatch. It has a `switch` on `component.name` in `buildRendererConfig`. A new base component without a case will fall through to the `default: return { type: 'string' }` fallback. That is acceptable for a stub.

**`packages/dashboard/src/components/RecentlyAddedCard.tsx`** — the existing imperative RAF carousel. It uses `useRef`, `requestAnimationFrame`, `offsetRef`, circular card recycling. This is the behavioral model the `carousel` stub should capture in its contract.

**`docs/components.md` line 65–70** — the stubs section currently lists: `stream`, `slider`, `text-input`, `form`. The doc says: "Components can be added to this table only by deliberate protocol change." `carousel` gets added there.

**`docs/components.md` line 99** — the current layout primitive rule says: "anything more specific (masonry, carousel, split-pane) is a derived component." This rule needs correction — `carousel` was listed as a derived component example but is actually a base component stub due to its imperative RAF semantics. The rule needs a carve-out.

## Steps

### Step 1: Add `carousel` to `BASE_COMPONENTS` in `packages/shared/src/component-registry-data.ts`

Add `carousel` as the last entry in the `BASE_COMPONENTS` object, after the `json` entry:

```typescript
carousel: {
  name: 'carousel',
  kind: 'base',
  description: 'Animation-loop horizontal scroll. Base component — imperative RAF rendering semantics. Takes a list and a tile component; renders a continuously scrolling strip.',
  input: { kind: 'collection', element: { kind: 'any' } },
  props: {
    itemComponent: {
      type: { kind: 'component', input: { kind: 'any' } },
      description: 'Component to render each item in the carousel',
    },
    speed: {
      type: { kind: 'scalar', type: 'number' },
      default: 0.3,
      description: 'Scroll speed in pixels per animation frame',
    },
    cardWidth: {
      type: { kind: 'scalar', type: 'number' },
      default: 80,
      description: 'Width of each card in pixels',
    },
    cardGap: {
      type: { kind: 'scalar', type: 'number' },
      default: 10,
      description: 'Gap between cards in pixels',
    },
  },
},
```

The `input` type `{ kind: 'collection', element: { kind: 'any' } }` is the correct TypeExpr shape for "a list of anything". Compare with the `LAYOUT_PRIMITIVES` entries that use `{ kind: 'collection', element: { kind: 'component' } }` for their `children` props.

The `itemComponent` prop uses `{ kind: 'component', input: { kind: 'any' } }` — a component value that accepts any input. This is the generic tile slot pattern described in `docs/components.md` section 4.

### Step 2: Add a React stub in `packages/dashboard/src/lib/components/base-component-renderer.tsx`

In `buildRendererConfig()`, add a case for `carousel` before the `default`:

```typescript
case 'carousel':
  // Carousel is a base component stub — its full implementation uses RAF.
  // For now, fall through to json renderer as a data-visible fallback.
  return { type: 'json', expanded: false }
```

This ensures the component doesn't render a broken UI. The stub renders the raw data as JSON — visually obvious that it's a stub, but not broken.

Optionally, also update `renderBaseComponent()` to add a carousel-specific path that renders a simple static list (non-animated):

```typescript
if (component.name === 'carousel') {
  // Stub: render as a non-animated horizontal list until RAF implementation lands.
  const items = Array.isArray(args.value ?? args.input ?? args.src) 
    ? (args.value ?? args.input ?? args.src) as MaisieValue[]
    : []
  return (
    <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '4px 0' }}>
      {items.map((item, i) => (
        <div key={i} style={{ minWidth: 80, background: '#1f1f1f', borderRadius: 4, padding: 8 }}>
          <FieldRenderer value={item} config={{ type: 'json' }} />
        </div>
      ))}
    </div>
  )
}
```

This is the fallback implementation. It is intentionally simple — the real implementation (matching `RecentlyAddedCard.tsx`) is future work.

### Step 3: Update `docs/components.md`

**Change 1: Add `carousel` to the Stubs table (Section 1 — Base Components)**

In the Stubs section (around line 65–70), add `carousel` to the bullet list:

Current:
```markdown
- `stream` — renders a placeholder today; needs HLS/WebRTC/MJPEG playback
- `slider`, `text-input`, `form` — currently fall back to buttons; full implementations pending
```

Updated:
```markdown
- `stream` — renders a placeholder today; needs HLS/WebRTC/MJPEG playback
- `slider`, `text-input`, `form` — currently fall back to buttons; full implementations pending
- `carousel` — renders a static horizontal list today; full implementation requires requestAnimationFrame loop for seamless infinite scroll
```

**Change 2: Add `carousel` to the Scalar Components table (Section 1)**

Add a row at the end of the scalar components table:

| Component | Input type | Config |
|-----------|------------|--------|
| `carousel` | `list<any>` | `itemComponent: component`, `speed`, `cardWidth`, `cardGap` |

**Change 3: Correct the layout primitive rule (Section 2, around line 99)**

The current text says:
> The rule: if it has a fixed visual behavior but composes from the minimal set, it belongs in userland.

Replace the paragraph starting "The primitive set is deliberately small..." with:

```markdown
The primitive set is deliberately small. Anything more specific that can be expressed declaratively (masonry layouts, split-pane wrappers, tab groups) is a derived component — a named composition in userland.

**Exception: imperative rendering semantics.** Components that require imperative platform access for correctness — requestAnimationFrame loops, physics engines, WebGL contexts — are base component stubs, not derived components and not exceptions to the model. They declare a typed input contract and props surface, but their React implementation is platform-provided and cannot be expressed as a composition of layout primitives.

The rule:
- Declarative composition from layout primitives → derived component (userland)
- Imperative rendering semantics (RAF, physics, WebGL) → base component stub (platform-provided)

`carousel` is the canonical example of the second category: its seamless infinite scroll requires a requestAnimationFrame loop with circular card recycling. This cannot be expressed in the declarative layout system.
```

### Step 4: Verify

```bash
bun run typecheck
```

The typecheck must pass. No test changes are needed — the existing `packages/plugin-core/src/__tests__/component-registry.test.ts` and `packages/dashboard/src/lib/components/__tests__/base-registry.test.ts` will pick up the new `carousel` entry automatically if they enumerate `BASE_COMPONENTS`.

If any test asserts an exact count of base components, update that count by 1.

## What NOT to do

- Do not implement the full RAF carousel in this job. The stub (static list fallback) is the deliverable. The full implementation is a separate task.
- Do not move `carousel` to `LAYOUT_PRIMITIVES` — it is a base component (has a data input contract) not a layout primitive (structural container).
- Do not change the `ComponentDef` interface — `props` with component-typed values is already supported by the existing type system.

```yaml
suggested_config:
  cody:
    model: sonnet
    effort: high
    rationale: "Three touch points (shared data, dashboard renderer, docs). The TypeExpr shape for 'component-typed props' requires understanding the existing type vocabulary."
  redd:
    model: sonnet
    effort: medium
    rationale: "Verify the TypeExpr shape is correct and the docs correction is accurate."
  marty:
    model: haiku
    effort: low
    rationale: "downgrade: typecheck is the primary verification. Adding a ComponentDef entry and updating docs don't require deep refactor analysis."
  perri:
    skip: true
    rationale: "No security surface. Pure type declaration and documentation."
```
