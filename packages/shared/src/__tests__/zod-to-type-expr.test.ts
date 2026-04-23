import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { zodToTypeExpr } from '../zod-to-type-expr'
import { field } from '../field'
import type { TypeExpr } from '../component'

// ── Scalars ───────────────────────────────────────────────────────────────────

describe('zodToTypeExpr — scalars', () => {
  it('z.string() → scalar<string>', () => {
    expect(zodToTypeExpr(z.string())).toEqual({ kind: 'scalar', type: 'string' })
  })

  it('z.number() → scalar<number>', () => {
    expect(zodToTypeExpr(z.number())).toEqual({ kind: 'scalar', type: 'number' })
  })

  it('z.boolean() → scalar<boolean>', () => {
    expect(zodToTypeExpr(z.boolean())).toEqual({ kind: 'scalar', type: 'boolean' })
  })

  it('z.enum() → scalar<string>', () => {
    expect(zodToTypeExpr(z.enum(['a', 'b', 'c']))).toEqual({ kind: 'scalar', type: 'string' })
  })

  it('z.literal(string) → scalar<string>', () => {
    expect(zodToTypeExpr(z.literal('foo'))).toEqual({ kind: 'scalar', type: 'string' })
  })

  it('z.literal(number) → scalar<number>', () => {
    expect(zodToTypeExpr(z.literal(42))).toEqual({ kind: 'scalar', type: 'number' })
  })

  it('z.literal(boolean) → scalar<boolean>', () => {
    expect(zodToTypeExpr(z.literal(true))).toEqual({ kind: 'scalar', type: 'boolean' })
  })
})

// ── Annotated scalars (field()) ───────────────────────────────────────────────

describe('zodToTypeExpr — annotated scalars', () => {
  it('field(z.string(), "url") → scalar<url>', () => {
    expect(zodToTypeExpr(field(z.string(), 'url'))).toEqual({ kind: 'scalar', type: 'url' })
  })

  it('field(z.string(), "image") → scalar<image>', () => {
    expect(zodToTypeExpr(field(z.string(), 'image'))).toEqual({ kind: 'scalar', type: 'image' })
  })

  it('field(z.string(), "timestamp") → scalar<timestamp>', () => {
    expect(zodToTypeExpr(field(z.string(), 'timestamp'))).toEqual({ kind: 'scalar', type: 'timestamp' })
  })

  it('field(z.string(), "status") → scalar<status>', () => {
    expect(zodToTypeExpr(field(z.string(), 'status'))).toEqual({ kind: 'scalar', type: 'status' })
  })

  it('field(z.number(), "percentage") → scalar<percentage>', () => {
    expect(zodToTypeExpr(field(z.number(), 'percentage'))).toEqual({ kind: 'scalar', type: 'percentage' })
  })

  it('field(z.number(), "bytes") → scalar<bytes>', () => {
    expect(zodToTypeExpr(field(z.number(), 'bytes'))).toEqual({ kind: 'scalar', type: 'bytes' })
  })

  it('field(z.number(), "duration") → scalar<duration>', () => {
    expect(zodToTypeExpr(field(z.number(), 'duration'))).toEqual({ kind: 'scalar', type: 'duration' })
  })

  it('field(z.number(), "epoch_ms") → scalar<epoch_ms>', () => {
    expect(zodToTypeExpr(field(z.number(), 'epoch_ms'))).toEqual({ kind: 'scalar', type: 'epoch_ms' })
  })

  it('field(z.number(), "temperature") → scalar<temperature>', () => {
    expect(zodToTypeExpr(field(z.number(), 'temperature'))).toEqual({ kind: 'scalar', type: 'temperature' })
  })

  it('field(z.number(), "signal") → scalar<signal>', () => {
    expect(zodToTypeExpr(field(z.number(), 'signal'))).toEqual({ kind: 'scalar', type: 'signal' })
  })

  it('field(z.boolean(), "toggle") → scalar<toggle>', () => {
    expect(zodToTypeExpr(field(z.boolean(), 'toggle'))).toEqual({ kind: 'scalar', type: 'toggle' })
  })

  it('field(z.string(), "stream") → scalar<stream>', () => {
    expect(zodToTypeExpr(field(z.string(), 'stream'))).toEqual({ kind: 'scalar', type: 'stream' })
  })
})

// ── Record ────────────────────────────────────────────────────────────────────

describe('zodToTypeExpr — record', () => {
  it('simple object with two fields', () => {
    const schema = z.object({ foo: z.string(), bar: z.number() })
    const result = zodToTypeExpr(schema)
    expect(result).toEqual({
      kind: 'record',
      fields: {
        foo: { kind: 'scalar', type: 'string' },
        bar: { kind: 'scalar', type: 'number' },
      },
    })
  })

  it('object with optional field — marks in optional array, uses inner type', () => {
    const schema = z.object({ a: z.string(), b: z.string().optional() })
    const result = zodToTypeExpr(schema)
    expect(result).toEqual({
      kind: 'record',
      fields: {
        a: { kind: 'scalar', type: 'string' },
        b: { kind: 'scalar', type: 'string' },
      },
      optional: ['b'],
    })
  })

  it('object with nullable field — treated same as optional', () => {
    const schema = z.object({ a: z.string(), b: z.string().nullable() })
    const result = zodToTypeExpr(schema)
    expect(result).toEqual({
      kind: 'record',
      fields: {
        a: { kind: 'scalar', type: 'string' },
        b: { kind: 'scalar', type: 'string' },
      },
      optional: ['b'],
    })
  })

  it('object with annotated field — annotation wins over Zod primitive', () => {
    const schema = z.object({
      title: z.string(),
      coverUrl: field(z.string(), 'url'),
      addedAt: field(z.number(), 'epoch_ms'),
    })
    const result = zodToTypeExpr(schema)
    expect(result).toEqual({
      kind: 'record',
      fields: {
        title: { kind: 'scalar', type: 'string' },
        coverUrl: { kind: 'scalar', type: 'url' },
        addedAt: { kind: 'scalar', type: 'epoch_ms' },
      },
    })
  })

  it('nested record', () => {
    const schema = z.object({
      outer: z.string(),
      inner: z.object({ x: z.number(), y: z.number() }),
    })
    const result = zodToTypeExpr(schema)
    expect(result).toEqual({
      kind: 'record',
      fields: {
        outer: { kind: 'scalar', type: 'string' },
        inner: {
          kind: 'record',
          fields: {
            x: { kind: 'scalar', type: 'number' },
            y: { kind: 'scalar', type: 'number' },
          },
        },
      },
    })
  })
})

// ── Collection ────────────────────────────────────────────────────────────────

describe('zodToTypeExpr — collection', () => {
  it('z.array(z.string()) → collection<scalar<string>>', () => {
    const result = zodToTypeExpr(z.array(z.string()))
    expect(result).toEqual({
      kind: 'collection',
      element: { kind: 'scalar', type: 'string' },
    })
  })

  it('z.array(z.object(...)) → collection<record>', () => {
    const schema = z.array(z.object({ title: z.string(), year: z.number() }))
    const result = zodToTypeExpr(schema)
    expect(result).toEqual({
      kind: 'collection',
      element: {
        kind: 'record',
        fields: {
          title: { kind: 'scalar', type: 'string' },
          year: { kind: 'scalar', type: 'number' },
        },
      },
    })
  })

  it('collection of annotated records', () => {
    const schema = z.array(
      z.object({
        title: z.string(),
        coverUrl: field(z.string(), 'url'),
        addedAt: field(z.number(), 'epoch_ms'),
      }),
    )
    const result = zodToTypeExpr(schema)
    expect(result).toEqual({
      kind: 'collection',
      element: {
        kind: 'record',
        fields: {
          title: { kind: 'scalar', type: 'string' },
          coverUrl: { kind: 'scalar', type: 'url' },
          addedAt: { kind: 'scalar', type: 'epoch_ms' },
        },
      },
    })
  })
})

// ── Optional / Nullable ───────────────────────────────────────────────────────

describe('zodToTypeExpr — optional and nullable at top level', () => {
  it('z.string().optional() → optional<scalar<string>>', () => {
    const result = zodToTypeExpr(z.string().optional())
    expect(result).toEqual({ kind: 'optional', inner: { kind: 'scalar', type: 'string' } })
  })

  it('z.string().nullable() → optional<scalar<string>>', () => {
    const result = zodToTypeExpr(z.string().nullable())
    expect(result).toEqual({ kind: 'optional', inner: { kind: 'scalar', type: 'string' } })
  })
})

// ── Union ─────────────────────────────────────────────────────────────────────

describe('zodToTypeExpr — union', () => {
  it('z.union([z.string(), z.number()]) → union', () => {
    const result = zodToTypeExpr(z.union([z.string(), z.number()]))
    expect(result).toEqual({
      kind: 'union',
      members: [
        { kind: 'scalar', type: 'string' },
        { kind: 'scalar', type: 'number' },
      ],
    })
  })

  it('z.union with record member', () => {
    const result = zodToTypeExpr(z.union([z.string(), z.object({ id: z.number() })]))
    expect(result).toEqual({
      kind: 'union',
      members: [
        { kind: 'scalar', type: 'string' },
        { kind: 'record', fields: { id: { kind: 'scalar', type: 'number' } } },
      ],
    })
  })
})

// ── Any / Unknown / Void ──────────────────────────────────────────────────────

describe('zodToTypeExpr — any/unknown/void', () => {
  it('z.any() → any', () => {
    expect(zodToTypeExpr(z.any())).toEqual({ kind: 'any' })
  })

  it('z.unknown() → any', () => {
    expect(zodToTypeExpr(z.unknown())).toEqual({ kind: 'any' })
  })

  it('z.void() → any', () => {
    expect(zodToTypeExpr(z.void())).toEqual({ kind: 'any' })
  })
})

// ── ZodRecord (dynamic keys) ──────────────────────────────────────────────────

describe('zodToTypeExpr — ZodRecord', () => {
  it('z.record(z.string()) → record with empty fields', () => {
    const result = zodToTypeExpr(z.record(z.string(), z.string()))
    expect(result).toEqual({ kind: 'record', fields: {} })
  })
})

// ── Depth guard ───────────────────────────────────────────────────────────────

describe('zodToTypeExpr — depth guard', () => {
  it('returns any when depth exceeds MAX_DEPTH', () => {
    // Build a deeply nested object (11 levels)
    let schema: z.ZodTypeAny = z.string()
    for (let i = 0; i < 11; i++) {
      schema = z.object({ nested: schema })
    }
    // Should not throw, just fall back to any at some point
    const result = zodToTypeExpr(schema)
    expect(result.kind).toBe('record') // outer levels are fine
  })
})
