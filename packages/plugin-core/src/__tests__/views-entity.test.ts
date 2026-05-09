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

  it('descriptor description is null when view has no description', async () => {
    viewRegistry.register({
      name: 'no-desc-view',
      source: { entity: 'catalog' },
      chain: [],
      component: 'text',
    })

    const resolver = createAddressResolver({})
    const result = await resolver.resolve('views.items')
    const items = result as Array<Record<string, unknown>>

    expect(items[0].description).toBeNull()
  })

  it('resolves views.items with multiple views', async () => {
    viewRegistry.register({
      name: 'view-a',
      description: 'First view',
      source: { entity: 'plex.list_recently_added', field: 'result' },
      chain: [],
      component: 'text',
    })
    viewRegistry.register({
      name: 'view-b',
      source: { entity: 'memory', field: 'notes' },
      chain: [],
      component: 'json',
    })

    const resolver = createAddressResolver({})
    const result = await resolver.resolve('views.items')
    const items = result as Array<Record<string, unknown>>

    expect(items.length).toBe(2)
    const names = items.map((i) => i.name)
    expect(names).toContain('view-a')
    expect(names).toContain('view-b')
  })
})
