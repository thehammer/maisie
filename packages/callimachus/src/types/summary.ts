import { z } from 'zod'

export const SummaryTargetKindSchema = z.enum(['corpus', 'chunk', 'entity', 'range'])
export type SummaryTargetKind = z.infer<typeof SummaryTargetKindSchema>

export const SummarySchema = z.object({
  id: z.string(),
  corpus_id: z.string(),
  target_kind: SummaryTargetKindSchema,
  target_id: z.string(),
  /**
   * Adapter-defined depth label.
   * Book adapters might use 'corpus' | 'chapter' | 'scene'.
   * Code adapters might use 'repo' | 'module' | 'function'.
   */
  depth: z.string(),
  text: z.string(),
  /** LLM model used to generate this summary; null for offline / heuristic summaries */
  model: z.string().nullable(),
  generated_at: z.date(),
})

export type Summary = z.infer<typeof SummarySchema>
