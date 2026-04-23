import { describe, it, expect } from 'bun:test'
import { satisfies, scalarSatisfies, formatType, formatErrors, type MatchError } from '../contract'
import type { TypeExpr } from '../component'

// ── Helpers ───────────────────────────────────────────────────────────────────

function scalar(type: string): TypeExpr {
  return { kind: 'scalar', type: type as never }
}

function record(fields: Record<string, TypeExpr>, optional?: string[]): TypeExpr {
  return { kind: 'record', fields, ...(optional ? { optional } : {}) }
}

function collection(element: TypeExpr): TypeExpr {
  return { kind: 'collection', element }
}

function func(params: Array<{ name: string; type: TypeExpr }>, returns: TypeExpr): TypeExpr {
  return { kind: 'function', params, returns }
}

function component(input?: TypeExpr): TypeExpr {
  return { kind: 'component', ...(input ? { input } : {}) }
}

const ANY: TypeExpr = { kind: 'any' }

function ok(actual: TypeExpr, contract: TypeExpr) {
  const result = satisfies(actual, contract)
  if (!result.ok) {
    throw new Error(`Expected ok but got errors:\n${formatErrors(result.errors)}`)
  }
  expect(result.ok).toBe(true)
}

function fail(actual: TypeExpr, contract: TypeExpr, expectedPath?: (string | number)[]): MatchError[] {
  const result = satisfies(actual, contract)
  if (result.ok) throw new Error('Expected failure but got ok')
  if (expectedPath !== undefined) {
    const errorPaths = result.errors.map(e => JSON.stringify(e.path))
    const wantPath = JSON.stringify(expectedPath)
    expect(errorPaths).toContain(wantPath)
  }
  return result.errors
}

// ── scalarSatisfies ───────────────────────────────────────────────────────────

describe('contract — scalarSatisfies', () => {
  it('exact match', () => {
    expect(scalarSatisfies('string', 'string')).toBe(true)
    expect(scalarSatisfies('number', 'number')).toBe(true)
    expect(scalarSatisfies('boolean', 'boolean')).toBe(true)
  })

  it('url satisfies string', () => {
    expect(scalarSatisfies('url', 'string')).toBe(true)
  })

  it('image satisfies string', () => {
    expect(scalarSatisfies('image', 'string')).toBe(true)
  })

  it('timestamp satisfies string', () => {
    expect(scalarSatisfies('timestamp', 'string')).toBe(true)
  })

  it('status satisfies string', () => {
    expect(scalarSatisfies('status', 'string')).toBe(true)
  })

  it('bytes satisfies number', () => {
    expect(scalarSatisfies('bytes', 'number')).toBe(true)
  })

  it('percentage satisfies number', () => {
    expect(scalarSatisfies('percentage', 'number')).toBe(true)
  })

  it('epoch_ms satisfies number', () => {
    expect(scalarSatisfies('epoch_ms', 'number')).toBe(true)
  })

  it('duration satisfies number', () => {
    expect(scalarSatisfies('duration', 'number')).toBe(true)
  })

  it('temperature satisfies number', () => {
    expect(scalarSatisfies('temperature', 'number')).toBe(true)
  })

  it('signal satisfies number', () => {
    expect(scalarSatisfies('signal', 'number')).toBe(true)
  })

  it('number does not satisfy string', () => {
    expect(scalarSatisfies('number', 'string')).toBe(false)
  })

  it('string does not satisfy number', () => {
    expect(scalarSatisfies('string', 'number')).toBe(false)
  })

  it('url does not satisfy boolean', () => {
    expect(scalarSatisfies('url', 'boolean')).toBe(false)
  })

  it('url does not satisfy number', () => {
    expect(scalarSatisfies('url', 'number')).toBe(false)
  })
})

// ── Scalar matching ───────────────────────────────────────────────────────────

describe('contract — scalar satisfies', () => {
  it('number satisfies number', () => {
    ok(scalar('number'), scalar('number'))
  })

  it('string satisfies string', () => {
    ok(scalar('string'), scalar('string'))
  })

  it('url satisfies string (semantic subtype)', () => {
    ok(scalar('url'), scalar('string'))
  })

  it('percentage satisfies number (semantic subtype)', () => {
    ok(scalar('percentage'), scalar('number'))
  })

  it('number does not satisfy string', () => {
    const errors = fail(scalar('number'), scalar('string'))
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].message).toContain('number')
    expect(errors[0].message).toContain('string')
  })

  it('string does not satisfy number', () => {
    fail(scalar('string'), scalar('number'))
  })
})

// ── AnyType ───────────────────────────────────────────────────────────────────

describe('contract — AnyType', () => {
  it('any satisfies any', () => {
    ok(ANY, ANY)
  })

  it('any satisfies record', () => {
    ok(ANY, record({ name: scalar('string') }))
  })

  it('record satisfies any', () => {
    ok(record({ name: scalar('string') }), ANY)
  })

  it('any satisfies collection', () => {
    ok(ANY, collection(scalar('string')))
  })

  it('any satisfies component', () => {
    ok(ANY, component())
  })
})

// ── Record matching ───────────────────────────────────────────────────────────

describe('contract — record satisfies', () => {
  it('exact record match', () => {
    ok(
      record({ name: scalar('string'), age: scalar('number') }),
      record({ name: scalar('string'), age: scalar('number') })
    )
  })

  it('structural subtyping — extra fields allowed', () => {
    ok(
      record({ name: scalar('string'), age: scalar('number'), extra: scalar('boolean') }),
      record({ name: scalar('string'), age: scalar('number') })
    )
  })

  it('missing required field', () => {
    const errors = fail(
      record({ name: scalar('string') }),
      record({ name: scalar('string'), age: scalar('number') }),
      ['age']
    )
    expect(errors.some(e => e.message.includes('age'))).toBe(true)
  })

  it('field type mismatch', () => {
    const errors = fail(
      record({ name: scalar('number') }),
      record({ name: scalar('string') }),
      ['name']
    )
    expect(errors.length).toBeGreaterThan(0)
  })

  it('semantic subtype in record field (url satisfies string)', () => {
    ok(
      record({ link: scalar('url') }),
      record({ link: scalar('string') })
    )
  })

  it('empty contract record (no required fields) accepts any record', () => {
    ok(
      record({ name: scalar('string'), value: scalar('number') }),
      record({})
    )
  })

  it('reports path for nested missing field', () => {
    const errors = fail(
      record({ meta: record({ title: scalar('string') }) }),
      record({ meta: record({ title: scalar('string'), author: scalar('string') }) }),
    )
    expect(errors.some(e => e.path.includes('meta') && e.path.includes('author'))).toBe(true)
  })
})

// ── Collection matching ───────────────────────────────────────────────────────

describe('contract — collection satisfies', () => {
  it('collection<string> satisfies collection<string>', () => {
    ok(collection(scalar('string')), collection(scalar('string')))
  })

  it('collection<url> satisfies collection<string>', () => {
    ok(collection(scalar('url')), collection(scalar('string')))
  })

  it('collection<number> does not satisfy collection<string>', () => {
    fail(collection(scalar('number')), collection(scalar('string')))
  })

  it('collection<any> satisfies any collection', () => {
    ok(collection(ANY), collection(scalar('string')))
  })

  it('collection with record element contract', () => {
    ok(
      collection(record({ title: scalar('string'), coverUrl: scalar('url') })),
      collection(record({ title: scalar('string') }))
    )
  })

  it('collection element mismatch propagates path', () => {
    const errors = fail(
      collection(record({ title: scalar('number') })),
      collection(record({ title: scalar('string') }))
    )
    expect(errors.some(e => e.path.some(p => p === '[*]'))).toBe(true)
  })
})

// ── Function matching ─────────────────────────────────────────────────────────

describe('contract — function satisfies', () => {
  it('compatible functions match', () => {
    ok(
      func([{ name: 'n', type: scalar('number') }], scalar('string')),
      func([{ name: 'n', type: scalar('number') }], scalar('string'))
    )
  })

  it('actual with more params satisfies contract', () => {
    ok(
      func([{ name: 'a', type: scalar('string') }, { name: 'b', type: scalar('number') }], ANY),
      func([{ name: 'a', type: scalar('string') }], ANY)
    )
  })

  it('actual with fewer params than contract fails', () => {
    fail(
      func([{ name: 'a', type: scalar('string') }], ANY),
      func([{ name: 'a', type: scalar('string') }, { name: 'b', type: scalar('number') }], ANY)
    )
  })

  it('return type must satisfy contract return', () => {
    fail(
      func([], scalar('number')),
      func([], scalar('string'))
    )
  })

  it('function does not satisfy non-function contract', () => {
    fail(
      func([], ANY),
      scalar('string')
    )
  })
})

// ── Component matching ────────────────────────────────────────────────────────

describe('contract — component satisfies', () => {
  it('bare component satisfies bare component', () => {
    ok(component(), component())
  })

  it('component with input satisfies bare component contract', () => {
    ok(
      component(record({ title: scalar('string') })),
      component()
    )
  })

  it('component without input fails when contract requires input', () => {
    fail(
      component(),
      component(record({ title: scalar('string') }))
    )
  })

  it('component with matching input satisfies component contract', () => {
    ok(
      component(record({ title: scalar('string'), coverUrl: scalar('url'), rating: scalar('status') })),
      component(record({ title: scalar('string') }))
    )
  })

  it('component with mismatched input fails', () => {
    fail(
      component(record({ title: scalar('number') })),
      component(record({ title: scalar('string') }))
    )
  })
})

// ── Deep nesting ──────────────────────────────────────────────────────────────

describe('contract — deep nesting', () => {
  it('record in collection in record', () => {
    const actual: TypeExpr = record({
      items: collection(record({ title: scalar('string'), coverUrl: scalar('url') })),
      count: scalar('number'),
    })
    const contract: TypeExpr = record({
      items: collection(record({ title: scalar('string') })),
    })
    ok(actual, contract)
  })

  it('deep missing field reports full path', () => {
    const actual: TypeExpr = record({
      items: collection(record({ title: scalar('string') })),
    })
    const contract: TypeExpr = record({
      items: collection(record({ title: scalar('string'), rating: scalar('status') })),
    })
    const errors = fail(actual, contract)
    // Should have a path pointing into items -> [*] -> rating
    expect(errors.some(e =>
      e.path.includes('items') && e.path.some(p => p === '[*]') && e.path.includes('rating')
    )).toBe(true)
  })
})

// ── Integration: Plex → MovieTile ─────────────────────────────────────────────

describe('contract — integration: binding validation', () => {
  it('plex.list_recently_added does not satisfy MovieTile.input (missing coverUrl and rating)', () => {
    // plex.list_recently_added returns records with title, year, addedAt, summary but no coverUrl/rating
    const plexType: TypeExpr = collection(record({
      title: scalar('string'),
      year: scalar('number'),
      addedAt: scalar('timestamp'),
      summary: scalar('string'),
    }))

    // MovieTile.input
    const movieTileInput: TypeExpr = record({
      title: scalar('string'),
      coverUrl: scalar('url'),
      rating: scalar('status'),
    })

    // The collection element must satisfy movieTileInput
    const result = satisfies(
      (plexType as { kind: 'collection'; element: TypeExpr }).element,
      movieTileInput
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const paths = result.errors.map(e => e.path)
      const missingFields = paths.map(p => p[p.length - 1])
      expect(missingFields).toContain('coverUrl')
      expect(missingFields).toContain('rating')
    }
  })

  it('enriched plex type satisfies MovieTile.input', () => {
    const enrichedType: TypeExpr = record({
      title: scalar('string'),
      coverUrl: scalar('url'),
      rating: scalar('status'),
      year: scalar('number'),
    })
    const movieTileInput: TypeExpr = record({
      title: scalar('string'),
      coverUrl: scalar('url'),
      rating: scalar('status'),
    })
    ok(enrichedType, movieTileInput)
  })
})

// ── formatType / formatErrors ─────────────────────────────────────────────────

describe('contract — formatType', () => {
  it('formats any', () => {
    expect(formatType(ANY)).toBe('any')
  })

  it('formats scalar', () => {
    expect(formatType(scalar('string'))).toBe('string')
    expect(formatType(scalar('url'))).toBe('url')
  })

  it('formats collection', () => {
    expect(formatType(collection(scalar('number')))).toBe('collection<number>')
  })

  it('formats record with fields', () => {
    const t = record({ name: scalar('string'), age: scalar('number') })
    const s = formatType(t)
    expect(s).toContain('name: string')
    expect(s).toContain('age: number')
  })

  it('formats function', () => {
    const t = func([{ name: 'x', type: scalar('string') }], scalar('boolean'))
    expect(formatType(t)).toContain('function(')
    expect(formatType(t)).toContain('x: string')
  })

  it('formats component', () => {
    expect(formatType(component())).toBe('component')
    expect(formatType(component(record({ id: scalar('number') })))).toContain('component<')
  })
})

describe('contract — formatErrors', () => {
  it('produces human-readable error summary', () => {
    const result = satisfies(
      record({ name: scalar('string') }),
      record({ name: scalar('string'), age: scalar('number') })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const summary = formatErrors(result.errors)
      expect(summary).toContain('age')
    }
  })
})
