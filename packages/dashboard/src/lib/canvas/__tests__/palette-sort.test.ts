import { describe, it, expect } from 'bun:test'
import {
  classifyCompatibility,
  sortByCompatibility,
  annotateCompatibility,
} from '../palette-sort'
import type { TypeExpr } from '@maisie/shared'
import type { CompatibilityStatus, WithCompatibility } from '../palette-sort'

// ── TypeExpr fixtures ──────────────────────────────────────────────────────────

const stringType: TypeExpr = { kind: 'scalar', type: 'string' }
const numberType: TypeExpr = { kind: 'scalar', type: 'number' }
const urlType: TypeExpr = { kind: 'scalar', type: 'url' }
const anyType: TypeExpr = { kind: 'any' }
const collectionString: TypeExpr = { kind: 'collection', element: stringType }
const collectionNumber: TypeExpr = { kind: 'collection', element: numberType }
const collectionAny: TypeExpr = { kind: 'collection', element: anyType }

const recordA: TypeExpr = {
  kind: 'record',
  fields: { name: stringType, count: numberType },
}
const recordB: TypeExpr = {
  kind: 'record',
  fields: { title: stringType, rating: numberType },
}
const recordSubset: TypeExpr = {
  kind: 'record',
  fields: { name: stringType },  // subset of recordA — satisfies recordA
}

// ── classifyCompatibility ─────────────────────────────────────────────────────

describe('classifyCompatibility', () => {
  it('returns unknown when candidate is undefined', () => {
    expect(classifyCompatibility(undefined, stringType)).toBe('unknown')
  })

  it('returns unknown when target is undefined', () => {
    expect(classifyCompatibility(stringType, undefined)).toBe('unknown')
  })

  it('returns unknown when both are undefined', () => {
    expect(classifyCompatibility(undefined, undefined)).toBe('unknown')
  })

  it('returns compatible for exact scalar match', () => {
    expect(classifyCompatibility(stringType, stringType)).toBe('compatible')
  })

  it('returns compatible for semantic subtype (url satisfies string)', () => {
    expect(classifyCompatibility(urlType, stringType)).toBe('compatible')
  })

  it('returns compatible for record superset satisfying record subset', () => {
    // recordA has {name, count} — satisfies recordSubset which only needs {name}
    expect(classifyCompatibility(recordA, recordSubset)).toBe('compatible')
  })

  it('returns compatible for collection<any> → collection<any>', () => {
    expect(classifyCompatibility(collectionAny, collectionAny)).toBe('compatible')
  })

  it('returns chain for record→record mismatch (different fields)', () => {
    // recordA vs recordB: same top-level kind, different fields → chain
    expect(classifyCompatibility(recordA, recordB)).toBe('chain')
  })

  it('returns chain for collection→collection mismatch', () => {
    // Both collections but element types differ
    expect(classifyCompatibility(collectionString, collectionNumber)).toBe('chain')
  })

  it('returns compatible when candidate is any (any satisfies everything)', () => {
    // satisfies(any, record) → ok (any is a wildcard that satisfies any target)
    expect(classifyCompatibility(anyType, recordA)).toBe('compatible')
  })

  it('returns compatible when target is any', () => {
    // satisfies(record, any) → ok
    expect(classifyCompatibility(recordA, anyType)).toBe('compatible')
  })

  it('returns incompatible for scalar→record', () => {
    expect(classifyCompatibility(stringType, recordA)).toBe('incompatible')
  })

  it('returns incompatible for record→scalar', () => {
    expect(classifyCompatibility(recordA, stringType)).toBe('incompatible')
  })

  it('returns incompatible for collection→scalar', () => {
    expect(classifyCompatibility(collectionString, numberType)).toBe('incompatible')
  })

  it('returns incompatible for scalar→collection', () => {
    expect(classifyCompatibility(numberType, collectionString)).toBe('incompatible')
  })
})

// ── sortByCompatibility ───────────────────────────────────────────────────────

describe('sortByCompatibility', () => {
  function makeItems(statuses: CompatibilityStatus[]) {
    return statuses.map((s, i) => ({ id: i, compatibilityStatus: s }))
  }

  it('sorts compatible before chain before incompatible before unknown', () => {
    const items: (WithCompatibility & { id: number })[] = [
      { id: 0, compatibilityStatus: 'unknown' },
      { id: 1, compatibilityStatus: 'incompatible' },
      { id: 2, compatibilityStatus: 'chain' },
      { id: 3, compatibilityStatus: 'compatible' },
    ]
    const sorted = sortByCompatibility(items)
    expect(sorted.map((x) => x.compatibilityStatus)).toEqual([
      'compatible',
      'chain',
      'incompatible',
      'unknown',
    ])
  })

  it('preserves original order within the same tier (stable sort)', () => {
    const items = makeItems(['incompatible', 'compatible', 'incompatible', 'compatible'])
    const sorted = sortByCompatibility(items)
    // Both compatibles come first in their original order (id 1, then 3)
    expect(sorted[0].id).toBe(1)
    expect(sorted[1].id).toBe(3)
    // Both incompatibles follow in original order (id 0, then 2)
    expect(sorted[2].id).toBe(0)
    expect(sorted[3].id).toBe(2)
  })

  it('returns empty array unchanged', () => {
    expect(sortByCompatibility([])).toEqual([])
  })

  it('returns single-item array unchanged', () => {
    const items = [{ compatibilityStatus: 'chain' as CompatibilityStatus }]
    expect(sortByCompatibility(items)).toEqual(items)
  })

  it('does not mutate the original array', () => {
    const items = makeItems(['unknown', 'compatible'])
    const sorted = sortByCompatibility(items)
    expect(items[0].compatibilityStatus).toBe('unknown')  // original unchanged
    expect(sorted[0].compatibilityStatus).toBe('compatible')
  })
})

// ── annotateCompatibility ─────────────────────────────────────────────────────

describe('annotateCompatibility', () => {
  interface Item { name: string; type?: TypeExpr }

  const items: Item[] = [
    { name: 'a', type: stringType },
    { name: 'b', type: recordA },
    { name: 'c', type: undefined },
  ]

  it('annotates items with correct statuses against a target', () => {
    const annotated = annotateCompatibility(items, stringType, (i) => i.type)
    expect(annotated[0].compatibilityStatus).toBe('compatible')  // string → string
    expect(annotated[1].compatibilityStatus).toBe('incompatible') // record → scalar
    expect(annotated[2].compatibilityStatus).toBe('unknown')     // undefined type
  })

  it('marks all items unknown when targetType is undefined', () => {
    const annotated = annotateCompatibility(items, undefined, (i) => i.type)
    for (const item of annotated) {
      expect(item.compatibilityStatus).toBe('unknown')
    }
  })

  it('preserves original item properties', () => {
    const annotated = annotateCompatibility(items, stringType, (i) => i.type)
    expect(annotated[0].name).toBe('a')
    expect(annotated[1].name).toBe('b')
    expect(annotated[2].name).toBe('c')
  })
})

// ── Integration: annotate + sort ──────────────────────────────────────────────

describe('annotateCompatibility + sortByCompatibility (integration)', () => {
  interface CatalogItem { name: string; outputType?: TypeExpr }

  const entities: CatalogItem[] = [
    { name: 'e-incompatible', outputType: stringType },       // scalar, target is record
    { name: 'e-chain', outputType: recordB },                 // record, different fields
    { name: 'e-compatible', outputType: recordA },            // record, superset of target
    { name: 'e-unknown' },                                    // no type
  ]

  const targetType: TypeExpr = recordSubset // needs {name: string}

  it('produces expected order after annotate + sort', () => {
    const annotated = annotateCompatibility(entities, targetType, (e) => e.outputType)
    const sorted = sortByCompatibility(annotated)
    expect(sorted.map((x) => x.name)).toEqual([
      'e-compatible',
      'e-chain',
      'e-incompatible',
      'e-unknown',
    ])
  })
})
