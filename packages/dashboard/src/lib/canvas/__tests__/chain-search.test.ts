import { describe, it, expect } from 'bun:test'
import { findBridgingChains } from '../chain-search'
import { getFunctionDescriptor, inferFunctionOutput } from '@maisie/shared'
import type { TypeExpr } from '@maisie/shared'

// ── TypeExpr fixtures ──────────────────────────────────────────────────────────

const anyType: TypeExpr = { kind: 'any' }
const stringType: TypeExpr = { kind: 'scalar', type: 'string' }
const numberType: TypeExpr = { kind: 'scalar', type: 'number' }
const booleanType: TypeExpr = { kind: 'scalar', type: 'boolean' }

const collectionAny: TypeExpr = { kind: 'collection', element: anyType }

const recordNameState: TypeExpr = {
  kind: 'record',
  fields: {
    name: stringType,
    state: stringType,
  },
}
const collectionRecordNameState: TypeExpr = {
  kind: 'collection',
  element: recordNameState,
}

const recordNameAddedAt: TypeExpr = {
  kind: 'record',
  fields: {
    name: stringType,
    addedAt: stringType,
  },
}
const collectionRecordNameAddedAt: TypeExpr = {
  kind: 'collection',
  element: recordNameAddedAt,
}

// ── Empty chain when already compatible ───────────────────────────────────────

describe('findBridgingChains — no chain needed', () => {
  it('returns empty array when source already satisfies target', () => {
    const chains = findBridgingChains(collectionAny, collectionAny)
    expect(chains).toEqual([])
  })

  it('returns empty array when source record satisfies target record (structural)', () => {
    // Source has name + state; target requires only name
    const target: TypeExpr = { kind: 'record', fields: { name: stringType } }
    const source: TypeExpr = { kind: 'record', fields: { name: stringType, state: stringType } }
    const chains = findBridgingChains(source, target)
    expect(chains).toEqual([])
  })

  it('returns empty array when source is any (satisfies anything)', () => {
    const chains = findBridgingChains(anyType, numberType)
    expect(chains).toEqual([])
  })
})

// ── Single-step chains ─────────────────────────────────────────────────────────

describe('findBridgingChains — single step', () => {
  it('finds count as 1-step chain from collection to scalar<number>', () => {
    const chains = findBridgingChains(collectionRecordNameState, numberType)
    expect(chains.length).toBeGreaterThan(0)
    // Shortest chain should be 1 step
    const shortest = chains[0]
    expect(shortest.steps).toHaveLength(1)
    expect(shortest.steps[0].functionId).toBe('std.count')
    expect(shortest.outputType).toEqual(numberType)
  })

  it('finds any → boolean chain from collection to scalar<boolean>', () => {
    const chains = findBridgingChains(collectionRecordNameState, booleanType)
    expect(chains.length).toBeGreaterThan(0)
    const shortest = chains[0]
    expect(shortest.steps).toHaveLength(1)
    // any/all return boolean from collection
    expect(['std.any', 'std.all']).toContain(shortest.steps[0].functionId)
  })

  it('finds filter/sort/limit as 1-step chains from collection<record> to collection<any>', () => {
    // collection<record> satisfies collection<any> directly — should return empty
    const chains = findBridgingChains(collectionRecordNameState, collectionAny)
    expect(chains).toEqual([])
  })
})

// ── Two-step chains ────────────────────────────────────────────────────────────

describe('findBridgingChains — two steps', () => {
  it('finds 2-step chains (filter → count, sort → count, etc.) from collection<record> to scalar<number>', () => {
    // Source: collection<record{name, state}>, Target: scalar<number>
    // Depth 2 allows: filter→count, sort→count, limit→count (passthrough → count)
    const chains = findBridgingChains(collectionRecordNameState, numberType, 2)
    expect(chains.length).toBeGreaterThan(0)
    // The single-step chain (count) should come before 2-step chains
    const singleStep = chains.filter((c) => c.steps.length === 1)
    expect(singleStep.length).toBeGreaterThan(0)
    expect(singleStep[0].steps[0].functionId).toBe('std.count')
  })

  it('produces shorter chains before longer ones', () => {
    const chains = findBridgingChains(collectionRecordNameState, numberType)
    for (let i = 1; i < chains.length; i++) {
      expect(chains[i].steps.length).toBeGreaterThanOrEqual(chains[i - 1].steps.length)
    }
  })
})

// ── No chain found ─────────────────────────────────────────────────────────────

describe('findBridgingChains — no chain exists', () => {
  it('returns empty when no std function can produce a collection from a scalar', () => {
    // scalar<boolean> → collection<record> — no std function does this
    const chains = findBridgingChains(booleanType, collectionRecordNameState, 3)
    // No function takes a boolean input in STD_FUNCTION_DESCRIPTORS
    expect(chains).toEqual([])
  })
})

// ── Max depth ─────────────────────────────────────────────────────────────────

describe('findBridgingChains — maxDepth', () => {
  it('respects maxDepth=1', () => {
    // Only single-step chains allowed
    const chains = findBridgingChains(collectionRecordNameState, anyType, 1)
    for (const chain of chains) {
      expect(chain.steps.length).toBeLessThanOrEqual(1)
    }
  })

  it('respects maxDepth=0 — never expands', () => {
    const chains = findBridgingChains(collectionRecordNameState, numberType, 0)
    expect(chains).toEqual([])
  })
})

// ── Deduplication ─────────────────────────────────────────────────────────────

describe('findBridgingChains — deduplication', () => {
  it('does not return duplicate chains for the same head type', () => {
    // collection<record{name, addedAt}> → scalar<number>
    // filter, sort, limit, unique all return collection<record{...}> — same head type
    // the search must not explore all of them repeatedly
    const chains = findBridgingChains(collectionRecordNameAddedAt, numberType, 2)
    // All returned chains should be unique by step sequence
    const signatures = chains.map((c) => c.steps.map((s) => s.functionId).join('→'))
    const unique = new Set(signatures)
    expect(unique.size).toBe(signatures.length)
  })
})

// ── inferFunctionOutput ────────────────────────────────────────────────────────
// Note: inferFunctionOutput is now from @maisie/shared with signature
// (descriptor, upstreamType, params) — the shared generalized inferencer.

describe('inferFunctionOutput', () => {
  it('preserves element type for filter (collection<T> → collection<T>)', () => {
    const desc = getFunctionDescriptor('std.filter')!
    const inputType: TypeExpr = { kind: 'collection', element: recordNameState }
    const output = inferFunctionOutput(desc, inputType, {})
    expect(output).toEqual({ kind: 'collection', element: recordNameState })
  })

  it('preserves element type for sort', () => {
    const desc = getFunctionDescriptor('std.sort')!
    const inputType: TypeExpr = { kind: 'collection', element: numberType }
    const output = inferFunctionOutput(desc, inputType, {})
    expect(output).toEqual({ kind: 'collection', element: numberType })
  })

  it('preserves element type for limit', () => {
    const desc = getFunctionDescriptor('std.limit')!
    const inputType: TypeExpr = { kind: 'collection', element: stringType }
    const output = inferFunctionOutput(desc, inputType, {})
    expect(output).toEqual({ kind: 'collection', element: stringType })
  })

  it('returns declared output for count (no polymorphism)', () => {
    const desc = getFunctionDescriptor('std.count')!
    const output = inferFunctionOutput(desc, collectionAny, {})
    expect(output).toEqual({ kind: 'scalar', type: 'number' })
  })

  it('returns collection<any> for pluck when field name not known', () => {
    const desc = getFunctionDescriptor('std.pluck')!
    const output = inferFunctionOutput(desc, collectionRecordNameState, {})
    expect(output.kind).toBe('collection')
    if (output.kind === 'collection') {
      expect(output.element.kind).toBe('any')
    }
  })

  it('returns collection<fieldType> for pluck when field name is known', () => {
    const desc = getFunctionDescriptor('std.pluck')!
    const output = inferFunctionOutput(desc, collectionRecordNameState, { field: 'name' })
    expect(output).toEqual({ kind: 'collection', element: stringType })
  })

  it('returns element type for first (element_of)', () => {
    const desc = getFunctionDescriptor('std.first')!
    const output = inferFunctionOutput(desc, collectionRecordNameState, {})
    // first unwraps collection<record{name, state}> → record{name, state}
    expect(output).toEqual(recordNameState)
  })

  it('returns any for first when upstream is not a collection', () => {
    const desc = getFunctionDescriptor('std.first')!
    const output = inferFunctionOutput(desc, stringType, {})
    expect(output).toEqual({ kind: 'any' })
  })

  it('returns any for first when upstream is undefined', () => {
    const desc = getFunctionDescriptor('std.first')!
    const output = inferFunctionOutput(desc, undefined, {})
    expect(output).toEqual({ kind: 'any' })
  })
})
