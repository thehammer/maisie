import { describe, it, expect } from 'bun:test'
import {
  STD_FUNCTION_DESCRIPTORS,
  getFunctionDescriptor,
  type FunctionDescriptor,
} from '../function-registry-data'
import { STD_LIB } from '../std-lib'

// All std lib ids that must have a corresponding FunctionDescriptor
const STD_LIB_IDS = Object.keys(STD_LIB)

describe('STD_FUNCTION_DESCRIPTORS completeness', () => {
  it('has an entry for every std lib function', () => {
    const descriptorIds = new Set(STD_FUNCTION_DESCRIPTORS.map((d) => d.id))
    for (const id of STD_LIB_IDS) {
      expect(descriptorIds.has(id)).toBe(true)
    }
  })

  it('has 14 entries (one per std lib op, including std.get added in 3n)', () => {
    expect(STD_FUNCTION_DESCRIPTORS).toHaveLength(14)
  })
})

describe('FunctionDescriptor shape validation', () => {
  function assertValidDescriptor(d: FunctionDescriptor) {
    // Required string fields
    expect(typeof d.id).toBe('string')
    expect(d.id.length).toBeGreaterThan(0)
    expect(d.id).toMatch(/^std\./)

    expect(typeof d.name).toBe('string')
    expect(d.name.length).toBeGreaterThan(0)

    expect(typeof d.description).toBe('string')
    expect(d.description.length).toBeGreaterThan(0)

    // Input is always a TypeExpr
    expect(d.input).toBeDefined()
    expect(typeof d.input.kind).toBe('string')

    // Output is a FunctionOutputSpec (TypeExpr OR input-relative descriptor)
    expect(d.output).toBeDefined()
    expect(typeof (d.output as { kind: string }).kind).toBe('string')

    // Params (if present) must have valid shape
    if (d.params) {
      expect(Array.isArray(d.params)).toBe(true)
      for (const param of d.params) {
        expect(typeof param.name).toBe('string')
        expect(param.name.length).toBeGreaterThan(0)
        expect(param.type).toBeDefined()
        expect(typeof param.type.kind).toBe('string')
        if (param.inline !== undefined) {
          expect(typeof param.inline).toBe('boolean')
        }
      }
    }
  }

  for (const descriptor of STD_FUNCTION_DESCRIPTORS) {
    it(`${descriptor.id} has a valid shape`, () => {
      assertValidDescriptor(descriptor)
    })
  }
})

describe('FunctionDescriptor input/output types', () => {
  it('static collection-in, collection-out functions use collection<any> or a static TypeExpr', () => {
    // filter/sort/limit/map/unique have static collection output (passthrough via inferencer)
    const staticCollectionToCollection = ['std.filter', 'std.sort', 'std.limit', 'std.map', 'std.unique']
    for (const id of staticCollectionToCollection) {
      const d = getFunctionDescriptor(id)!
      expect(d.input.kind).toBe('collection')
      expect((d.output as { kind: string }).kind).toBe('collection')
    }
  })

  it('pluck output is collection_of_field_of (input-relative)', () => {
    const d = getFunctionDescriptor('std.pluck')!
    expect(d.input.kind).toBe('collection')
    expect((d.output as { kind: string }).kind).toBe('collection_of_field_of')
  })

  it('group output is group_of (input-relative)', () => {
    const d = getFunctionDescriptor('std.group')!
    expect(d.input.kind).toBe('collection')
    expect((d.output as { kind: string }).kind).toBe('group_of')
  })

  it('aggregation functions produce scalar output', () => {
    const count = getFunctionDescriptor('std.count')!
    expect(count.input.kind).toBe('collection')
    const countOut = count.output as { kind: string; type?: string }
    expect(countOut.kind).toBe('scalar')
    expect(countOut.type).toBe('number')

    const sum = getFunctionDescriptor('std.sum')!
    const sumOut = sum.output as { kind: string; type?: string }
    expect(sumOut.kind).toBe('scalar')
    expect(sumOut.type).toBe('number')

    const any = getFunctionDescriptor('std.any')!
    const anyOut = any.output as { kind: string; type?: string }
    expect(anyOut.kind).toBe('scalar')
    expect(anyOut.type).toBe('boolean')

    const all = getFunctionDescriptor('std.all')!
    const allOut = all.output as { kind: string; type?: string }
    expect(allOut.kind).toBe('scalar')
    expect(allOut.type).toBe('boolean')
  })

  it('first and last use element_of (input-relative) output', () => {
    const first = getFunctionDescriptor('std.first')!
    expect((first.output as { kind: string }).kind).toBe('element_of')

    const last = getFunctionDescriptor('std.last')!
    expect((last.output as { kind: string }).kind).toBe('element_of')
  })

  it('std.get uses field_of (input-relative) output with field param', () => {
    const get = getFunctionDescriptor('std.get')!
    expect(get.input.kind).toBe('record')
    const out = get.output as { kind: string; fieldParam?: string }
    expect(out.kind).toBe('field_of')
    expect(out.fieldParam).toBe('field')
  })
})

describe('FunctionDescriptor inline params', () => {
  it('filter has a predicate param marked inline', () => {
    const d = getFunctionDescriptor('std.filter')!
    expect(d.params).toBeDefined()
    const pred = d.params!.find((p) => p.name === 'predicate')
    expect(pred).toBeDefined()
    expect(pred!.inline).toBe(true)
    expect(pred!.type.kind).toBe('function')
  })

  it('sort has field and direction params with a default', () => {
    const d = getFunctionDescriptor('std.sort')!
    expect(d.params).toHaveLength(2)
    const dir = d.params!.find((p) => p.name === 'direction')
    expect(dir).toBeDefined()
    expect(dir!.default).toBe('asc')
  })

  it('limit has n param with default 10', () => {
    const d = getFunctionDescriptor('std.limit')!
    const n = d.params!.find((p) => p.name === 'n')
    expect(n).toBeDefined()
    expect(n!.default).toBe(10)
    expect(n!.type.kind).toBe('scalar')
    if (n!.type.kind === 'scalar') {
      expect(n!.type.type).toBe('number')
    }
  })

  it('count and first and last have no params', () => {
    expect(getFunctionDescriptor('std.count')!.params).toBeUndefined()
    expect(getFunctionDescriptor('std.first')!.params).toBeUndefined()
    expect(getFunctionDescriptor('std.last')!.params).toBeUndefined()
  })
})

describe('getFunctionDescriptor', () => {
  it('returns the descriptor for a known id', () => {
    const d = getFunctionDescriptor('std.filter')
    expect(d).toBeDefined()
    expect(d!.id).toBe('std.filter')
    expect(d!.name).toBe('filter')
  })

  it('returns undefined for an unknown id', () => {
    expect(getFunctionDescriptor('std.unknown')).toBeUndefined()
    expect(getFunctionDescriptor('')).toBeUndefined()
  })
})
