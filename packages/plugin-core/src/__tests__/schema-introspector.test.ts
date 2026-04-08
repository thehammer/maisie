import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { introspectSchema } from '../schema-introspector'

describe('introspectSchema', () => {
  // ── schema-level type inference ────────────────────────────────────────────

  it('classifies ZodObject as record', () => {
    const { schemaType } = introspectSchema(z.object({ title: z.string() }))
    expect(schemaType).toBe('record')
  })

  it('classifies ZodArray<ZodObject> as collection', () => {
    const { schemaType } = introspectSchema(z.array(z.object({ name: z.string() })))
    expect(schemaType).toBe('collection')
  })

  it('classifies ZodString as scalar', () => {
    expect(introspectSchema(z.string()).schemaType).toBe('scalar')
  })

  it('classifies ZodNumber as scalar', () => {
    expect(introspectSchema(z.number()).schemaType).toBe('scalar')
  })

  it('classifies ZodBoolean as scalar', () => {
    expect(introspectSchema(z.boolean()).schemaType).toBe('scalar')
  })

  it('classifies ZodEnum as scalar', () => {
    expect(introspectSchema(z.enum(['a', 'b'])).schemaType).toBe('scalar')
  })

  it('classifies ZodAny as json', () => {
    expect(introspectSchema(z.any()).schemaType).toBe('json')
  })

  it('classifies ZodUnknown as json', () => {
    expect(introspectSchema(z.unknown()).schemaType).toBe('json')
  })

  it('classifies ZodRecord as json', () => {
    expect(introspectSchema(z.record(z.string(), z.number())).schemaType).toBe('json')
  })

  it('classifies ZodArray of primitives as json', () => {
    expect(introspectSchema(z.array(z.string())).schemaType).toBe('json')
  })

  // ── field introspection ────────────────────────────────────────────────────

  it('returns fields for a flat ZodObject', () => {
    const { fields } = introspectSchema(z.object({
      title: z.string(),
      count: z.number().optional(),
    }))
    expect(fields).toHaveLength(2)

    const titleField = fields.find((f) => f.key === 'title')
    expect(titleField?.type).toBe('string')
    expect(titleField?.optional).toBe(false)

    const countField = fields.find((f) => f.key === 'count')
    expect(countField?.type).toBe('number')
    expect(countField?.optional).toBe(true)
  })

  it('returns element fields for a ZodArray of objects (collection)', () => {
    const { fields } = introspectSchema(z.array(z.object({ name: z.string(), value: z.number() })))
    expect(fields).toHaveLength(2)
    expect(fields.find((f) => f.key === 'name')?.type).toBe('string')
    expect(fields.find((f) => f.key === 'value')?.type).toBe('number')
  })

  it('returns empty fields for scalar', () => {
    expect(introspectSchema(z.string()).fields).toEqual([])
  })

  it('returns empty fields for json', () => {
    expect(introspectSchema(z.any()).fields).toEqual([])
    expect(introspectSchema(z.record(z.string(), z.number())).fields).toEqual([])
  })

  it('prettifies keys into labels', () => {
    const { fields } = introspectSchema(z.object({
      firstName: z.string(),
      total_count: z.number(),
    }))
    expect(fields.find((f) => f.key === 'firstName')?.label).toBe('First Name')
    expect(fields.find((f) => f.key === 'total_count')?.label).toBe('Total Count')
  })

  it('types nested objects as "object"', () => {
    const { fields } = introspectSchema(z.object({
      meta: z.object({ id: z.string() }),
    }))
    expect(fields[0].key).toBe('meta')
    expect(fields[0].type).toBe('object')
  })

  it('types arrays as "array"', () => {
    const { fields } = introspectSchema(z.object({
      items: z.array(z.string()),
    }))
    expect(fields[0].type).toBe('array')
  })

  it('marks ZodOptional-wrapped fields as optional: true', () => {
    const { fields } = introspectSchema(z.object({
      required: z.string(),
      optional: z.string().optional(),
      nullable: z.string().nullable(),
      defaulted: z.string().default('x'),
    }))
    expect(fields.find((f) => f.key === 'required')?.optional).toBe(false)
    expect(fields.find((f) => f.key === 'optional')?.optional).toBe(true)
    expect(fields.find((f) => f.key === 'nullable')?.optional).toBe(true)
    expect(fields.find((f) => f.key === 'defaulted')?.optional).toBe(true)
  })

  it('handles ZodPipe (z.transform) by unwrapping inner type', () => {
    const { fields } = introspectSchema(z.object({ count: z.number() }).transform((v) => v))
    expect(fields).toHaveLength(1)
    expect(fields[0].key).toBe('count')
  })
})
