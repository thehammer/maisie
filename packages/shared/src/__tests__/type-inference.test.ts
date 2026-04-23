import { describe, it, expect } from 'bun:test'
import { inferType } from '../type-inference'
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
