import type { Db } from '../../storage/db'
import type { Corpus } from '../../types/corpus'
import type { SourceAdapter } from '../../adapter/contract'
import type { IndexOptions, PassStats } from '../types'
import { hasChunk, upsertChunk } from '../chunk-store'
import type { Chunk } from '../../types/chunk'
import { formatLocation } from '../../types/location'

interface ChunkPassArgs {
  db: Db
  corpus: Corpus
  adapter: SourceAdapter
  opts: IndexOptions
}

export async function runChunkPass(args: ChunkPassArgs): Promise<PassStats> {
  const { db, corpus, adapter, opts } = args
  const stats: PassStats = { processed: 0, skipped: 0, failed: 0, errors: [] }

  let reachedFromChunk = opts.fromChunk === undefined
  const sources = await adapter.discover(corpus.source)

  for (const source of sources) {
    for await (const rawChunk of adapter.chunk(source)) {
      // Normalize corpus_id — adapters may be constructed without knowing the corpus id
      const chunk: Chunk =
        rawChunk.corpus_id === corpus.id
          ? rawChunk
          : {
              ...rawChunk,
              corpus_id: corpus.id,
              location: {
                ...rawChunk.location,
                corpus_id: corpus.id,
                uri: formatLocation({ corpus_id: corpus.id, path: rawChunk.location.path }),
              },
            }
      // fromChunk resume: skip until we reach the target chunk id
      if (!reachedFromChunk) {
        if (chunk.id === opts.fromChunk) {
          reachedFromChunk = true
        } else {
          stats.skipped++
          continue
        }
      }

      // Skip already-indexed chunks (idempotency)
      if (hasChunk(db, chunk.id)) {
        stats.skipped++
        continue
      }

      if (opts.dryRun) {
        // Count but don't write
        stats.processed++
        continue
      }

      try {
        upsertChunk(db, chunk)
        stats.processed++

        if (process.stdout.isTTY) {
          process.stdout.write(
            `\r[chunk] processed ${stats.processed}  skipped ${stats.skipped}`,
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
  }

  if (process.stdout.isTTY && (stats.processed > 0 || stats.skipped > 0)) {
    process.stdout.write('\n')
  }

  return stats
}
