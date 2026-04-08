import { z } from 'zod'
import { getMaisieType } from '@maisie/shared'
import type { MaisieSchemaType } from '@maisie/shared'
import type { CardField } from './types'

export interface IntrospectResult {
  schemaType: MaisieSchemaType
  fields: CardField[]
}

/**
 * Prettifies a camelCase or snake_case key into a human-readable label.
 * Examples: "firstName" → "First Name", "total_count" → "Total Count"
 */
function prettifyKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Unwraps optional/nullable/default/pipe wrappers to get the inner schema.
 * Handles Zod v4 where ZodEffects is replaced by ZodPipe.
 */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrapSchema(schema.unwrap() as z.ZodTypeAny)
  }
  if (schema instanceof z.ZodDefault) {
    const innerType = (schema._def as unknown as { innerType: z.ZodTypeAny }).innerType
    return unwrapSchema(innerType)
  }
  // Zod v4: ZodPipe (replaces ZodEffects/ZodTransform) — inner type is at def.in
  if (schema instanceof z.ZodPipe) {
    const inSchema = (schema.def as unknown as { in: z.ZodTypeAny }).in
    return unwrapSchema(inSchema)
  }
  return schema
}

/**
 * Returns true if the schema is optional (ZodOptional, ZodNullable, or has a default).
 */
function isOptionalSchema(schema: z.ZodTypeAny): boolean {
  return (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  )
}

/**
 * Maps a Zod type to our simple CardField type enum.
 */
function zodTypeToFieldType(schema: z.ZodTypeAny): CardField['type'] {
  const inner = unwrapSchema(schema)

  if (inner instanceof z.ZodString) return 'string'
  if (inner instanceof z.ZodNumber) return 'number'
  if (inner instanceof z.ZodBoolean) return 'boolean'
  if (inner instanceof z.ZodArray) return 'array'
  if (inner instanceof z.ZodObject) return 'object'
  if (inner instanceof z.ZodEnum) return 'string'
  if (inner instanceof z.ZodDate) return 'string'
  if (inner instanceof z.ZodUnion) return 'string' // conservative fallback

  if (inner instanceof z.ZodLiteral) {
    const v = (inner.def as unknown as { value: unknown }).value
    if (typeof v === 'string') return 'string'
    if (typeof v === 'number') return 'number'
    if (typeof v === 'boolean') return 'boolean'
  }

  return 'unknown'
}

/**
 * Inspects a Zod schema and returns the schema-level type plus CardField[].
 *
 *   scalar     — top-level primitive (string, number, boolean, enum, literal)
 *   record     — ZodObject with fixed named fields
 *   collection — ZodArray whose element is a ZodObject
 *   json       — ZodAny, ZodUnknown, ZodRecord (dynamic keys), or unrecognised
 *
 * Fields are the introspected columns for record/collection; empty for scalar/json.
 */
export function introspectSchema(schema: z.ZodTypeAny): IntrospectResult {
  const inner = unwrapSchema(schema)

  // Untyped — json
  if (inner instanceof z.ZodAny || inner instanceof z.ZodUnknown) {
    return { schemaType: 'json', fields: [] }
  }

  // Dynamic keys — json
  if (inner instanceof z.ZodRecord) {
    return { schemaType: 'json', fields: [] }
  }

  // collection — ZodArray of ZodObject
  if (inner instanceof z.ZodArray) {
    const elementInner = unwrapSchema(inner.element as z.ZodTypeAny)
    if (elementInner instanceof z.ZodObject) {
      return { schemaType: 'collection', fields: introspectObject(elementInner) }
    }
    // Array of primitives — treat as json
    return { schemaType: 'json', fields: [] }
  }

  // record — ZodObject
  if (inner instanceof z.ZodObject) {
    return { schemaType: 'record', fields: introspectObject(inner) }
  }

  // scalar — primitives
  if (
    inner instanceof z.ZodString ||
    inner instanceof z.ZodNumber ||
    inner instanceof z.ZodBoolean ||
    inner instanceof z.ZodEnum ||
    inner instanceof z.ZodLiteral ||
    inner instanceof z.ZodDate
  ) {
    return { schemaType: 'scalar', fields: [] }
  }

  // Fallback — json
  return { schemaType: 'json', fields: [] }
}

function introspectObject(schema: z.ZodObject<z.ZodRawShape>): CardField[] {
  const fields: CardField[] = []
  const shape = schema.shape

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const fs = fieldSchema as z.ZodTypeAny
    const optional = isOptionalSchema(fs)
    const type = zodTypeToFieldType(fs)
    // Check for maisie:* annotation on the outer schema first (field() is applied
    // before optional/nullable wrapping), then fall back to the unwrapped inner.
    const maisieType = getMaisieType(fs) ?? getMaisieType(unwrapSchema(fs))
    fields.push({
      key,
      type,
      maisieType,
      label: prettifyKey(key),
      optional,
    })
  }

  return fields
}
