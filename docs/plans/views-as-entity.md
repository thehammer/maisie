# Plan: views-as-entity

## Goal

Register a `views` entity in the entity registry so that `resolve_address("views.items")` returns all saved views as an array of descriptor records. Follows the same sentinel pattern used by `catalog.items` and `memory.conversations`.

## Why

The view registry holds user-authored compositions (entity + chain + component bindings), but it is not exposed as an entity in the entity graph. The agent cannot query `views.items` via MEL. This is a gap in the homoiconic picture — the catalog lists entities, but there is no way to address the view catalog the same way.

## Current State (confirmed by reading source)

**The sentinel pattern** lives in two places:

1. **`packages/plugin-core/src/entity-registry.ts` — `EntityRegistry` constructor** (lines 14–70)
   - `catalog` entity: `source: 'plugin'`, `pluginName: 'core'`, field `items` with `actionName: '__catalog_items'`
   - `memory` entity: same pattern, with fields `conversations`, `notes`, `facts`, `append_note`, each with a `__memory_*` sentinel actionName

2. **`packages/plugin-core/src/address-resolver.ts` — `invokePluginAction()`** (lines 153–205)
   - When `actionName === '__catalog_items'`: returns `entityRegistry.list().map(entityToDescriptor)`
   - When `actionName === '__memory_*'`: dispatches to memory functions in `actionContext`

**The view registry** is at `packages/plugin-core/src/view-registry.ts`:
- `ViewRegistry` class with `list()`, `get()`, `register()`, `unregister()`, `clear()`
- Singleton: `export const viewRegistry = new ViewRegistry()`

**The view store** (persistence) is at `packages/plugin-core/src/view-store.ts`. The in-memory registry is authoritative at runtime; the store persists to SQLite.

**`ViewDef` shape** (from `packages/shared/src/view.ts`, confirmed via import in view-store.ts):
Fields on a `ViewDef`: `name`, `description?`, `source` (entity + optional field), `chain` (array of ChainStep), `component`, `componentProps?`

The descriptor shape to expose for each view should be: `name`, `description`, `entityAddress` (derived from `source.entity` + optional `source.field`), `component`.

## Steps

### Step 1: Add the `views` entity to `EntityRegistry`'s constructor

In `packages/plugin-core/src/entity-registry.ts`, add a third synthetic entity registration in the constructor, immediately after the `memory` entity block (after `this.entities.set('memory', memoryEntity)` on line 69).

Add:

```typescript
// Register the synthetic views entity. Its 'items' field dispatches to the
// view registry via a sentinel action name that the address resolver intercepts.
const viewsEntity: EntityDef = {
  name: 'views',
  description: 'All saved views in the system',
  source: 'plugin',
  pluginName: 'core',
  section: 'system',
  fields: {
    items: {
      kind: 'data',
      type: 'collection',
      actionName: '__views_items',
    },
  },
}
this.entities.set('views', viewsEntity)
```

### Step 2: Handle the `__views_items` sentinel in the address resolver

In `packages/plugin-core/src/address-resolver.ts`, inside the `invokePluginAction` function, add a new sentinel check. The existing sentinels are at lines 158–197. Add the views sentinel immediately after the `__catalog_items` block (after line 161):

```typescript
// Views sentinel — return the live view list as descriptors.
if (actionName === '__views_items') {
  const { viewRegistry } = await import('./view-registry')
  return viewRegistry.list().map(viewToDescriptor) as MaisieValue
}
```

Then add the helper function `viewToDescriptor` at the bottom of the file (after the existing `entityToDescriptor` helper, near line 345):

```typescript
/**
 * Convert a ViewDef to a plain descriptor record suitable for MEL queries.
 * This is the value shape returned by `views.items`.
 */
function viewToDescriptor(view: import('@maisie/shared').ViewDef): MaisieRecord {
  const entityAddress = view.source.field
    ? `${view.source.entity}.${view.source.field}`
    : view.source.entity
  return {
    name: view.name,
    description: view.description ?? null,
    entityAddress,
    component: view.component,
  } as MaisieRecord
}
```

Note: `viewRegistry` is imported dynamically to avoid a circular import (address-resolver already imports entity-registry; both live in plugin-core). The dynamic import is the pattern already used by view-store.ts for schema imports.

Alternatively, if dynamic import causes issues, add a static import at the top of `address-resolver.ts`:
```typescript
import { viewRegistry } from './view-registry'
```
The view-registry module has no imports from address-resolver, so there is no circular dependency — static import is fine and preferred.

If using static import, the sentinel block becomes:
```typescript
if (actionName === '__views_items') {
  return viewRegistry.list().map(viewToDescriptor) as MaisieValue
}
```

### Step 3: Add the import for ViewDef to address-resolver.ts

If `ViewDef` is not already imported, add it to the import from `@maisie/shared`:
```typescript
import type { AddressResolver, MaisieValue, MaisieRecord, MaisieFunction, EntityDef, FieldDef, ExprNode, ViewDef } from '@maisie/shared'
```

### Step 4: Write a test

Add a test file at `packages/plugin-core/src/__tests__/views-entity.test.ts`:

```typescript
/**
 * Tests for the synthetic views entity.
 *
 * views.items should return all registered views as descriptor records
 * with shape { name, description, entityAddress, component }.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { EntityRegistry, entityRegistry } from '../entity-registry'
import { createAddressResolver } from '../address-resolver'
import { viewRegistry } from '../view-registry'

beforeEach(() => {
  entityRegistry.clear()
  viewRegistry.clear()
  // Restore the synthetic entities (catalog, memory, views) that the constructor registers.
  const fresh = new EntityRegistry()
  const viewsDef = fresh.get('views')!
  entityRegistry.register(viewsDef)
})

describe('views entity — registry registration', () => {
  it('every new EntityRegistry includes a views entity', () => {
    const reg = new EntityRegistry()
    const views = reg.get('views')
    expect(views).toBeDefined()
    expect(views!.name).toBe('views')
    expect(views!.source).toBe('plugin')
    expect(views!.pluginName).toBe('core')
    expect(views!.section).toBe('system')
  })

  it('views entity has an items field with collection type', () => {
    const reg = new EntityRegistry()
    const views = reg.get('views')!
    const items = views.fields.items
    expect(items).toBeDefined()
    expect(items.kind).toBe('data')
    if (items.kind === 'data') {
      expect(items.type).toBe('collection')
      expect(items.actionName).toBe('__views_items')
    }
  })
})

describe('views entity — address resolver', () => {
  it('resolves views.items to an empty array when no views registered', async () => {
    const resolver = createAddressResolver({})
    const result = await resolver.resolve('views.items')
    expect(Array.isArray(result)).toBe(true)
    expect((result as unknown[]).length).toBe(0)
  })

  it('resolves views.items to a collection of view descriptors', async () => {
    viewRegistry.register({
      name: 'my-view',
      description: 'A test view',
      source: { entity: 'catalog', field: 'items' },
      chain: [],
      component: 'text',
    })

    const resolver = createAddressResolver({})
    const result = await resolver.resolve('views.items')
    expect(Array.isArray(result)).toBe(true)
    const items = result as Array<Record<string, unknown>>

    expect(items.length).toBe(1)
    expect(items[0].name).toBe('my-view')
    expect(items[0].description).toBe('A test view')
    expect(items[0].entityAddress).toBe('catalog.items')
    expect(items[0].component).toBe('text')
  })

  it('descriptor entityAddress omits field when source has no field', async () => {
    viewRegistry.register({
      name: 'bare-view',
      source: { entity: 'catalog' },
      chain: [],
      component: 'json',
    })

    const resolver = createAddressResolver({})
    const result = await resolver.resolve('views.items')
    const items = result as Array<Record<string, unknown>>
    expect(items[0].entityAddress).toBe('catalog')
  })
})
```

### Step 5: Verify

```bash
bun test packages/plugin-core/src/__tests__/views-entity.test.ts
bun run typecheck
```

Both must pass with no errors.

## What NOT to do

- Do not add a custom REST route for views — the existing `/api/views` routes already handle CRUD. The entity resolver provides MEL access; the routes provide HTTP access.
- Do not store views in the entity registry (they are not entities, they are compositions). Only the sentinel descriptor is in the entity registry.
- Do not change `ViewDef` shape — this is a read-only exposure of the existing view registry.

```yaml
suggested_config:
  cody:
    model: sonnet
    effort: high
    rationale: "Two-file edit (entity-registry constructor + address-resolver sentinel) plus a new test file. Needs to match the exact sentinel pattern correctly and understand the import topology."
  redd:
    model: sonnet
    effort: high
    rationale: "Sentinel pattern correctness and import cycle check are important to verify."
  marty:
    model: sonnet
    effort: medium
    rationale: "Test coverage verification is the critical check here."
  perri:
    skip: true
    rationale: "Read-only exposure of existing in-memory data. No new write surface."
```
