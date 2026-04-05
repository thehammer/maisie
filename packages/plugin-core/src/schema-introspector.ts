import { z } from 'zod'
import { getMaisieType } from '@maisie/shared'
import type { CardField } from './types'

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
 * Inspects a Zod schema and returns CardField[] — one entry per top-level
 * key for ZodObject schemas. Non-object top-level schemas return [].
 *
 * Nested objects are typed as 'object' (not recursively flattened),
 * and arrays are typed as 'array'.
 */
export function introspectSchema(schema: z.ZodTypeAny): CardField[] {
  const inner = unwrapSchema(schema)

  // ZodAny / ZodUnknown — can't introspect
  if (inner instanceof z.ZodAny || inner instanceof z.ZodUnknown) {
    return []
  }

  // ZodArray — top-level array: introspect the element type if it's an object
  if (inner instanceof z.ZodArray) {
    const elementInner = unwrapSchema(inner.element as z.ZodTypeAny)
    if (elementInner instanceof z.ZodObject) {
      return introspectObject(elementInner)
    }
    return []
  }

  // ZodObject — introspect directly
  if (inner instanceof z.ZodObject) {
    return introspectObject(inner)
  }

  // Primitives and everything else at the top level — no fields to expose
  return []
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
