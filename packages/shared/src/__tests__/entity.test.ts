import { describe, it, expect } from 'bun:test'
import { validateEntityDef } from '../entity'
import type { EntityDef } from '../entity'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePluginEntity(overrides: Partial<EntityDef> = {}): EntityDef {
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

function makeDerivedEntity(overrides: Partial<EntityDef> = {}): EntityDef {
  return {
    name: 'exterior-lights',
    source: 'derived',
    fields: {
      switches: {
        kind: 'data',
        type: 'collection',
        expression: { kind: 'literal', value: null },
      },
    },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('validateEntityDef', () => {
  it('valid plugin entity passes', () => {
    const errors = validateEntityDef(makePluginEntity())
    expect(errors).toEqual([])
  })

  it('valid derived entity passes', () => {
    const errors = validateEntityDef(makeDerivedEntity())
    expect(errors).toEqual([])
  })

  it('missing name fails', () => {
    const errors = validateEntityDef(makePluginEntity({ name: '' }))
    expect(errors.some((e) => e.includes('name is required'))).toBe(true)
  })

  it('invalid name characters fail', () => {
    const errors = validateEntityDef(makePluginEntity({ name: '123bad name!' }))
    expect(errors.some((e) => e.includes('invalid entity name'))).toBe(true)
  })

  it('missing pluginName on plugin entity fails', () => {
    const entity = makePluginEntity()
    delete (entity as any).pluginName
    const errors = validateEntityDef(entity)
    expect(errors.some((e) => e.includes('must have pluginName'))).toBe(true)
  })

  it('missing actionName on plugin data field fails', () => {
    const entity = makePluginEntity({
      fields: {
        result: {
          kind: 'data',
          type: 'collection',
          // actionName omitted
        },
      },
    })
    const errors = validateEntityDef(entity)
    expect(errors.some((e) => e.includes('plugin data field must have actionName'))).toBe(true)
  })

  it('missing expression on derived data field fails', () => {
    const entity = makeDerivedEntity({
      fields: {
        switches: {
          kind: 'data',
          type: 'collection',
          // expression omitted
        },
      },
    })
    const errors = validateEntityDef(entity)
    expect(errors.some((e) => e.includes('derived data field must have expression'))).toBe(true)
  })

  it('invalid tier on function field fails', () => {
    const entity = makePluginEntity({
      fields: {
        result: {
          kind: 'function',
          params: [],
          returnType: 'record',
          actionName: 'invoke_something',
          tier: 'invalid' as any,
        },
      },
    })
    const errors = validateEntityDef(entity)
    expect(errors.some((e) => e.includes('invalid tier'))).toBe(true)
  })

  it('reserved field name "self" fails', () => {
    const entity = makePluginEntity({
      fields: {
        self: {
          kind: 'data',
          type: 'string',
          actionName: 'list_devices',
        },
      },
    })
    const errors = validateEntityDef(entity)
    expect(errors.some((e) => e.includes('"self" is reserved'))).toBe(true)
  })

  it('reserved field name "description" fails', () => {
    const entity = makePluginEntity({
      fields: {
        description: {
          kind: 'data',
          type: 'string',
          actionName: 'list_devices',
        },
      },
    })
    const errors = validateEntityDef(entity)
    expect(errors.some((e) => e.includes('"description" is reserved'))).toBe(true)
  })

  it('empty fields fails', () => {
    const errors = validateEntityDef(makePluginEntity({ fields: {} }))
    expect(errors.some((e) => e.includes('at least one field'))).toBe(true)
  })

  it('valid plugin function field passes', () => {
    const entity = makePluginEntity({
      fields: {
        result: {
          kind: 'function',
          params: [{ name: 'id', type: 'string' }],
          returnType: 'record',
          actionName: 'invoke_action',
          tier: 'advise',
        },
      },
    })
    const errors = validateEntityDef(entity)
    expect(errors).toEqual([])
  })

  it('valid derived function field passes', () => {
    const entity = makeDerivedEntity({
      fields: {
        toggle: {
          kind: 'function',
          params: [],
          returnType: 'record',
          expression: { kind: 'literal', value: null },
          tier: 'act',
        },
      },
    })
    const errors = validateEntityDef(entity)
    expect(errors).toEqual([])
  })

  it('missing actionName on plugin function field fails', () => {
    const entity = makePluginEntity({
      fields: {
        result: {
          kind: 'function',
          params: [],
          returnType: 'record',
          // actionName omitted
          tier: 'act',
        },
      },
    })
    const errors = validateEntityDef(entity)
    expect(errors.some((e) => e.includes('plugin function field must have actionName'))).toBe(true)
  })

  it('missing expression on derived function field fails', () => {
    const entity = makeDerivedEntity({
      fields: {
        toggle: {
          kind: 'function',
          params: [],
          returnType: 'record',
          // expression omitted
          tier: 'act',
        },
      },
    })
    const errors = validateEntityDef(entity)
    expect(errors.some((e) => e.includes('derived function field must have expression'))).toBe(true)
  })
})
