import { z } from 'zod'
import { LocationSchema } from './location'

export const EdgeSchema = z.object({
  id: z.string(),
  corpus_id: z.string(),
  from_entity_id: z.string(),
  to_entity_id: z.string(),
  /** Adapter-defined relationship kind, e.g. 'mentions', 'calls', 'imports', 'knows' */
  kind: z.string(),
  location: LocationSchema,
  /** Extraction confidence 0..1 */
  confidence: z.number().min(0).max(1),
})

export type Edge = z.infer<typeof EdgeSchema>
