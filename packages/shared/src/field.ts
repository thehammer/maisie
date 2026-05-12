import { z } from 'zod'

/**
 * Schema-level type — describes the overall shape of an action's output.
 * Inferred from the Zod output schema; determines what affordances the card
 * builder offers (filter/sort for collection, key-value for record, etc.).
 *
 *   scalar     — a single typed value (string, number, boolean, timestamp…)
 *   record     — one object with fixed named fields, heterogeneous values
 *   collection — array of records sharing the same schema; supports filter/sort/group
 *   json       — untyped or dynamic structure; rendered as a collapsed viewer
 */
export type MaisieSchemaType = 'scalar' | 'record' | 'collection' | 'json'

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
  | 'gauge'          // 0–100 → renders as semi-circle arc gauge
  | 'status'         // Named state from shared vocabulary → colored badge
  | 'image'          // URL to image → <img> thumbnail
  | 'timestamp'      // ISO 8601 date → relative time "2h ago"
  | 'epoch_ms'       // Unix milliseconds → relative time "2h ago"
  | 'duration'       // Seconds → "2h 34m"
  | 'progress'       // { current, total, label? } → progress bar + fraction
  | 'temperature'    // Celsius → "72°C" with threshold color
  | 'signal'         // dBm → signal-strength indicator
  | 'toggle'         // Boolean with write capability → toggle switch
  | 'action'         // Triggerable command → button
  | 'stream'         // URL to media stream → player / channel tile
  | 'url'            // Clickable link → <a>
  | 'record'         // Nested object with typed fields → sub-card
  | 'collection'     // Nested array of records → inline table
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
 *
 * Checks both schema.description (Zod v4 getter) and schema._def.description
 * (Zod v3 / legacy path) for compatibility.
 */
export function getMaisieType(schema: z.ZodTypeAny): MaisieFieldType | null {
  // Zod v4: description is an own getter property on the schema instance.
  // _def may be undefined for some schema kinds, so guard before accessing it.
  const desc =
    (schema as unknown as { description?: string }).description ??
    (schema._def as { description?: string } | undefined)?.description
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
