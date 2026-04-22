/**
 * Tests for the synthetic catalog entity (Phase 6).
 *
 * The catalog is a virtual entity registered at EntityRegistry construction
 * time. Its 'items' field resolves via a special sentinel in the address
 * resolver that returns the live entity list as descriptor records.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { EntityRegistry } from '../entity-registry'
import { entityRegistry } from '../entity-registry'
import { createAddressResolver } from '../address-resolver'
import type { EntityDef } from '@maisie/shared'

// ── EntityRegistry: catalog presence ─────────────────────────────────────────

describe('catalog entity — registry registration', () => {
  it('every new EntityRegistry includes a catalog entity', () => {
    const reg = new EntityRegistry()
    const catalog = reg.get('catalog')

    expect(catalog).toBeDefined()
    expect(catalog!.name).toBe('catalog')
    expect(catalog!.source).toBe('plugin')
    expect(catalog!.pluginName).toBe('core')
    expect(catalog!.section).toBe('system')
  })

  it('catalog entity has an items field with collection type', () => {
    const reg = new EntityRegistry()
    const catalog = reg.get('catalog')!
    const items = catalog.fields.items

    expect(items).toBeDefined()
    expect(items.kind).toBe('data')
    if (items.kind === 'data') {
      expect(items.type).toBe('collection')
      expect(items.actionName).toBe('__catalog_items')
    }
  })

  it('catalog entity appears in list()', () => {
    const reg = new EntityRegistry()
    const names = reg.list().map((e) => e.name)
    expect(names).toContain('catalog')
  })
})

// ── Address resolver: catalog.items resolution ────────────────────────────────

describe('catalog entity — address resolver', () => {
  beforeEach(() => {
    // Clear and re-register catalog so the singleton is in a known state.
    // The catalog entity is always restored via new EntityRegistry() in tests
    // that use a fresh instance, but the singleton needs explicit setup.
    entityRegistry.clear()
    // Re-register the catalog manually (as if the constructor ran).
    // We do this by registering via a fresh registry's catalog:
    const fresh = new EntityRegistry()
    const catalogDef = fresh.get('catalog')!
    entityRegistry.register(catalogDef)
  })

  it('resolves catalog.items to a collection of entity descriptors', async () => {
    const resolver = createAddressResolver({})
    const result = await resolver.resolve('catalog.items')

    expect(Array.isArray(result)).toBe(true)
    const items = result as Array<Record<string, unknown>>

    // At minimum, the catalog entity itself should be in the list
    const catalogDescriptor = items.find((i) => i.name === 'catalog')
    expect(catalogDescriptor).toBeDefined()
  })

  it('catalog descriptor has expected shape', async () => {
    const resolver = createAddressResolver({})
    const result = await resolver.resolve('catalog.items')
    const items = result as Array<Record<string, unknown>>

    const catalogDescriptor = items.find((i) => i.name === 'catalog')!
    expect(catalogDescriptor.source).toBe('plugin')
    expect(catalogDescriptor.section).toBe('system')
    expect(catalogDescriptor.pluginName).toBe('core')
    expect(typeof catalogDescriptor.description).toBe('string')
    expect(typeof catalogDescriptor.fields).toBe('object')
  })

  it('catalog.items includes other registered entities', async () => {
    const extraEntity: EntityDef = {
      name: 'ha.list_switches',
      description: 'HA switches',
      source: 'plugin',
      pluginName: 'ha',
      section: 'smarthome',
      fields: {
        result: { kind: 'data', type: 'collection', actionName: 'list_switches' },
      },
    }
    entityRegistry.register(extraEntity)

    const resolver = createAddressResolver({})
    const result = await resolver.resolve('catalog.items')
    const items = result as Array<Record<string, unknown>>

    const haDescriptor = items.find((i) => i.name === 'ha.list_switches')
    expect(haDescriptor).toBeDefined()
    expect(haDescriptor!.section).toBe('smarthome')
  })

  it('catalog.items descriptors include field shape info', async () => {
    const extraEntity: EntityDef = {
      name: 'test.an_entity',
      source: 'plugin',
      pluginName: 'test',
      section: 'misc',
      fields: {
        result: { kind: 'data', type: 'record', actionName: 'an_entity' },
      },
    }
    entityRegistry.register(extraEntity)

    const resolver = createAddressResolver({})
    const result = await resolver.resolve('catalog.items')
    const items = result as Array<Record<string, unknown>>

    const desc = items.find((i) => i.name === 'test.an_entity')!
    expect(desc).toBeDefined()
    const fields = desc.fields as Record<string, { kind: string; type: string }>
    expect(fields.result).toBeDefined()
    expect(fields.result.kind).toBe('data')
    expect(fields.result.type).toBe('record')
  })
})
