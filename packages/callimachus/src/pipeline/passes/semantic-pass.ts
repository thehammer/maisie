import { eq } from 'drizzle-orm'
import type { Db } from '../../storage/db'
import type { Corpus } from '../../types/corpus'
import type { SourceAdapter } from '../../adapter/contract'
import type { LlmClient } from '../../adapter/contract'
import type { IndexOptions, PassStats } from '../types'
import { listChunksForCorpus } from '../chunk-store'
import { upsertEntity, listEntitiesForCorpus, applyEntityMerges, entityId } from '../entity-store'
import { upsertSummary } from '../summary-store'
import { entities } from '../../storage/schema'
import type { Entity } from '../../types/entity'

interface SemanticPassArgs {
  db: Db
  corpus: Corpus
  adapter: SourceAdapter
  llm: LlmClient
  opts: IndexOptions
}

export async function runSemanticPass(args: SemanticPassArgs): Promise<PassStats> {
  const { db, corpus, adapter, llm, opts } = args
  const stats: PassStats = { processed: 0, skipped: 0, failed: 0, errors: [] }

  if (!adapter.extractWithLlm) {
    return { ...stats, skipped: -1 } // signal: pass not applicable
  }

  const allChunks = listChunksForCorpus(db, corpus.id)

  for (const chunk of allChunks) {
    // Idempotency: skip if this chunk already has associated entities
    const existingEntity = db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.last_location_uri, chunk.location.uri))
      .get()

    if (existingEntity) {
      stats.skipped++
      continue
    }

    try {
      const extracted = await adapter.extractWithLlm!(chunk, llm)

      if (!opts.dryRun) {
        // Upsert each entity with defaults filled in
        for (const partial of extracted.entities) {
          const filled: Entity = {
            id: entityId(
              corpus.id,
              partial.kind ?? 'unknown',
              partial.canonical_name ?? '',
            ),
            corpus_id: corpus.id,
            canonical_name: partial.canonical_name ?? '',
            kind: partial.kind ?? 'unknown',
            aliases: partial.aliases ?? [],
            description: partial.description ?? null,
            first_location: partial.first_location ?? chunk.location,
            last_location: partial.last_location ?? chunk.location,
            appearance_count: partial.appearance_count ?? 1,
            confidence: partial.confidence ?? 0.5,
          }
          if (filled.canonical_name) {
            upsertEntity(db, filled)
          }
        }

        // Upsert chunk-level summary if present
        if (extracted.summary_text) {
          upsertSummary(db, {
            id: '', // will be replaced in upsertSummary
            corpus_id: corpus.id,
            target_kind: 'chunk',
            target_id: chunk.id,
            depth: chunk.kind,
            text: extracted.summary_text,
            model: null,
            generated_at: new Date(),
          })
        }
      }

      stats.processed++

      if (process.stdout.isTTY) {
        process.stdout.write(
          `\r[extract_semantic] processed ${stats.processed}  skipped ${stats.skipped}`,
        )
      }
    } catch (err) {
      stats.failed++
      stats.errors.push({
        chunk_id: chunk.id,
        message: err instanceof Error ? err.message : String(err),
      })
      // Continue — one bad chunk must not abort the run
    }
  }

  if (process.stdout.isTTY && (stats.processed > 0 || stats.skipped > 0)) {
    process.stdout.write('\n')
  }

  // Resolve aliases once at the end of the pass
  if (!opts.dryRun && adapter.resolveAliases) {
    try {
      const allEntities = listEntitiesForCorpus(db, corpus.id)
      const merges = await adapter.resolveAliases(allEntities)
      if (merges.length > 0) {
        applyEntityMerges(db, corpus.id, merges)
      }
    } catch (err) {
      // Non-fatal — log but don't fail the pass
      console.warn(`[callimachus] resolveAliases failed: ${String(err)}`)
    }
  }

  return stats
}
