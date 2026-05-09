import { describe, it, expect, beforeEach } from 'bun:test'
import { z } from 'zod'
import { defineAction } from '@maisie/shared'
import type { MaisiePlugin, PluginAction } from '@maisie/shared'
import type { EntityDef } from '@maisie/shared'
import {
  EntityRegistry,
  synthesizeEntityFromAction,
  synthesizeEntitiesForPlugin,
} from '../entity-registry'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeValidPluginEntity(overrides: Partial<EntityDef> = {}): EntityDef {
  return {
    name: 'test-plugin.list_devices',
    source: 'plugin',
    pluginName: 'test-plugin',
    section: 'network',
    fields: {
      result: {
        kind: 'data',
        type: 'collection',
        actionName: 'list_devices',
      },
    },
    ...overrides,
  }
}

const listAction: PluginAction = defineAction({
  name: 'list_devices',
  description: 'List all network devices',
  input: z.object({}),
  output: z.array(z.object({ id: z.string(), name: z.string() })),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Devices', section: 'network' },
  async execute() { return [] },
})

const invokeAction: PluginAction = defineAction({
  name: 'invoke_reboot',
  description: 'Reboot a device',
  input: z.object({ id: z.string() }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST' },
  ai: { tier: 'advise' },
  ui: { label: 'Reboot Device', section: 'network' },
  async execute() { return { success: true } },
})

const uiFalseAction: PluginAction = defineAction({
  name: 'get_internal_state',
  description: 'Internal state',
  input: z.object({}),
  output: z.object({ state: z.string() }),
  http: { method: 'GET' },
  ai: false,
  ui: false,
  async execute() { return { state: 'ok' } },
})

const fakePlugin: MaisiePlugin = {
  name: 'test-plugin',
  version: '1.0.0',
  description: 'Test plugin',
  capabilities: [],
  envVars: [],
  actions: [listAction, invokeAction, uiFalseAction],
  events: [],
  async init() {},
  async shutdown() {},
  async healthCheck() { return { status: 'healthy', lastCheck: new Date() } },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EntityRegistry', () => {
  let registry: EntityRegistry

  beforeEach(() => {
    registry = new EntityRegistry()
  })

  it('register valid entity — appears in list() and get()', () => {
    const entity = makeValidPluginEntity()
    registry.register(entity)

    // +3 for the synthetic catalog, memory, and views entities always registered at construction
    expect(registry.list()).toHaveLength(4)
    expect(registry.get('test-plugin.list_devices')).toEqual(entity)
  })

  it('register invalid entity — throws', () => {
    const entity = makeValidPluginEntity({ name: '' })
    expect(() => registry.register(entity)).toThrow('Invalid entity')
  })

  it('unregister — removed from list and get', () => {
    registry.register(makeValidPluginEntity())
    const removed = registry.unregister('test-plugin.list_devices')

    expect(removed).toBe(true)
    // Only the synthetic catalog, memory, and views entities remain
    expect(registry.list()).toHaveLength(3)
    expect(registry.get('test-plugin.list_devices')).toBeUndefined()
  })

  it('unregister non-existent — returns false', () => {
    const removed = registry.unregister('does-not-exist')
    expect(removed).toBe(false)
  })

  it('findBySection filters correctly', () => {
    registry.register(makeValidPluginEntity({ name: 'a.action', section: 'network' }))
    registry.register(makeValidPluginEntity({
      name: 'b.action',
      section: 'media',
      fields: { result: { kind: 'data', type: 'collection', actionName: 'list_media' } },
    }))
    registry.register(makeValidPluginEntity({ name: 'c.action', section: 'network' }))

    const network = registry.findBySection('network')
    const media = registry.findBySection('media')
    const other = registry.findBySection('other')

    expect(network).toHaveLength(2)
    expect(media).toHaveLength(1)
    expect(other).toHaveLength(0)
  })

  it('findByInterface matches entities with required fields', () => {
    // Entity with a data 'result' field of type 'collection'
    registry.register(makeValidPluginEntity({ name: 'p.list_things' }))

    // Entity with a function 'toggle' field
    registry.register(makeValidPluginEntity({
      name: 'p.invoke_toggle',
      fields: {
        result: {
          kind: 'function',
          params: [],
          returnType: 'record',
          actionName: 'invoke_toggle',
          tier: 'act',
        },
      },
    }))

    const dataMatches = registry.findByInterface({ result: { kind: 'data', type: 'collection' } })
    const fnMatches = registry.findByInterface({ result: { kind: 'function' } })
    const noMatch = registry.findByInterface({ nonexistent: { kind: 'data' } })

    expect(dataMatches).toHaveLength(1)
    expect(dataMatches[0].name).toBe('p.list_things')
    expect(fnMatches).toHaveLength(1)
    expect(fnMatches[0].name).toBe('p.invoke_toggle')
    expect(noMatch).toHaveLength(0)
  })

  it('findByInterface type filter narrows correctly', () => {
    registry.register(makeValidPluginEntity({ name: 'p.list_records' }))
    registry.register(makeValidPluginEntity({
      name: 'p.list_scalars',
      fields: { result: { kind: 'data', type: 'string', actionName: 'list_scalars' } },
    }))

    const collectionOnly = registry.findByInterface({ result: { kind: 'data', type: 'collection' } })
    const stringOnly = registry.findByInterface({ result: { kind: 'data', type: 'string' } })

    expect(collectionOnly).toHaveLength(1)
    expect(collectionOnly[0].name).toBe('p.list_records')
    expect(stringOnly).toHaveLength(1)
    expect(stringOnly[0].name).toBe('p.list_scalars')
  })
})

describe('synthesizeEntityFromAction', () => {
  it('produces correct output for list_ action', () => {
    const entity = synthesizeEntityFromAction(fakePlugin, listAction)

    expect(entity).not.toBeNull()
    expect(entity!.name).toBe('test-plugin.list_devices')
    expect(entity!.source).toBe('plugin')
    expect(entity!.pluginName).toBe('test-plugin')
    expect(entity!.section).toBe('network')
    expect(entity!.description).toBe('List all network devices')

    const resultField = entity!.fields.result
    expect(resultField.kind).toBe('data')
    if (resultField.kind === 'data') {
      expect(resultField.actionName).toBe('list_devices')
      // Phase 3g: type is now a TypeExpr derived from the action's Zod output schema
      // list_devices returns z.array(z.object({...})) → collection<record>
      expect(typeof resultField.type).toBe('object')
      const t = resultField.type as { kind: string }
      expect(t.kind).toBe('collection')
    }
  })

  it('produces correct output for invoke_ action (function field)', () => {
    const entity = synthesizeEntityFromAction(fakePlugin, invokeAction)

    expect(entity).not.toBeNull()
    expect(entity!.name).toBe('test-plugin.invoke_reboot')

    const resultField = entity!.fields.result
    expect(resultField.kind).toBe('function')
    if (resultField.kind === 'function') {
      expect(resultField.actionName).toBe('invoke_reboot')
      expect(resultField.tier).toBe('advise')
      expect(resultField.returnType).toBe('record')
    }
  })

  it('returns null when ui is false', () => {
    const entity = synthesizeEntityFromAction(fakePlugin, uiFalseAction)
    expect(entity).toBeNull()
  })

  it('set_ verb produces function field', () => {
    const setAction: PluginAction = defineAction({
      name: 'set_brightness',
      description: 'Set brightness',
      input: z.object({ value: z.number() }),
      output: z.object({ success: z.boolean() }),
      http: { method: 'POST' },
      ai: { tier: 'act' },
      ui: { label: 'Set Brightness', section: 'lights' },
      async execute() { return { success: true } },
    })
    const entity = synthesizeEntityFromAction(fakePlugin, setAction)
    expect(entity?.fields.result.kind).toBe('function')
  })

  it('create_ verb produces function field', () => {
    const createAction: PluginAction = defineAction({
      name: 'create_rule',
      description: 'Create a rule',
      input: z.object({ name: z.string() }),
      output: z.object({ id: z.string() }),
      http: { method: 'POST' },
      ai: { tier: 'advise' },
      ui: { label: 'Create Rule', section: 'automation' },
      async execute() { return { id: 'new-id' } },
    })
    const entity = synthesizeEntityFromAction(fakePlugin, createAction)
    expect(entity?.fields.result.kind).toBe('function')
  })

  it('delete_ verb produces function field', () => {
    const deleteAction: PluginAction = defineAction({
      name: 'delete_rule',
      description: 'Delete a rule',
      input: z.object({ id: z.string() }),
      output: z.object({ success: z.boolean() }),
      http: { method: 'DELETE' },
      ai: { tier: 'advise' },
      ui: { label: 'Delete Rule', section: 'automation' },
      async execute() { return { success: true } },
    })
    const entity = synthesizeEntityFromAction(fakePlugin, deleteAction)
    expect(entity?.fields.result.kind).toBe('function')
  })

  it('get_ verb produces data field', () => {
    const getAction: PluginAction = defineAction({
      name: 'get_status',
      description: 'Get status',
      input: z.object({}),
      output: z.object({ status: z.string() }),
      http: { method: 'GET' },
      ai: { tier: 'inform' },
      ui: { label: 'Status', section: 'system' },
      async execute() { return { status: 'ok' } },
    })
    const entity = synthesizeEntityFromAction(fakePlugin, getAction)
    expect(entity?.fields.result.kind).toBe('data')
  })

  it('ai: false action defaults tier to advise on function field', () => {
    const noAiAction: PluginAction = defineAction({
      name: 'invoke_something',
      description: 'Do something',
      input: z.object({}),
      output: z.object({ success: z.boolean() }),
      http: { method: 'POST' },
      ai: false,
      ui: { label: 'Do Something', section: 'misc' },
      async execute() { return { success: true } },
    })
    const entity = synthesizeEntityFromAction(fakePlugin, noAiAction)
    const field = entity?.fields.result
    expect(field?.kind).toBe('function')
    if (field?.kind === 'function') {
      expect(field.tier).toBe('advise')
    }
  })
})

describe('synthesizeEntitiesForPlugin', () => {
  it('returns entities for all ui-enabled actions, skips ui: false', () => {
    const entities = synthesizeEntitiesForPlugin(fakePlugin)

    // fakePlugin has 3 actions: list_devices, invoke_reboot (ui enabled), get_internal_state (ui: false)
    expect(entities).toHaveLength(2)
    const names = entities.map((e) => e.name)
    expect(names).toContain('test-plugin.list_devices')
    expect(names).toContain('test-plugin.invoke_reboot')
    expect(names).not.toContain('test-plugin.get_internal_state')
  })
})
