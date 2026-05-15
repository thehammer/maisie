import type { Db } from '../../storage/db'
import type { Corpus } from '../../types/corpus'
import type { SourceAdapter } from '../../adapter/contract'
import type { IndexOptions, PassStats } from '../types'
import { listChunksForCorpus, updateChunkParentPath } from '../chunk-store'

const BATCH_SIZE = 200

interface StructurePassArgs {
  db: Db
  corpus: Corpus
  adapter: SourceAdapter
  opts: IndexOptions
}

export async function runStructurePass(args: StructurePassArgs): Promise<PassStats> {
  const { db, corpus, adapter, opts } = args
  const stats: PassStats = { processed: 0, skipped: 0, failed: 0, errors: [] }

  let afterId: string | undefined
  let batch = listChunksForCorpus(db, corpus.id, { limit: BATCH_SIZE })

  while (batch.length > 0) {
    for (const chunk of batch) {
      // Idempotency: skip if parent_path already populated
      if (chunk.parent_path !== null) {
        stats.skipped++
        afterId = chunk.id
        continue
      }

      try {
        const structure = await adapter.extractStructure(chunk)

        if (!opts.dryRun) {
          updateChunkParentPath(db, chunk.id, structure.parent_path)
        }

        stats.processed++

        if (process.stdout.isTTY) {
          process.stdout.write(
            `\r[extract_structure] processed ${stats.processed}  skipped ${stats.skipped}`,
          )
        }
      } catch (err) {
        stats.failed++
        stats.errors.push({
          chunk_id: chunk.id,
          message: err instanceof Error ? err.message : String(err),
        })
      }

      afterId = chunk.id
    }

    if (batch.length < BATCH_SIZE) break
    batch = listChunksForCorpus(db, corpus.id, { afterId, limit: BATCH_SIZE })
  }

  if (process.stdout.isTTY && (stats.processed > 0 || stats.skipped > 0)) {
    process.stdout.write('\n')
  }

  return stats
}
