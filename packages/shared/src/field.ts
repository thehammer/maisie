import { z } from 'zod'

/**
 * Semantic field types — the vocabulary that lets the framework render and reason
 * about resource fields without plugin-specific knowledge.
 *
 * Attach to Zod schemas using the field() helper below.
 */
export type MaisieFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'bytes'          // Storage/transfer size in bytes → renders as "1.2 GB"
  | 'percentage'     // 0–100 → renders as progress bar
  | 'status'         // Named state from shared vocabulary → colored badge
  | 'image'          // URL to image → <img> thumbnail
  | 'timestamp'      // ISO 8601 date → relative time "2h ago"
  | 'duration'       // Seconds → "2h 34m"
  | 'progress'       // { current, total, label? } → progress bar + fraction
  | 'temperature'    // Celsius → "72°C" with threshold color
  | 'signal'         // dBm → signal-strength indicator
  | 'toggle'         // Boolean with write capability → toggle switch
  | 'action'         // Triggerable command → button
  | 'stream'         // URL to media stream → player / channel tile
  | 'url'            // Clickable link → <a>
  | 'json'           // Untyped structured data → collapsed viewer

/**
 * Standard status values. Plugins must map their state strings to one of these
 * for the generic renderer to apply color treatment.
 */
export type MaisieStatus = 'ok' | 'warning' | 'error' | 'idle' | 'busy' | 'unknown'

/**
 * Annotate a Zod schema field with a semantic Maisie type.
 *
 * @example
 * const VolumeSchema = z.object({
 *   usedBytes:   field(z.number(), 'bytes'),
 *   usedPercent: field(z.number(), 'percentage'),
 *   status:      field(z.string(), 'status'),
 * })
 */
export function field<T extends z.ZodTypeAny>(schema: T, type: MaisieFieldType): T {
  return schema.describe(`maisie:${type}`) as T
}

/**
 * Read the Maisie semantic type from a Zod schema, if one was attached.
 * Returns null if no semantic type was annotated.
 */
export function getMaisieType(schema: z.ZodTypeAny): MaisieFieldType | null {
  const desc = (schema._def as { description?: string }).description
  if (desc?.startsWith('maisie:')) return desc.slice(7) as MaisieFieldType
  return null
}

/**
 * Walk a Zod object schema and extract all field type annotations.
 * Returns a map of field name → MaisieFieldType (or null if unannotated).
 */
export function getFieldTypes(schema: z.ZodTypeAny): Record<string, MaisieFieldType | null> {
  if (!(schema instanceof z.ZodObject)) return {}
  const shape = schema.shape as Record<string, z.ZodTypeAny>
  const result: Record<string, MaisieFieldType | null> = {}
  for (const [key, fieldSchema] of Object.entries(shape)) {
    result[key] = getMaisieType(fieldSchema)
  }
  return result
}
