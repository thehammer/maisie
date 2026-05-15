import { z } from 'zod'

export const CorpusStatusSchema = z.enum(['registered', 'indexing', 'ready', 'error'])
export type CorpusStatus = z.infer<typeof CorpusStatusSchema>

export const CorpusSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  source: z.string(),
  config: z.record(z.string(), z.unknown()).default({}),
  created_at: z.date(),
  last_indexed_at: z.date().nullable(),
  status: CorpusStatusSchema,
})

export type Corpus = z.infer<typeof CorpusSchema>
