import { eq, sql } from 'drizzle-orm'
import type { Db } from '../storage/db'
import type { Corpus } from '../types/corpus'
import type { SourceAdapter, LlmClient } from '../adapter/contract'
import type { IndexOptions, IndexResult, PassName, PassStats, RunRecord } from './types'
import { startRun, finishRun } from './run-log'
import { runChunkPass } from './passes/chunk-pass'
import { runStructurePass } from './passes/structure-pass'
import { runSemanticPass } from './passes/semantic-pass'
import { runSummarizePass } from './passes/summarize-pass'
import { corpora, chunks, entities } from '../storage/schema'

const DEFAULT_PASSES: PassName[] = [
  'chunk',
  'extract_structure',
  'extract_semantic',
  'summarize',
]

interface RunIndexArgs {
  db: Db
  corpus: Corpus
  adapter: SourceAdapter
  llm: LlmClient
  opts: IndexOptions
}

export async function runIndex(args: RunIndexArgs): Promise<IndexResult> {
  const { db, corpus, adapter, llm, opts } = args
  const passes = opts.passes ?? DEFAULT_PASSES

  const completedRuns: RunRecord[] = []
  let totalCost = 0

  // Apply adapter schema extensions if any
  if (adapter.schemaExtensions) {
    const migrations = adapter.schemaExtensions()
    // Access the underlying bun:sqlite Database via Drizzle's $client
    const sqlite = (db as unknown as { $client: { exec: (sql: string) => void; query: <R, P extends unknown[]>(sql: string) => { all: (...args: P) => R[]; run: (...args: P) => void } } }).$client
    if (sqlite) {
      let appliedMigrations: Set<string>
      try {
        const rows = sqlite.query<{ name: string }, []>('SELECT name FROM _migrations').all()
        appliedMigrations = new Set(rows.map((r) => r.name))
      } catch {
        appliedMigrations = new Set()
      }
      for (const migration of migrations) {
        if (!appliedMigrations.has(migration.name)) {
          try {
            sqlite.exec(migration.sql)
            sqlite.query<never, [string, string]>(
              'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)',
            ).run(migration.name, new Date().toISOString())
          } catch (err) {
            console.warn(`[callimachus] adapter migration '${migration.name}' failed: ${String(err)}`)
          }
        }
      }
    }
  }

  // Mark corpus as indexing
  db.update(corpora)
    .set({ status: 'indexing' })
    .where(eq(corpora.id, corpus.id))
    .run()

  try {
    for (const pass of passes) {
      const run = startRun(db, { corpus_id: corpus.id, pass })

      let stats: PassStats
      let passStatus: 'completed' | 'failed' | 'skipped' = 'completed'

      try {
        stats = await runPass(pass, { db, corpus, adapter, llm, opts })

        // A skipped signal (-1) means the adapter doesn't support this pass
        if (stats.skipped === -1) {
          stats = { processed: 0, skipped: 0, failed: 0, errors: [] }
          passStatus = 'skipped'
        } else if (stats.failed > 0 && stats.processed === 0) {
          passStatus = 'failed'
        }
      } catch (err) {
        stats = {
          processed: 0,
          skipped: 0,
          failed: 1,
          errors: [{ chunk_id: 'N/A', message: err instanceof Error ? err.message : String(err) }],
        }
        passStatus = 'failed'
      }

      if ('cost_usd' in stats && stats.cost_usd) {
        totalCost += stats.cost_usd
      }

      finishRun(db, run.id, passStatus, stats)
      completedRuns.push({
        ...run,
        finished_at: new Date().toISOString(),
        status: passStatus,
        stats,
      })

      if (passStatus === 'failed') {
        db.update(corpora)
          .set({ status: 'error' })
          .where(eq(corpora.id, corpus.id))
          .run()

        return {
          runs: completedRuns,
          total_chunks: countRows(db, 'chunks', corpus.id),
          total_entities: countRows(db, 'entities', corpus.id),
          cost_usd: totalCost,
        }
      }
    }
  } catch (err) {
    db.update(corpora)
      .set({ status: 'error' })
      .where(eq(corpora.id, corpus.id))
      .run()
    throw err
  }

  // Success
  db.update(corpora)
    .set({
      status: 'ready',
      last_indexed_at: new Date().toISOString(),
    })
    .where(eq(corpora.id, corpus.id))
    .run()

  // Add LLM cost if the client tracks it
  if ('getUsage' in llm && typeof (llm as { getUsage?: () => { cost_usd: number } }).getUsage === 'function') {
    totalCost = (llm as { getUsage: () => { cost_usd: number } }).getUsage().cost_usd
  }

  return {
    runs: completedRuns,
    total_chunks: countRows(db, 'chunks', corpus.id),
    total_entities: countRows(db, 'entities', corpus.id),
    cost_usd: totalCost,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runPass(
  pass: PassName,
  args: Omit<RunIndexArgs, 'opts'> & { opts: IndexOptions },
): Promise<PassStats> {
  switch (pass) {
    case 'chunk':
      return runChunkPass(args)
    case 'extract_structure':
      return runStructurePass(args)
    case 'extract_semantic':
      return runSemanticPass(args)
    case 'summarize':
      return runSummarizePass(args)
  }
}

function countRows(db: Db, table: 'chunks' | 'entities', corpus_id: string): number {
  if (table === 'chunks') {
    return (
      db
        .select({ count: sql<number>`count(*)` })
        .from(chunks)
        .where(eq(chunks.corpus_id, corpus_id))
        .get()?.count ?? 0
    )
  }
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(entities)
      .where(eq(entities.corpus_id, corpus_id))
      .get()?.count ?? 0
  )
}
