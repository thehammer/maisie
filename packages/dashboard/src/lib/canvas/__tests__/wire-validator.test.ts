import { describe, it, expect } from 'bun:test'
import { validateWire } from '../wire-validator'
import type { TypeExpr } from '@maisie/shared'

// ── Helpers ────────────────────────────────────────────────────────────────────

const stringType: TypeExpr = { kind: 'scalar', type: 'string' }
const numberType: TypeExpr = { kind: 'scalar', type: 'number' }
const urlType: TypeExpr = { kind: 'scalar', type: 'url' }
const collectionAny: TypeExpr = { kind: 'collection', element: { kind: 'any' } }
const collectionString: TypeExpr = { kind: 'collection', element: stringType }

const recordWithName: TypeExpr = {
  kind: 'record',
  fields: { name: stringType },
}
const recordWithNameAndAge: TypeExpr = {
  kind: 'record',
  fields: { name: stringType, age: numberType },
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('validateWire', () => {
  it('returns unknown when source type is undefined', () => {
    const result = validateWire(undefined, stringType)
    expect(result.status).toBe('unknown')
    expect(result.message).toBeTruthy()
  })

  it('returns unknown when target type is undefined', () => {
    const result = validateWire(stringType, undefined)
    expect(result.status).toBe('unknown')
  })

  it('returns unknown when both types are undefined', () => {
    const result = validateWire(undefined, undefined)
    expect(result.status).toBe('unknown')
  })

  it('returns compatible for identical scalar types', () => {
    const result = validateWire(stringType, stringType)
    expect(result.status).toBe('compatible')
    expect(result.result?.ok).toBe(true)
  })

  it('returns compatible for url -> string (semantic subtype)', () => {
    const result = validateWire(urlType, stringType)
    expect(result.status).toBe('compatible')
  })

  it('returns incompatible for string -> number (type mismatch)', () => {
    const result = validateWire(stringType, numberType)
    expect(result.status).toBe('incompatible')
    expect(result.result?.ok).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('returns incompatible for number -> string', () => {
    const result = validateWire(numberType, stringType)
    expect(result.status).toBe('incompatible')
  })

  it('returns compatible for collection<any> -> collection<string>', () => {
    // collection<any> on actual satisfies any collection contract
    const result = validateWire(collectionAny, collectionString)
    expect(result.status).toBe('compatible')
  })

  it('returns compatible for superset record -> subset record (structural subtyping)', () => {
    // Source has name + age; target requires only name — compatible
    const result = validateWire(recordWithNameAndAge, recordWithName)
    expect(result.status).toBe('compatible')
  })

  it('returns incompatible for subset record -> superset record (missing required field)', () => {
    // Source has only name; target requires name + age — incompatible
    const result = validateWire(recordWithName, recordWithNameAndAge)
    expect(result.status).toBe('incompatible')
    expect(result.message).toContain('age')
  })

  it('returns compatible for any -> anything', () => {
    const result = validateWire({ kind: 'any' }, numberType)
    expect(result.status).toBe('compatible')
  })

  it('caps error message at 3 errors', () => {
    const strictTarget: TypeExpr = {
      kind: 'record',
      fields: {
        a: numberType,
        b: numberType,
        c: numberType,
        d: numberType,
      },
    }
    // Empty record satisfies nothing with required fields missing
    const result = validateWire({ kind: 'record', fields: {} }, strictTarget)
    expect(result.status).toBe('incompatible')
    // Message should contain at most 3 semicolon-joined errors
    const parts = result.message?.split('; ') ?? []
    expect(parts.length).toBeLessThanOrEqual(3)
  })
})
