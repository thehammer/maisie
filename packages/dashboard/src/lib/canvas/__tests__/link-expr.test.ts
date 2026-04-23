import { describe, it, expect } from 'bun:test'
import { compileLinkExpr, type LinkExpr } from '../link-expr'
import { evalExpr, PRIMITIVES } from '@maisie/shared'
import type { MaisieRecord, MaisieValue, ExprNode, MaisieFunction } from '@maisie/shared'

/**
 * Evaluate a compiled link lambda against a sample record.
 * The lambda uses evalExpr with the given env.
 */
function applyLambda(expr: ExprNode, input: MaisieRecord): MaisieValue {
  // The compiled expr is a lambda; evalExpr produces a MaisieFunction.
  const fn = evalExpr(expr, {}, {}) as MaisieFunction
  return fn(input)
}

const sampleRow: MaisieRecord = {
  title: 'The Matrix',
  thumbUrl: 'https://example.com/img.jpg',
  rating: 8.7,
  active: true,
}

describe('compileLinkExpr — identity', () => {
  it('produces a lambda ExprNode', () => {
    const expr = compileLinkExpr({ kind: 'identity' })
    expect(expr.kind).toBe('lambda')
  })

  it('returns the input unchanged', () => {
    const expr = compileLinkExpr({ kind: 'identity' })
    const result = applyLambda(expr, sampleRow)
    expect(result).toEqual(sampleRow)
  })
})

describe('compileLinkExpr — pick', () => {
  it('produces a lambda ExprNode', () => {
    const expr = compileLinkExpr({ kind: 'pick', fields: ['title'] })
    expect(expr.kind).toBe('lambda')
  })

  it('returns only the named fields', () => {
    const expr = compileLinkExpr({ kind: 'pick', fields: ['title', 'rating'] })
    const result = applyLambda(expr, sampleRow) as MaisieRecord
    expect(result).toEqual({ title: 'The Matrix', rating: 8.7 })
  })

  it('drops fields not in the pick list', () => {
    const expr = compileLinkExpr({ kind: 'pick', fields: ['title'] })
    const result = applyLambda(expr, sampleRow) as MaisieRecord
    expect(Object.keys(result)).toEqual(['title'])
  })

  it('uses null for missing fields', () => {
    const expr = compileLinkExpr({ kind: 'pick', fields: ['title', 'missing'] })
    const result = applyLambda(expr, sampleRow) as MaisieRecord
    expect(result.missing).toBeNull()
  })

  it('empty field list produces empty record', () => {
    const expr = compileLinkExpr({ kind: 'pick', fields: [] })
    const result = applyLambda(expr, sampleRow)
    expect(result).toEqual({})
  })
})

describe('compileLinkExpr — rename', () => {
  it('produces a lambda ExprNode', () => {
    const expr = compileLinkExpr({ kind: 'rename', mappings: [{ from: 'thumbUrl', to: 'coverUrl' }] })
    expect(expr.kind).toBe('lambda')
  })

  it('renames the specified fields and drops the rest by default', () => {
    const expr = compileLinkExpr({
      kind: 'rename',
      mappings: [{ from: 'thumbUrl', to: 'coverUrl' }],
      keepRest: false,
    })
    const result = applyLambda(expr, sampleRow) as MaisieRecord
    expect(result.coverUrl).toBe('https://example.com/img.jpg')
    expect(result.thumbUrl).toBeUndefined()
    expect(result.title).toBeUndefined()
  })

  it('keeps unmentioned fields when keepRest is true', () => {
    const expr = compileLinkExpr({
      kind: 'rename',
      mappings: [{ from: 'thumbUrl', to: 'coverUrl' }],
      keepRest: true,
    })
    const result = applyLambda(expr, sampleRow) as MaisieRecord
    expect(result.coverUrl).toBe('https://example.com/img.jpg')
    expect(result.title).toBe('The Matrix')
    expect(result.rating).toBe(8.7)
  })

  it('can rename multiple fields', () => {
    const expr = compileLinkExpr({
      kind: 'rename',
      mappings: [
        { from: 'thumbUrl', to: 'coverUrl' },
        { from: 'title', to: 'name' },
      ],
      keepRest: false,
    })
    const result = applyLambda(expr, sampleRow) as MaisieRecord
    expect(result.coverUrl).toBe('https://example.com/img.jpg')
    expect(result.name).toBe('The Matrix')
  })
})

describe('compileLinkExpr — compute', () => {
  it('produces a lambda ExprNode', () => {
    const expr = compileLinkExpr({ kind: 'compute', assignments: [{ name: 'status', value: 'ok' }] })
    expect(expr.kind).toBe('lambda')
  })

  it('adds a string literal field', () => {
    const expr = compileLinkExpr({
      kind: 'compute',
      assignments: [{ name: 'status', value: 'ok' }],
    })
    const result = applyLambda(expr, sampleRow) as MaisieRecord
    expect(result.status).toBe('ok')
  })

  it('adds a number literal field', () => {
    const expr = compileLinkExpr({
      kind: 'compute',
      assignments: [{ name: 'score', value: 42 }],
    })
    const result = applyLambda(expr, sampleRow) as MaisieRecord
    expect(result.score).toBe(42)
  })

  it('adds a boolean literal field', () => {
    const expr = compileLinkExpr({
      kind: 'compute',
      assignments: [{ name: 'visible', value: true }],
    })
    const result = applyLambda(expr, sampleRow) as MaisieRecord
    expect(result.visible).toBe(true)
  })

  it('adds a null literal field', () => {
    const expr = compileLinkExpr({
      kind: 'compute',
      assignments: [{ name: 'extra', value: null }],
    })
    const result = applyLambda(expr, sampleRow) as MaisieRecord
    expect(result.extra).toBeNull()
  })

  it('keeps existing fields by default (keepRest: true)', () => {
    const expr = compileLinkExpr({
      kind: 'compute',
      assignments: [{ name: 'status', value: 'ok' }],
    })
    const result = applyLambda(expr, sampleRow) as MaisieRecord
    expect(result.title).toBe('The Matrix')
    expect(result.status).toBe('ok')
  })

  it('drops existing fields when keepRest is false', () => {
    const expr = compileLinkExpr({
      kind: 'compute',
      assignments: [{ name: 'status', value: 'ok' }],
      keepRest: false,
    })
    const result = applyLambda(expr, sampleRow) as MaisieRecord
    expect(result.title).toBeUndefined()
    expect(result.status).toBe('ok')
  })

  it('can override an existing field', () => {
    const expr = compileLinkExpr({
      kind: 'compute',
      assignments: [{ name: 'rating', value: 10 }],
    })
    const result = applyLambda(expr, sampleRow) as MaisieRecord
    expect(result.rating).toBe(10)
  })
})

describe('compileLinkExpr — chain', () => {
  it('produces a lambda ExprNode', () => {
    const expr = compileLinkExpr({ kind: 'chain', links: [] })
    expect(expr.kind).toBe('lambda')
  })

  it('empty chain is identity', () => {
    const expr = compileLinkExpr({ kind: 'chain', links: [] })
    const result = applyLambda(expr, sampleRow)
    expect(result).toEqual(sampleRow)
  })

  it('single link chain behaves like that link', () => {
    const link: LinkExpr = { kind: 'pick', fields: ['title'] }
    const chain = compileLinkExpr({ kind: 'chain', links: [link] })
    const direct = compileLinkExpr(link)
    expect(applyLambda(chain, sampleRow)).toEqual(applyLambda(direct, sampleRow))
  })

  it('composes two links in order: first pick, then compute', () => {
    const chain = compileLinkExpr({
      kind: 'chain',
      links: [
        { kind: 'pick', fields: ['thumbUrl'] },
        { kind: 'rename', mappings: [{ from: 'thumbUrl', to: 'coverUrl' }], keepRest: false },
      ],
    })
    const result = applyLambda(chain, sampleRow) as MaisieRecord
    expect(result.coverUrl).toBe('https://example.com/img.jpg')
    expect(result.thumbUrl).toBeUndefined()
    expect(result.title).toBeUndefined()
  })

  it('applies steps left to right', () => {
    // Step 1: pick title and thumbUrl
    // Step 2: rename thumbUrl -> coverUrl (keepRest)
    // Step 3: compute status = 'ok' (keepRest)
    const chain = compileLinkExpr({
      kind: 'chain',
      links: [
        { kind: 'pick', fields: ['title', 'thumbUrl'] },
        { kind: 'rename', mappings: [{ from: 'thumbUrl', to: 'coverUrl' }], keepRest: true },
        { kind: 'compute', assignments: [{ name: 'status', value: 'ok' }] },
      ],
    })
    const result = applyLambda(chain, sampleRow) as MaisieRecord
    expect(result.title).toBe('The Matrix')
    expect(result.coverUrl).toBe('https://example.com/img.jpg')
    expect(result.status).toBe('ok')
    // rating was dropped in step 1
    expect(result.rating).toBeUndefined()
  })
})

describe('empty-record primitive', () => {
  it('is registered in PRIMITIVES', () => {
    expect('empty-record' in PRIMITIVES).toBe(true)
  })

  it('returns an empty object', () => {
    const result = PRIMITIVES['empty-record']()
    expect(result).toEqual({})
  })
})
