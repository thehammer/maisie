import { describe, it, expect } from 'bun:test'
import { inferType, inferFunctionOutput } from '../type-inference'
import { getFunctionDescriptor } from '../function-registry-data'
import type { TypeExpr } from '../component'

// ── Scalars ───────────────────────────────────────────────────────────────────

describe('type-inference — scalars', () => {
  it('infers null as any', () => {
    expect(inferType(null)).toEqual({ kind: 'any' })
  })

  it('infers boolean', () => {
    expect(inferType(true)).toEqual({ kind: 'scalar', type: 'boolean' })
    expect(inferType(false)).toEqual({ kind: 'scalar', type: 'boolean' })
  })

  it('infers number', () => {
    expect(inferType(42)).toEqual({ kind: 'scalar', type: 'number' })
    expect(inferType(3.14)).toEqual({ kind: 'scalar', type: 'number' })
    expect(inferType(0)).toEqual({ kind: 'scalar', type: 'number' })
  })

  it('infers plain string', () => {
    expect(inferType('hello')).toEqual({ kind: 'scalar', type: 'string' })
    expect(inferType('')).toEqual({ kind: 'scalar', type: 'string' })
    expect(inferType('something without url prefix')).toEqual({ kind: 'scalar', type: 'string' })
  })

  it('infers url from http:// prefix', () => {
    expect(inferType('http://example.com/image.jpg')).toEqual({ kind: 'scalar', type: 'url' })
  })

  it('infers url from https:// prefix', () => {
    expect(inferType('https://plex.tv/covers/123.jpg')).toEqual({ kind: 'scalar', type: 'url' })
  })

  it('infers timestamp from ISO-8601 date', () => {
    expect(inferType('2024-01-15')).toEqual({ kind: 'scalar', type: 'timestamp' })
  })

  it('infers timestamp from ISO-8601 datetime', () => {
    expect(inferType('2024-01-15T12:30:00Z')).toEqual({ kind: 'scalar', type: 'timestamp' })
  })

  it('does not infer timestamp from arbitrary strings', () => {
    const t = inferType('not-a-date')
    expect(t.kind).toBe('scalar')
    if (t.kind === 'scalar') {
      expect(t.type).toBe('string')
    }
  })
})

// ── Collections ───────────────────────────────────────────────────────────────

describe('type-inference — collections', () => {
  it('infers empty array as collection<any>', () => {
    expect(inferType([])).toEqual({ kind: 'collection', element: { kind: 'any' } })
  })

  it('infers array of strings as collection<string>', () => {
    const t = inferType(['hello', 'world'])
    expect(t.kind).toBe('collection')
    if (t.kind === 'collection') {
      expect(t.element).toEqual({ kind: 'scalar', type: 'string' })
    }
  })

  it('infers array of numbers as collection<number>', () => {
    const t = inferType([1, 2, 3])
    expect(t.kind).toBe('collection')
    if (t.kind === 'collection') {
      expect(t.element).toEqual({ kind: 'scalar', type: 'number' })
    }
  })

  it('infers element type from first element only', () => {
    // Mixed array — first element determines type
    const t = inferType([1, 'two', true])
    expect(t.kind).toBe('collection')
    if (t.kind === 'collection') {
      expect(t.element).toEqual({ kind: 'scalar', type: 'number' })
    }
  })

  it('infers collection of records', () => {
    const t = inferType([{ title: 'Inception', year: 2010 }])
    expect(t.kind).toBe('collection')
    if (t.kind === 'collection') {
      expect(t.element.kind).toBe('record')
    }
  })
})

// ── Records ───────────────────────────────────────────────────────────────────

describe('type-inference — records', () => {
  it('infers empty object as empty record', () => {
    const t = inferType({})
    expect(t.kind).toBe('record')
    if (t.kind === 'record') {
      expect(Object.keys(t.fields)).toHaveLength(0)
    }
  })

  it('infers record with typed fields', () => {
    const t = inferType({ title: 'hello', year: 2024, active: true })
    expect(t.kind).toBe('record')
    if (t.kind === 'record') {
      expect(t.fields.title).toEqual({ kind: 'scalar', type: 'string' })
      expect(t.fields.year).toEqual({ kind: 'scalar', type: 'number' })
      expect(t.fields.active).toEqual({ kind: 'scalar', type: 'boolean' })
    }
  })

  it('infers URL-typed field in record', () => {
    const t = inferType({ coverUrl: 'https://example.com/cover.jpg', title: 'Movie' })
    expect(t.kind).toBe('record')
    if (t.kind === 'record') {
      expect(t.fields.coverUrl).toEqual({ kind: 'scalar', type: 'url' })
    }
  })

  it('infers nested record', () => {
    const t = inferType({ meta: { author: 'John', year: 2020 }, title: 'Book' })
    expect(t.kind).toBe('record')
    if (t.kind === 'record') {
      expect(t.fields.meta.kind).toBe('record')
      expect(t.fields.title).toEqual({ kind: 'scalar', type: 'string' })
    }
  })

  it('infers null field as any', () => {
    const t = inferType({ name: 'Alice', optional: null })
    expect(t.kind).toBe('record')
    if (t.kind === 'record') {
      expect(t.fields.optional).toEqual({ kind: 'any' })
    }
  })
})

// ── Functions ─────────────────────────────────────────────────────────────────

describe('type-inference — functions', () => {
  it('infers function type', () => {
    const fn = () => 'result'
    const t = inferType(fn as never)
    expect(t.kind).toBe('function')
    if (t.kind === 'function') {
      expect(t.params).toHaveLength(0)
      expect(t.returns).toEqual({ kind: 'any' })
    }
  })
})

// ── inferFunctionOutput ────────────────────────────────────────────────────────

const ANY: TypeExpr = { kind: 'any' }
const STRING: TypeExpr = { kind: 'scalar', type: 'string' }
const NUMBER: TypeExpr = { kind: 'scalar', type: 'number' }
const BOOLEAN: TypeExpr = { kind: 'scalar', type: 'boolean' }

const recordPerson: TypeExpr = {
  kind: 'record',
  fields: { name: STRING, age: NUMBER },
}
const collectionPerson: TypeExpr = { kind: 'collection', element: recordPerson }
const collectionString: TypeExpr = { kind: 'collection', element: STRING }
const collectionAny: TypeExpr = { kind: 'collection', element: ANY }

describe('inferFunctionOutput — element_of (first, last)', () => {
  it('first on collection<record> returns the record type', () => {
    const desc = getFunctionDescriptor('std.first')!
    const out = inferFunctionOutput(desc, collectionPerson, {})
    expect(out).toEqual(recordPerson)
  })

  it('first on collection<string> returns string', () => {
    const desc = getFunctionDescriptor('std.first')!
    const out = inferFunctionOutput(desc, collectionString, {})
    expect(out).toEqual(STRING)
  })

  it('last mirrors first behavior', () => {
    const desc = getFunctionDescriptor('std.last')!
    const out = inferFunctionOutput(desc, collectionPerson, {})
    expect(out).toEqual(recordPerson)
  })

  it('returns any when upstream is not a collection', () => {
    const desc = getFunctionDescriptor('std.first')!
    expect(inferFunctionOutput(desc, STRING, {})).toEqual(ANY)
    expect(inferFunctionOutput(desc, recordPerson, {})).toEqual(ANY)
  })

  it('returns any when upstream is undefined', () => {
    const desc = getFunctionDescriptor('std.first')!
    expect(inferFunctionOutput(desc, undefined, {})).toEqual(ANY)
  })
})

describe('inferFunctionOutput — field_of (std.get)', () => {
  it('returns field type when upstream is a record and field exists', () => {
    const desc = getFunctionDescriptor('std.get')!
    const out = inferFunctionOutput(desc, recordPerson, { field: 'name' })
    expect(out).toEqual(STRING)
  })

  it('returns different field type for different field param', () => {
    const desc = getFunctionDescriptor('std.get')!
    const out = inferFunctionOutput(desc, recordPerson, { field: 'age' })
    expect(out).toEqual(NUMBER)
  })

  it('returns any when field does not exist in record', () => {
    const desc = getFunctionDescriptor('std.get')!
    const out = inferFunctionOutput(desc, recordPerson, { field: 'email' })
    expect(out).toEqual(ANY)
  })

  it('returns any when field param is not a string', () => {
    const desc = getFunctionDescriptor('std.get')!
    expect(inferFunctionOutput(desc, recordPerson, { field: 42 })).toEqual(ANY)
    expect(inferFunctionOutput(desc, recordPerson, {})).toEqual(ANY)
  })

  it('returns any when upstream is not a record', () => {
    const desc = getFunctionDescriptor('std.get')!
    expect(inferFunctionOutput(desc, collectionPerson, { field: 'name' })).toEqual(ANY)
    expect(inferFunctionOutput(desc, STRING, { field: 'name' })).toEqual(ANY)
  })

  it('returns any when upstream is undefined', () => {
    const desc = getFunctionDescriptor('std.get')!
    expect(inferFunctionOutput(desc, undefined, { field: 'name' })).toEqual(ANY)
  })
})

describe('inferFunctionOutput — collection_of_field_of (std.pluck)', () => {
  it('returns collection<string> when plucking a string field', () => {
    const desc = getFunctionDescriptor('std.pluck')!
    const out = inferFunctionOutput(desc, collectionPerson, { field: 'name' })
    expect(out).toEqual(collectionString)
  })

  it('returns collection<number> when plucking a number field', () => {
    const desc = getFunctionDescriptor('std.pluck')!
    const out = inferFunctionOutput(desc, collectionPerson, { field: 'age' })
    expect(out).toEqual({ kind: 'collection', element: NUMBER })
  })

  it('returns collection<any> when field not in element record', () => {
    const desc = getFunctionDescriptor('std.pluck')!
    const out = inferFunctionOutput(desc, collectionPerson, { field: 'missing' })
    expect(out).toEqual(collectionAny)
  })

  it('returns collection<any> when field param is not a string', () => {
    const desc = getFunctionDescriptor('std.pluck')!
    const out = inferFunctionOutput(desc, collectionPerson, {})
    expect(out).toEqual(collectionAny)
  })

  it('returns collection<any> when upstream element is not a record', () => {
    const desc = getFunctionDescriptor('std.pluck')!
    const out = inferFunctionOutput(desc, collectionString, { field: 'name' })
    expect(out).toEqual(collectionAny)
  })

  it('returns collection<any> when upstream is not a collection', () => {
    const desc = getFunctionDescriptor('std.pluck')!
    const out = inferFunctionOutput(desc, recordPerson, { field: 'name' })
    expect(out).toEqual(collectionAny)
  })
})

describe('inferFunctionOutput — passthrough (filter, sort, limit, unique)', () => {
  it('filter preserves element type', () => {
    const desc = getFunctionDescriptor('std.filter')!
    const out = inferFunctionOutput(desc, collectionPerson, {})
    expect(out).toEqual(collectionPerson)
  })

  it('sort preserves element type', () => {
    const desc = getFunctionDescriptor('std.sort')!
    const out = inferFunctionOutput(desc, collectionString, {})
    expect(out).toEqual(collectionString)
  })

  it('limit preserves element type', () => {
    const desc = getFunctionDescriptor('std.limit')!
    const out = inferFunctionOutput(desc, collectionPerson, {})
    expect(out).toEqual(collectionPerson)
  })

  it('unique preserves element type', () => {
    const desc = getFunctionDescriptor('std.unique')!
    const out = inferFunctionOutput(desc, collectionString, {})
    expect(out).toEqual(collectionString)
  })

  it('filter with undefined upstream falls back to declared collection<any>', () => {
    const desc = getFunctionDescriptor('std.filter')!
    const out = inferFunctionOutput(desc, undefined, {})
    expect(out).toEqual(collectionAny)
  })
})

describe('inferFunctionOutput — static scalar outputs (count, sum, any, all)', () => {
  it('count returns number regardless of upstream', () => {
    const desc = getFunctionDescriptor('std.count')!
    expect(inferFunctionOutput(desc, collectionPerson, {})).toEqual(NUMBER)
    expect(inferFunctionOutput(desc, undefined, {})).toEqual(NUMBER)
  })

  it('sum returns number', () => {
    const desc = getFunctionDescriptor('std.sum')!
    expect(inferFunctionOutput(desc, collectionPerson, {})).toEqual(NUMBER)
  })

  it('any returns boolean', () => {
    const desc = getFunctionDescriptor('std.any')!
    expect(inferFunctionOutput(desc, collectionPerson, {})).toEqual(BOOLEAN)
  })

  it('all returns boolean', () => {
    const desc = getFunctionDescriptor('std.all')!
    expect(inferFunctionOutput(desc, collectionPerson, {})).toEqual(BOOLEAN)
  })
})

describe('inferFunctionOutput — group_of (std.group)', () => {
  it('group falls back to collection<any> for phase 3n', () => {
    const desc = getFunctionDescriptor('std.group')!
    const out = inferFunctionOutput(desc, collectionPerson, { field: 'name' })
    expect(out).toEqual(collectionAny)
  })

  it('group falls back to collection<any> even without upstream', () => {
    const desc = getFunctionDescriptor('std.group')!
    const out = inferFunctionOutput(desc, undefined, {})
    expect(out).toEqual(collectionAny)
  })
})

describe('inferFunctionOutput — map', () => {
  it('map stays at collection<any> since lambda body inspection is out of scope', () => {
    const desc = getFunctionDescriptor('std.map')!
    const out = inferFunctionOutput(desc, collectionPerson, {})
    expect(out).toEqual(collectionAny)
  })
})
