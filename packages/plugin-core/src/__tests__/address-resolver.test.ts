import { describe, it, expect, beforeEach } from 'bun:test'
import { createAddressResolver } from '../address-resolver'
import { EntityRegistry } from '../entity-registry'
import { registry as pluginRegistry } from '../registry'
import type { EntityDef, MaisieCollection } from '@maisie/shared'

// ── Test setup ────────────────────────────────────────────────────────────────

// We need a fresh entity registry per test. The entityRegistry singleton is
// used by createAddressResolver, so we inject fresh entities to it.
// To avoid cross-test pollution, we use a per-test local EntityRegistry but
// the address-resolver imports the singleton. We therefore clear + repopulate.
import { entityRegistry } from '../entity-registry'

const SWITCHES: MaisieCollection = [
  { name: 'front exterior lights', state: 'on' },
  { name: 'back exterior lights', state: 'off' },
]

// Mock plugin for base entity tests
function makeMockPlugin(pluginName: string, actionName: string, returnValue: unknown) {
  return {
    name: pluginName,
    version: '1.0.0',
    description: 'mock',
    capabilities: [],
    envVars: [],
    events: [],
    actions: [
      {
        name: actionName,
        description: 'mock action',
        input: { parse: () => ({}) } as any,
        output: { parse: () => ({}) } as any,
        http: { method: 'GET' as const },
        ai: { tier: 'inform' as const },
        ui: { label: 'Mock', section: 'test' },
        async execute() { return returnValue },
      },
    ],
    async init() {},
    async shutdown() {},
    async healthCheck() { return { status: 'healthy' as const, lastCheck: new Date() } },
  }
}

beforeEach(() => {
  entityRegistry.clear()
  // Don't re-register plugin-level entities between tests — plugin registry
  // accumulates. We'll register specific entities directly.
})

const ctx = {}

// ── Plugin entity resolution ──────────────────────────────────────────────────

describe('address resolver — plugin entity field', () => {
  it('resolves a data field on a plugin entity by invoking the plugin action', async () => {
    // Register entity directly (bypassing plugin registration to avoid side effects)
    const entity: EntityDef = {
      name: 'ha.list_switches',
      description: 'HA switches',
      source: 'plugin',
      pluginName: 'ha',
      fields: {
        result: { kind: 'data', type: 'collection', actionName: 'list_switches' },
      },
    }
    entityRegistry.register(entity)

    // Register the mock plugin action
    const plugin = makeMockPlugin('ha', 'list_switches', SWITCHES)
    pluginRegistry.register(plugin, () => {})

    const resolver = createAddressResolver(ctx)
    const value = await resolver.resolve('ha.list_switches.result')
    expect(value).toEqual(SWITCHES)
  })

  it('throws on unknown address', async () => {
    const resolver = createAddressResolver(ctx)
    await expect(resolver.resolve('nonexistent.entity.field')).rejects.toThrow('Unresolved address')
  })

  it('throws on accessing non-existent field', async () => {
    const entity: EntityDef = {
      name: 'simple-entity',
      source: 'derived',
      fields: {
        count: { kind: 'data', type: 'number', expression: { kind: 'literal', value: 42 } },
      },
    }
    entityRegistry.register(entity)

    const resolver = createAddressResolver(ctx)
    await expect(resolver.resolve('simple-entity.missing')).rejects.toThrow('Field "missing" not found')
  })
})

// ── Derived entity resolution ─────────────────────────────────────────────────

describe('address resolver — derived entity field', () => {
  it('resolves a derived data field with literal expression', async () => {
    const entity: EntityDef = {
      name: 'my-entity',
      source: 'derived',
      fields: {
        count: { kind: 'data', type: 'number', expression: { kind: 'literal', value: 42 } },
      },
    }
    entityRegistry.register(entity)

    const resolver = createAddressResolver(ctx)
    const value = await resolver.resolve('my-entity.count')
    expect(value).toBe(42)
  })

  it('resolves a derived data field that references another entity', async () => {
    // Register a base entity with mock action
    const baseEntity: EntityDef = {
      name: 'mock-plugin.list_items',
      source: 'plugin',
      pluginName: 'mock-plugin',
      fields: {
        result: { kind: 'data', type: 'collection', actionName: 'list_items' },
      },
    }
    entityRegistry.register(baseEntity)
    pluginRegistry.register(makeMockPlugin('mock-plugin', 'list_items', SWITCHES), () => {})

    // Derived entity whose expression references the base entity's result
    const derivedEntity: EntityDef = {
      name: 'derived-wrapper',
      source: 'derived',
      fields: {
        switches: {
          kind: 'data',
          type: 'collection',
          expression: { kind: 'ref', name: 'mock-plugin.list_items.result' },
        },
      },
    }
    entityRegistry.register(derivedEntity)

    const resolver = createAddressResolver(ctx)
    const value = await resolver.resolve('derived-wrapper.switches')
    expect(value).toEqual(SWITCHES)
  })

  it('resolves with nested field access (entity.field.subfield)', async () => {
    const entity: EntityDef = {
      name: 'nested-entity',
      source: 'derived',
      fields: {
        info: {
          kind: 'data',
          type: 'record',
          expression: { kind: 'literal', value: { name: 'test', level: 99 } as never },
        },
      },
    }
    entityRegistry.register(entity)

    const resolver = createAddressResolver(ctx)
    const value = await resolver.resolve('nested-entity.info.name')
    expect(value).toBe('test')

    const level = await resolver.resolve('nested-entity.info.level')
    expect(level).toBe(99)
  })
})

// ── invoke ────────────────────────────────────────────────────────────────────

describe('address resolver — invoke', () => {
  it('invokes a plugin function field', async () => {
    // Use 'invoke_toggle' — the 'invoke_' prefix makes synthesizeEntityFromAction
    // produce a function field. Register the plugin first so synthesis runs,
    // then resolve the synthesized entity.
    pluginRegistry.register(makeMockPlugin('inv-plugin', 'invoke_toggle', { success: true }), () => {})

    const resolver = createAddressResolver(ctx)
    // Synthesized entity name: "inv-plugin.invoke_toggle", field: "result"
    const result = await resolver.invoke('inv-plugin.invoke_toggle.result', {})
    expect(result).toEqual({ success: true })
  })

  it('invokes a derived function field with args', async () => {
    // A derived function field whose body adds two values: the `x` arg + literal
    const entity: EntityDef = {
      name: 'math-entity',
      source: 'derived',
      fields: {
        addOne: {
          kind: 'function',
          params: [{ name: 'x', type: 'number' }],
          returnType: 'number',
          tier: 'advise',
          expression: {
            kind: 'apply', fn: 'add',
            args: [{ kind: 'ref', name: 'x' }, { kind: 'literal', value: 1 }],
          },
        },
      },
    }
    entityRegistry.register(entity)

    const resolver = createAddressResolver(ctx)
    const result = await resolver.invoke('math-entity.addOne', { x: 9 })
    expect(result).toBe(10)
  })

  it('throws on invoke of non-function field', async () => {
    const entity: EntityDef = {
      name: 'data-entity',
      source: 'derived',
      fields: {
        value: { kind: 'data', type: 'number', expression: { kind: 'literal', value: 5 } },
      },
    }
    entityRegistry.register(entity)

    const resolver = createAddressResolver(ctx)
    await expect(resolver.invoke('data-entity.value', {})).rejects.toThrow('not a function field')
  })

  it('throws on invoke with unknown address', async () => {
    const resolver = createAddressResolver(ctx)
    await expect(resolver.invoke('nonexistent.action', {})).rejects.toThrow('Unresolved address')
  })
})

// ── Self-reference resolution (Phase 3) ──────────────────────────────────────

describe('address resolver — self references', () => {
  it('derived entity with self.otherField resolves correctly', async () => {
    // Entity with two data fields: 'base' is a literal, 'derived' uses self.base
    const entity: EntityDef = {
      name: 'self-test-entity',
      source: 'derived',
      fields: {
        base: {
          kind: 'data',
          type: 'number',
          expression: { kind: 'literal', value: 10 },
        },
        doubled: {
          kind: 'data',
          type: 'number',
          // self.base * 2 — using apply(add, [get(self, 'base'), get(self, 'base')])
          expression: {
            kind: 'apply',
            fn: 'add',
            args: [
              { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'self' }, { kind: 'literal', value: 'base' }] },
              { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'self' }, { kind: 'literal', value: 'base' }] },
            ],
          },
        },
      },
    }
    entityRegistry.register(entity)

    const resolver = createAddressResolver(ctx)
    const value = await resolver.resolve('self-test-entity.doubled')
    expect(value).toBe(20)
  })

  it('self record includes data fields resolved and function wrappers', async () => {
    // Entity with one data field and one function field
    // The function field's body reads self.count and returns it + 1
    const entity: EntityDef = {
      name: 'self-fn-entity',
      source: 'derived',
      fields: {
        count: {
          kind: 'data',
          type: 'number',
          expression: { kind: 'literal', value: 5 },
        },
        countPlusOne: {
          kind: 'function',
          params: [],
          returnType: 'number',
          tier: 'inform',
          expression: {
            kind: 'apply',
            fn: 'add',
            args: [
              { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'self' }, { kind: 'literal', value: 'count' }] },
              { kind: 'literal', value: 1 },
            ],
          },
        },
      },
    }
    entityRegistry.register(entity)

    const resolver = createAddressResolver(ctx)
    const result = await resolver.invoke('self-fn-entity.countPlusOne', {})
    expect(result).toBe(6)
  })

  it('cycle detection: field A → self.B → self.A throws clear error', async () => {
    // fieldA expression reads self.fieldB
    // fieldB expression reads self.fieldA → cycle
    const fieldAExpr = {
      kind: 'apply' as const,
      fn: 'get',
      args: [{ kind: 'ref' as const, name: 'self' }, { kind: 'literal' as const, value: 'fieldB' }],
    }
    const fieldBExpr = {
      kind: 'apply' as const,
      fn: 'get',
      args: [{ kind: 'ref' as const, name: 'self' }, { kind: 'literal' as const, value: 'fieldA' }],
    }
    const entity: EntityDef = {
      name: 'cyclic-entity',
      source: 'derived',
      fields: {
        fieldA: { kind: 'data', type: 'number', expression: fieldAExpr },
        fieldB: { kind: 'data', type: 'number', expression: fieldBExpr },
      },
    }
    entityRegistry.register(entity)

    const resolver = createAddressResolver(ctx)
    await expect(resolver.resolve('cyclic-entity.fieldA')).rejects.toThrow('Cycle detected')
  })
})

// ── Longest prefix matching ───────────────────────────────────────────────────

describe('address resolver — longest prefix matching', () => {
  it('resolves entity with dotted name (e.g. home-assistant.list_switches)', async () => {
    const plugin = makeMockPlugin('ha2', 'list_switches', SWITCHES)
    pluginRegistry.register(plugin, () => {})

    const entity: EntityDef = {
      name: 'ha2.list_switches',
      source: 'plugin',
      pluginName: 'ha2',
      fields: {
        result: { kind: 'data', type: 'collection', actionName: 'list_switches' },
      },
    }
    entityRegistry.register(entity)

    const resolver = createAddressResolver(ctx)
    // Address: "ha2.list_switches.result"
    // Should match entity "ha2.list_switches" with remaining path ["result"]
    const value = await resolver.resolve('ha2.list_switches.result')
    expect(value).toEqual(SWITCHES)
  })
})
