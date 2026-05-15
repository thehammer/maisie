// Pipeline-internal types for the Callimachus indexing pipeline

export type PassName = 'chunk' | 'extract_structure' | 'extract_semantic' | 'summarize'

export interface IndexOptions {
  corpusId: string
  passes?: PassName[]
  fromChunk?: string
  dryRun?: boolean
  concurrency?: number
}

export interface PassStats {
  processed: number
  skipped: number
  failed: number
  tokens_in?: number
  tokens_out?: number
  cost_usd?: number
  errors: { chunk_id: string; message: string }[]
}

/** Mirrors the `runs` table row */
export interface RunRecord {
  id: string
  corpus_id: string
  pass: PassName
  started_at: string
  finished_at: string | null
  status: 'running' | 'completed' | 'failed' | 'skipped'
  stats: PassStats
}

export interface IndexResult {
  runs: RunRecord[]
  total_chunks: number
  total_entities: number
  cost_usd: number
}
