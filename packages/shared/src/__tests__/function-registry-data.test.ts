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

  it('has 13 entries (one per std lib op)', () => {
    expect(STD_FUNCTION_DESCRIPTORS).toHaveLength(13)
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

    // Input and output TypeExprs
    expect(d.input).toBeDefined()
    expect(typeof d.input.kind).toBe('string')

    expect(d.output).toBeDefined()
    expect(typeof d.output.kind).toBe('string')

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
  it('collection-in, collection-out functions use collection<any>', () => {
    const collectionToCollection = ['std.filter', 'std.sort', 'std.limit', 'std.map', 'std.pluck', 'std.group', 'std.unique']
    for (const id of collectionToCollection) {
      const d = getFunctionDescriptor(id)!
      expect(d.input.kind).toBe('collection')
      expect(d.output.kind).toBe('collection')
    }
  })

  it('aggregation functions produce scalar output', () => {
    const count = getFunctionDescriptor('std.count')!
    expect(count.input.kind).toBe('collection')
    expect(count.output.kind).toBe('scalar')
    if (count.output.kind === 'scalar') {
      expect(count.output.type).toBe('number')
    }

    const sum = getFunctionDescriptor('std.sum')!
    expect(sum.output.kind).toBe('scalar')
    if (sum.output.kind === 'scalar') {
      expect(sum.output.type).toBe('number')
    }

    const any = getFunctionDescriptor('std.any')!
    expect(any.output.kind).toBe('scalar')
    if (any.output.kind === 'scalar') {
      expect(any.output.type).toBe('boolean')
    }

    const all = getFunctionDescriptor('std.all')!
    expect(all.output.kind).toBe('scalar')
    if (all.output.kind === 'scalar') {
      expect(all.output.type).toBe('boolean')
    }
  })

  it('first and last produce any output (element type unknown)', () => {
    const first = getFunctionDescriptor('std.first')!
    expect(first.output.kind).toBe('any')

    const last = getFunctionDescriptor('std.last')!
    expect(last.output.kind).toBe('any')
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
