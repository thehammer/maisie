import type { Db } from '../../storage/db'
import type { Corpus } from '../../types/corpus'
import type { SourceAdapter, LlmClient } from '../../adapter/contract'
import type { IndexOptions, PassStats } from '../types'
import { listChunksForCorpus } from '../chunk-store'
import { upsertSummary, hasSummary } from '../summary-store'

interface SummarizePassArgs {
  db: Db
  corpus: Corpus
  adapter: SourceAdapter
  llm: LlmClient
  opts: IndexOptions
}

export async function runSummarizePass(args: SummarizePassArgs): Promise<PassStats> {
  const { db, corpus, adapter, llm, opts } = args
  const stats: PassStats = { processed: 0, skipped: 0, failed: 0, errors: [] }

  if (!adapter.summarize) {
    return { ...stats, skipped: -1 } // signal: pass not applicable
  }

  // Get all chunks sorted bottom-up (deepest parent_path depth first)
  const allChunks = listChunksForCorpus(db, corpus.id)
  const sorted = allChunks.sort((a, b) => {
    const depthA = (a.parent_path ?? '').split('/').length
    const depthB = (b.parent_path ?? '').split('/').length
    return depthB - depthA // desc — leaves first
  })

  for (const chunk of sorted) {
    // Idempotency: skip if summary already exists for this chunk at this depth
    if (hasSummary(db, corpus.id, 'chunk', chunk.id, chunk.kind)) {
      stats.skipped++
      continue
    }

    try {
      const summary = await adapter.summarize!(chunk, llm, chunk.kind)

      if (!opts.dryRun) {
        upsertSummary(db, summary)
      }

      stats.processed++

      if (process.stdout.isTTY) {
        process.stdout.write(
          `\r[summarize] processed ${stats.processed}  skipped ${stats.skipped}`,
        )
      }
    } catch (err) {
      stats.failed++
      stats.errors.push({
        chunk_id: chunk.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (process.stdout.isTTY && (stats.processed > 0 || stats.skipped > 0)) {
    process.stdout.write('\n')
  }

  return stats
}
