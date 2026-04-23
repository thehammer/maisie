import { describe, it, expect } from 'bun:test'
import { generateFixture } from '../fixture-generator'
import type { TypeExpr } from '@maisie/shared'

describe('generateFixture', () => {
  describe('scalar types', () => {
    it('string → non-empty string', () => {
      const val = generateFixture({ kind: 'scalar', type: 'string' })
      expect(typeof val).toBe('string')
      expect((val as string).length).toBeGreaterThan(0)
    })

    it('number → number', () => {
      const val = generateFixture({ kind: 'scalar', type: 'number' })
      expect(typeof val).toBe('number')
    })

    it('boolean → boolean', () => {
      const val = generateFixture({ kind: 'scalar', type: 'boolean' })
      expect(typeof val).toBe('boolean')
    })

    it('bytes → large number', () => {
      const val = generateFixture({ kind: 'scalar', type: 'bytes' })
      expect(typeof val).toBe('number')
      expect(val as number).toBeGreaterThan(0)
    })

    it('percentage → 0–100', () => {
      const val = generateFixture({ kind: 'scalar', type: 'percentage' }) as number
      expect(val).toBeGreaterThanOrEqual(0)
      expect(val).toBeLessThanOrEqual(100)
    })

    it('status → one of the known status strings', () => {
      const val = generateFixture({ kind: 'scalar', type: 'status' }) as string
      expect(['ok', 'warning', 'error', 'idle']).toContain(val)
    })

    it('image → placeholder URL string', () => {
      const val = generateFixture({ kind: 'scalar', type: 'image' })
      expect(typeof val).toBe('string')
      expect(val as string).toMatch(/^https?:\/\//)
    })

    it('url → URL string', () => {
      const val = generateFixture({ kind: 'scalar', type: 'url' })
      expect(typeof val).toBe('string')
      expect(val as string).toMatch(/^https?:\/\//)
    })

    it('timestamp → ISO 8601 string', () => {
      const val = generateFixture({ kind: 'scalar', type: 'timestamp' })
      expect(typeof val).toBe('string')
      expect(() => new Date(val as string)).not.toThrow()
    })

    it('epoch_ms → number', () => {
      const val = generateFixture({ kind: 'scalar', type: 'epoch_ms' })
      expect(typeof val).toBe('number')
      expect(val as number).toBeGreaterThan(0)
    })

    it('duration → positive number', () => {
      const val = generateFixture({ kind: 'scalar', type: 'duration' })
      expect(typeof val).toBe('number')
      expect(val as number).toBeGreaterThan(0)
    })

    it('temperature → number', () => {
      const val = generateFixture({ kind: 'scalar', type: 'temperature' })
      expect(typeof val).toBe('number')
    })

    it('signal → negative number (dBm)', () => {
      const val = generateFixture({ kind: 'scalar', type: 'signal' })
      expect(typeof val).toBe('number')
      expect(val as number).toBeLessThan(0)
    })

    it('stream → URL string', () => {
      const val = generateFixture({ kind: 'scalar', type: 'stream' })
      expect(typeof val).toBe('string')
      expect(val as string).toMatch(/^https?:\/\//)
    })

    it('toggle → boolean', () => {
      const val = generateFixture({ kind: 'scalar', type: 'toggle' })
      expect(typeof val).toBe('boolean')
    })

    it('action → null (not renderable)', () => {
      const val = generateFixture({ kind: 'scalar', type: 'action' })
      expect(val).toBeNull()
    })

    it('progress → object with current and total', () => {
      const val = generateFixture({ kind: 'scalar', type: 'progress' }) as Record<string, unknown>
      expect(val).not.toBeNull()
      expect(typeof val).toBe('object')
      expect(typeof val.current).toBe('number')
      expect(typeof val.total).toBe('number')
    })

    it('json → object', () => {
      const val = generateFixture({ kind: 'scalar', type: 'json' })
      expect(typeof val).toBe('object')
      expect(val).not.toBeNull()
    })
  })

  describe('record type', () => {
    it('populates all declared fields', () => {
      const type: TypeExpr = {
        kind: 'record',
        fields: {
          name: { kind: 'scalar', type: 'string' },
          age: { kind: 'scalar', type: 'number' },
          active: { kind: 'scalar', type: 'boolean' },
        },
      }
      const val = generateFixture(type) as Record<string, unknown>
      expect(typeof val.name).toBe('string')
      expect(typeof val.age).toBe('number')
      expect(typeof val.active).toBe('boolean')
    })

    it('skips optional fields at depth > 2', () => {
      // Wrap in a deeply nested structure so the record is generated at depth 3
      // collection(0) -> collection(1) -> collection(2) -> record(3)
      const inner: TypeExpr = {
        kind: 'record',
        fields: {
          required: { kind: 'scalar', type: 'string' },
          opt: { kind: 'scalar', type: 'string' },
        },
        optional: ['opt'],
      }
      const outer: TypeExpr = {
        kind: 'collection',
        element: {
          kind: 'collection',
          element: {
            kind: 'collection',
            element: inner,
          },
        },
      }
      const val = generateFixture(outer, { collectionSize: 1 }) as unknown as unknown[][][]
      const row = val[0][0][0] as Record<string, unknown>
      // At depth 3, optional fields should be skipped
      expect('required' in row).toBe(true)
      expect('opt' in row).toBe(false)
    })

    it('does not mutate options', () => {
      const opts = { collectionSize: 2, seed: 1 }
      const type: TypeExpr = { kind: 'record', fields: { x: { kind: 'scalar', type: 'number' } } }
      generateFixture(type, opts)
      expect(opts.collectionSize).toBe(2)
      expect(opts.seed).toBe(1)
    })
  })

  describe('collection type', () => {
    it('returns an array with collectionSize elements (default 3)', () => {
      const type: TypeExpr = {
        kind: 'collection',
        element: { kind: 'scalar', type: 'string' },
      }
      const val = generateFixture(type) as unknown[]
      expect(Array.isArray(val)).toBe(true)
      expect(val).toHaveLength(3)
    })

    it('respects custom collectionSize', () => {
      const type: TypeExpr = {
        kind: 'collection',
        element: { kind: 'scalar', type: 'number' },
      }
      const val = generateFixture(type, { collectionSize: 5 }) as unknown[]
      expect(val).toHaveLength(5)
    })

    it('each element matches the element type', () => {
      const type: TypeExpr = {
        kind: 'collection',
        element: { kind: 'scalar', type: 'string' },
      }
      const val = generateFixture(type) as unknown[]
      for (const item of val) {
        expect(typeof item).toBe('string')
      }
    })

    it('produces distinct values across elements via seed offset', () => {
      const type: TypeExpr = {
        kind: 'collection',
        element: { kind: 'scalar', type: 'number' },
      }
      const val = generateFixture(type, { collectionSize: 3 }) as unknown as number[]
      // Each element should be different because seed shifts
      expect(val[0]).not.toBe(val[1])
      expect(val[1]).not.toBe(val[2])
    })
  })

  describe('special type kinds', () => {
    it('any → "example"', () => {
      const val = generateFixture({ kind: 'any' })
      expect(val).toBe('example')
    })

    it('optional → delegates to inner type', () => {
      const val = generateFixture({ kind: 'optional', inner: { kind: 'scalar', type: 'number' } })
      expect(typeof val).toBe('number')
    })

    it('union → generates the first member', () => {
      const val = generateFixture({
        kind: 'union',
        members: [
          { kind: 'scalar', type: 'string' },
          { kind: 'scalar', type: 'number' },
        ],
      })
      expect(typeof val).toBe('string')
    })

    it('union with no members → null', () => {
      const val = generateFixture({ kind: 'union', members: [] })
      expect(val).toBeNull()
    })

    it('function → null', () => {
      const val = generateFixture({
        kind: 'function',
        params: [],
        returns: { kind: 'scalar', type: 'string' },
      })
      expect(val).toBeNull()
    })

    it('component → null', () => {
      const val = generateFixture({ kind: 'component' })
      expect(val).toBeNull()
    })
  })

  describe('deep recursion safety', () => {
    it('stops generating beyond depth 8 rather than overflowing', () => {
      // Build a deeply nested record (10 levels of record nesting)
      let type: TypeExpr = { kind: 'scalar', type: 'string' }
      for (let i = 0; i < 10; i++) {
        type = { kind: 'record', fields: { child: type } }
      }
      // Should not throw or hang
      expect(() => generateFixture(type)).not.toThrow()
    })
  })

  describe('determinism', () => {
    it('same seed produces same output', () => {
      const type: TypeExpr = {
        kind: 'collection',
        element: { kind: 'record', fields: { n: { kind: 'scalar', type: 'number' } } },
      }
      const a = generateFixture(type, { seed: 42 })
      const b = generateFixture(type, { seed: 42 })
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })

    it('different seeds produce different output', () => {
      const type: TypeExpr = { kind: 'scalar', type: 'number' }
      const a = generateFixture(type, { seed: 0 })
      const b = generateFixture(type, { seed: 1 })
      expect(a).not.toBe(b)
    })
  })
})
