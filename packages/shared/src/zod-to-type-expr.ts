import { z } from 'zod'
import type { TypeExpr, RecordType } from './component'
import type { MaisieFieldType } from './field'
import { getMaisieType } from './field'

/**
 * Maximum recursion depth for nested schema conversion. Schemas that go
 * deeper fall back to { kind: 'any' } rather than risking a stack overflow.
 */
const MAX_DEPTH = 10

/**
 * Convert a Zod schema to a TypeExpr. Preserves MaisieFieldType annotations
 * applied via field() so semantic types (url, timestamp, percentage) propagate
 * to the structural matcher.
 *
 * Handles the Zod kinds that actually appear in plugin action outputs:
 *   - z.object(...)       → record
 *   - z.array(...)        → collection
 *   - z.string/number/...  → scalar (with annotation if present)
 *   - z.optional(...)     → optional
 *   - z.nullable(...)     → optional (treated identically for structural purposes)
 *   - z.record(...)       → record with any values (fallback)
 *   - z.unknown/any/void  → any
 *   - z.union(...)        → union
 *   - z.literal(...)      → scalar (infers type from literal value)
 *   - z.enum(...)         → scalar<string>
 *
 * Unknown Zod kinds fall back to { kind: 'any' } with a debug log.
 */
export function zodToTypeExpr(schema: z.ZodTypeAny, _depth = 0): TypeExpr {
  if (_depth > MAX_DEPTH) {
    return { kind: 'any' }
  }

  // Guard against non-Zod objects passed via `as any` in tests or legacy code
  if (!schema || typeof schema !== 'object') {
    return { kind: 'any' }
  }

  // First check for a MaisieFieldType annotation — these trump the Zod kind
  // (so field(z.string(), 'url') produces scalar<url>, not scalar<string>)
  const annotation = getMaisieType(schema)
  if (annotation) {
    return { kind: 'scalar', type: annotation }
  }

  // ZodObject → record
  if (schema instanceof z.ZodObject) {
    return zodObjectToRecord(schema, _depth)
  }

  // ZodArray → collection
  if (schema instanceof z.ZodArray) {
    const element = zodToTypeExpr(schema.element as z.ZodTypeAny, _depth + 1)
    return { kind: 'collection', element }
  }

  // ZodOptional → optional (wraps inner)
  if (schema instanceof z.ZodOptional) {
    const inner = zodToTypeExpr(schema.unwrap() as z.ZodTypeAny, _depth + 1)
    return { kind: 'optional', inner }
  }

  // ZodNullable → treated as optional for structural purposes
  if (schema instanceof z.ZodNullable) {
    const inner = zodToTypeExpr(schema.unwrap() as z.ZodTypeAny, _depth + 1)
    return { kind: 'optional', inner }
  }

  // ZodDefault — strip the default and convert inner
  if (schema instanceof z.ZodDefault) {
    const innerType = (schema._def as unknown as { innerType: z.ZodTypeAny }).innerType
    return zodToTypeExpr(innerType, _depth + 1)
  }

  // ZodPipe (Zod v4 — replaces ZodEffects/ZodTransform) — convert the input side
  if (schema instanceof z.ZodPipe) {
    const inSchema = (schema.def as unknown as { in: z.ZodTypeAny }).in
    return zodToTypeExpr(inSchema, _depth + 1)
  }

  // ZodString → scalar<string>
  if (schema instanceof z.ZodString) {
    return { kind: 'scalar', type: 'string' }
  }

  // ZodNumber → scalar<number>
  if (schema instanceof z.ZodNumber) {
    return { kind: 'scalar', type: 'number' }
  }

  // ZodBoolean → scalar<boolean>
  if (schema instanceof z.ZodBoolean) {
    return { kind: 'scalar', type: 'boolean' }
  }

  // ZodEnum → scalar<string>
  if (schema instanceof z.ZodEnum) {
    return { kind: 'scalar', type: 'string' }
  }

  // ZodLiteral → infer scalar type from literal value.
  // Zod v4 stores multiple values in an array (def.values); Zod v3 used def.value.
  if (schema instanceof z.ZodLiteral) {
    const def = schema._def as unknown as { value?: unknown; values?: unknown[] }
    const value = def.value ?? def.values?.[0]
    if (typeof value === 'string') return { kind: 'scalar', type: 'string' }
    if (typeof value === 'number') return { kind: 'scalar', type: 'number' }
    if (typeof value === 'boolean') return { kind: 'scalar', type: 'boolean' }
    return { kind: 'any' }
  }

  // ZodUnion → union of member types
  if (schema instanceof z.ZodUnion) {
    const options = (schema.def as unknown as { options: z.ZodTypeAny[] }).options
    const members = options.map((m) => zodToTypeExpr(m, _depth + 1))
    return { kind: 'union', members }
  }

  // ZodDiscriminatedUnion — treat as union of its options
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const options = (schema.def as unknown as { options: z.ZodTypeAny[] }).options
    const members = options.map((m) => zodToTypeExpr(m, _depth + 1))
    return { kind: 'union', members }
  }

  // ZodRecord (dynamic keys) → record with any values
  if (schema instanceof z.ZodRecord) {
    return { kind: 'record', fields: {} }
  }

  // ZodAny / ZodUnknown / ZodVoid / ZodNever → any
  if (
    schema instanceof z.ZodAny ||
    schema instanceof z.ZodUnknown ||
    schema instanceof z.ZodVoid ||
    schema instanceof z.ZodNever
  ) {
    return { kind: 'any' }
  }

  // ZodDate → scalar<timestamp> (best semantic fit)
  if (schema instanceof z.ZodDate) {
    return { kind: 'scalar', type: 'timestamp' }
  }

  // ZodTuple — conservatively map to collection<any>
  if (schema instanceof z.ZodTuple) {
    return { kind: 'collection', element: { kind: 'any' } }
  }

  // Unknown Zod kind — fall back to any silently
  return { kind: 'any' }
}

/**
 * Convert a ZodObject to a RecordType, recursively converting each field.
 * Fields that are optional or nullable are recorded in the `optional` array;
 * their inner type (unwrapped) is stored as the field value.
 */
function zodObjectToRecord(schema: z.ZodObject<z.ZodRawShape>, depth: number): RecordType {
  const shape = schema.shape as Record<string, z.ZodTypeAny>
  const fields: Record<string, TypeExpr> = {}
  const optional: string[] = []

  for (const [key, fieldSchema] of Object.entries(shape)) {
    // Check for MaisieFieldType annotation on the outer schema first
    // (field() is applied before optional/nullable wrapping in some cases)
    const outerAnnotation = getMaisieType(fieldSchema as z.ZodTypeAny)
    if (outerAnnotation) {
      fields[key] = { kind: 'scalar', type: outerAnnotation }
      continue
    }

    // Determine optionality and extract inner type
    if (
      fieldSchema instanceof z.ZodOptional ||
      fieldSchema instanceof z.ZodNullable
    ) {
      optional.push(key)
      const inner = (fieldSchema as z.ZodOptional<z.ZodTypeAny> | z.ZodNullable<z.ZodTypeAny>).unwrap() as z.ZodTypeAny
      fields[key] = zodToTypeExpr(inner, depth + 1)
    } else {
      fields[key] = zodToTypeExpr(fieldSchema as z.ZodTypeAny, depth + 1)
    }
  }

  const result: RecordType = { kind: 'record', fields }
  if (optional.length > 0) result.optional = optional
  return result
}

/**
 * Convert a DataFieldDef's type (string or TypeExpr) to a TypeExpr.
 * Kept here as a utility for converters that only have the shared package.
 */
export function stringTypeToTypeExpr(type: MaisieFieldType | 'record' | 'collection'): TypeExpr {
  if (type === 'record') return { kind: 'record', fields: {} }
  if (type === 'collection') return { kind: 'collection', element: { kind: 'any' } }
  return { kind: 'scalar', type: type as MaisieFieldType }
}
