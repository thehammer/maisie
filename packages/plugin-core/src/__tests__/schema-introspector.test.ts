import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { introspectSchema } from '../schema-introspector'

describe('introspectSchema', () => {
  it('returns fields for a flat ZodObject', () => {
    const schema = z.object({
      title: z.string(),
      count: z.number().optional(),
    })
    const fields = introspectSchema(schema)
    expect(fields).toHaveLength(2)

    const titleField = fields.find((f) => f.key === 'title')
    expect(titleField).toBeDefined()
    expect(titleField?.type).toBe('string')
    expect(titleField?.optional).toBe(false)

    const countField = fields.find((f) => f.key === 'count')
    expect(countField).toBeDefined()
    expect(countField?.type).toBe('number')
    expect(countField?.optional).toBe(true)
  })

  it('prettifies keys into labels', () => {
    const schema = z.object({
      firstName: z.string(),
      total_count: z.number(),
    })
    const fields = introspectSchema(schema)
    const first = fields.find((f) => f.key === 'firstName')
    const total = fields.find((f) => f.key === 'total_count')
    expect(first?.label).toBe('First Name')
    expect(total?.label).toBe('Total Count')
  })

  it('types nested objects as "object"', () => {
    const schema = z.object({
      meta: z.object({ id: z.string(), tags: z.array(z.string()) }),
    })
    const fields = introspectSchema(schema)
    expect(fields).toHaveLength(1)
    expect(fields[0].key).toBe('meta')
    expect(fields[0].type).toBe('object')
  })

  it('types arrays as "array"', () => {
    const schema = z.object({
      items: z.array(z.string()),
    })
    const fields = introspectSchema(schema)
    expect(fields[0].type).toBe('array')
  })

  it('marks ZodOptional-wrapped fields as optional: true', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
      nullable: z.string().nullable(),
      defaulted: z.string().default('x'),
    })
    const fields = introspectSchema(schema)
    expect(fields.find((f) => f.key === 'required')?.optional).toBe(false)
    expect(fields.find((f) => f.key === 'optional')?.optional).toBe(true)
    expect(fields.find((f) => f.key === 'nullable')?.optional).toBe(true)
    expect(fields.find((f) => f.key === 'defaulted')?.optional).toBe(true)
  })

  it('returns [] for z.any()', () => {
    expect(introspectSchema(z.any())).toEqual([])
  })

  it('returns [] for z.unknown()', () => {
    expect(introspectSchema(z.unknown())).toEqual([])
  })

  it('introspects element schema for a top-level ZodArray of objects', () => {
    const schema = z.array(z.object({ name: z.string(), value: z.number() }))
    const fields = introspectSchema(schema)
    expect(fields).toHaveLength(2)
    expect(fields.find((f) => f.key === 'name')?.type).toBe('string')
    expect(fields.find((f) => f.key === 'value')?.type).toBe('number')
  })

  it('returns [] for a top-level ZodArray of primitives', () => {
    expect(introspectSchema(z.array(z.string()))).toEqual([])
  })

  it('handles ZodEffects (z.transform) by unwrapping inner type', () => {
    const schema = z.object({ count: z.number() }).transform((v) => v)
    const fields = introspectSchema(schema)
    expect(fields).toHaveLength(1)
    expect(fields[0].key).toBe('count')
  })
})
