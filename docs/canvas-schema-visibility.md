# Canvas — Schema Visibility & Type-Inferred Nodes

*Captured 2026-04-24 from a design discussion.*

Follow-on to `docs/visual-authoring-plan.md`. Addresses a UX gap observed while wiring a canvas pipeline: the entity node is an opaque box, and function nodes downstream don't reveal what shape they produce. The user has no way to know which function to reach for or what field name to type into `pluck`/`get`.

---

## Problem

Given a canvas pipeline like:

```
ENTITY: core.list_plugins  →  FUNCTION: first  →  COMPONENT: text
```

The graph validates structurally (every port connects to a compatible port), but:

- **The entity node is opaque.** You can't tell that `core.list_plugins` returns a collection of plugin records, nor what fields those records have.
- **The function node is opaque.** Even though `first` reduces a collection to a single record, the node doesn't show the record's shape, so you don't know which field to reach for next.
- **The final component gets the wrong type.** `text` wants a string; `first`'s output is a record object. At render time this produces `[object Object]`, empty output, or similar — silent failure, not a type error.

The user can't reason about the pipeline because the canvas hides the data shapes that determine which functions make sense at each hop.

---

## Proposed model

**Shallow entity schema + progressive drill-down via functions.**

Each node shows one level deep of its output structure. To see into a record or element type, the user wires a function that reaches into it (`first`, `get`, `pluck`, etc.), and the next node shows the one-level-deeper view.

This turns the canvas into a progressive data explorer. You navigate the shape by choosing functions, not by staring at a deep JSON tree.

### Example

```
┌─ ENTITY ─────────────────────────┐
│ core.list_plugins                │
├──────────────────────────────────┤
│ plugins: collection<record>      │    ← shallow: one level
└──────────────────────────────────┘
         ↓
┌─ FUNCTION ───────────────────────┐
│ first                            │
├──────────────────────────────────┤
│ → record                         │    ← one level of the record
│   ├ name: string                 │
│   ├ version: string              │
│   ├ capabilities: collection<str>│
│   └ ...                          │
└──────────────────────────────────┘
         ↓
┌─ FUNCTION ───────────────────────┐
│ get("name")                      │
├──────────────────────────────────┤
│ → string                         │    ← leaf: nothing deeper
└──────────────────────────────────┘
         ↓
┌─ COMPONENT ──────────────────────┐
│ text                             │    ← accepts string ✓
└──────────────────────────────────┘
```

### Rules

1. **Entity nodes always show their top-level field list** — the data comes from `EntityDef.fields`, already carried by the existing API.
2. **Function nodes show their inferred output shape only when their input is wired** — an unwired function shows "wire an input to see output shape" (or simply hides the structure section).
3. **Depth is always one level.** Records show their top-level fields; collections show `<element_type>` without drilling into the element. To see the element's fields, add a function (e.g., `first`) that produces one.
4. **Scalar outputs are leaves.** A node that produces `string`, `number`, `boolean`, etc. has no structure section — just the type.

---

## Implementation pieces

### 1. `EntityNode` — shallow schema renderer

Iterate `entity.fields`, show `fieldName: type` for each. For records and collections, show the type keyword (e.g., `collection<record>`, `record`) without recursing. Data already available via the EntityDef fetch the wizard does when a descriptor is selected.

### 2. Client-side type inferencer

New module: `packages/dashboard/src/lib/canvas/type-inference.ts` (or `packages/shared/` if we want server-side use too).

Signature: `infer(upstreamType, functionId, params) → outputType`

Per-function rules:

| Function | Input type | Output type |
|----------|-----------|-------------|
| `first` | `collection<T>` | `T` |
| `last` | `collection<T>` | `T` |
| `pluck` | `collection<record<{F: V}>>` with `field="F"` | `collection<V>` |
| `get` | `record<{F: V}>` with `field="F"` | `V` *(new function — see below)* |
| `filter` | `collection<T>` | `collection<T>` |
| `count` | `collection<_>` | `number` |
| `sum` | `collection<record<{F: number}>>` with `field="F"` | `number` |
| `map` | `collection<T>` with `fn: T → U` | `collection<U>` |
| `group` | `collection<T>` with `field="F"` | `collection<record<{F: value, items: collection<T>}>>` |
| `unique` | `collection<T>` | `collection<T>` |
| `any` / `all` | `collection<_>` | `boolean` |

### 3. `FunctionNode` — conditional schema renderer

- If input port is unwired: hide structure section or show a prompt.
- If wired: compute `outputType = infer(upstreamType, this.functionId, this.params)` and render using the same component as `EntityNode`.

### 4. Tighten stdlib function output metadata

`packages/shared/src/function-registry-data.ts` currently declares `std.first` (and similar) as `output: ANY`. Too loose for structural inference. Extend the descriptor schema to support input-relative outputs — e.g., `output: { kind: 'element_of', ref: 'input' }` — and update the inferencer to resolve them against the actual upstream type.

### 5. Add `std.get`

A `get(record, field)` function to extract a scalar from a single record. Currently missing from the user-facing function registry (exists only as an internal primitive in stdlib bodies). The `first → get("name") → text` idiom is more intuitive than `pluck("name") → first → text`.

```typescript
// in packages/shared/src/std-lib.ts
export const DEF_GET: FunctionDef = {
  id: 'std.get',
  name: 'get',
  description: 'Extract one field from a record',
  params: ['record', 'field'],
  inputSchema: 'record',
  outputSchema: 'any' as MaisieSchemaType,
  // body: { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'record' }, { kind: 'ref', name: 'field' }] }
}

// and in function-registry-data.ts
{
  id: 'std.get',
  name: 'get',
  description: 'Extract one field from a record',
  input: 'record',
  output: { kind: 'field_of', ref: 'input', fieldParam: 'field' },
  params: [
    { name: 'field', type: SCALAR_STRING, inline: true,
      description: 'Field name to extract' },
  ],
}
```

---

## Known edge case: runtime-param-dependent output types

Some functions (`pluck`, `get`, `group`, `sum`) have output types that depend on a parameter value — e.g., `pluck("name")` returns `collection<string>` but `pluck("capabilities")` returns `collection<collection<string>>`.

**At design time** the inferencer can resolve these when the param is an inline string literal (the common case). For **dynamic / computed param values**, it falls back to `ANY`. This is an acceptable limitation; document it and move on.

---

## Deferred: live render preview

The canvas doesn't currently show what the composed component looks like when rendered. We discussed adding a live preview — e.g., the final node renders the actual component with real data flowing through.

**Deferred** because it requires realistic sample data to be meaningful. Without sample data, a preview is either empty or misleading. A preview with empty/nonsense data is worse than no preview — it gives false confidence.

**Prerequisites** for a future preview pass:

1. **Snapshot mechanism** — "use this entity's current live values as my design-time sample" (one-click capture into a design-time cache)
2. **Per-node value inspection** — show the actual value at each port as it flows through, so you can see the shape and contents materialize (builds naturally on the type panel)
3. **Fixture library** — curated sample records per entity for predictable, offline-safe previews

None of which are small. Schema visibility alone (above) covers ~80% of what a preview would tell you — you'll see the types flowing and the name of every field at every hop, and know whether the final type matches the component's requirements. The remaining ~20% (does the rendered output actually look good?) is exactly where real sample data matters most.

---

## Scope note

This work logically slots into the phase that adds **Contract Inference + Auto-Wire** in `docs/visual-authoring-plan.md`. The type inferencer is the shared prerequisite: auto-wire uses it to decide which links are unambiguous; schema visibility uses it to display output shapes. Building the inferencer serves both.
