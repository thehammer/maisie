import { z } from 'zod'
import { LocationSchema } from './location'

export const EntitySchema = z.object({
  id: z.string(),
  corpus_id: z.string(),
  canonical_name: z.string(),
  /** Adapter-defined kind, e.g. 'character', 'place', 'symbol', 'function', 'class' */
  kind: z.string(),
  aliases: z.array(z.string()),
  description: z.string().nullable(),
  first_location: LocationSchema.nullable(),
  last_location: LocationSchema.nullable(),
  appearance_count: z.number().int().nonnegative(),
  /** Extraction confidence 0..1 */
  confidence: z.number().min(0).max(1),
})

export type Entity = z.infer<typeof EntitySchema>
