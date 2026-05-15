import { eq, and } from 'drizzle-orm'
import type { Db } from '../storage/db'
import { runs } from '../storage/schema'
import type { PassName, PassStats, RunRecord } from './types'

function emptyStats(): PassStats {
  return { processed: 0, skipped: 0, failed: 0, errors: [] }
}

function rowToRecord(row: {
  id: string
  corpus_id: string
  pass: string
  started_at: string
  finished_at: string | null
  status: string
  stats: string
}): RunRecord {
  let stats: PassStats
  try {
    stats = JSON.parse(row.stats) as PassStats
  } catch {
    stats = emptyStats()
  }
  return {
    id: row.id,
    corpus_id: row.corpus_id,
    pass: row.pass as PassName,
    started_at: row.started_at,
    finished_at: row.finished_at ?? null,
    status: row.status as RunRecord['status'],
    stats,
  }
}

/** Open a new run row with status='running'. Returns the RunRecord. */
export function startRun(
  db: Db,
  opts: { corpus_id: string; pass: PassName },
): RunRecord {
  const id = crypto.randomUUID()
  const started_at = new Date().toISOString()
  db.insert(runs)
    .values({
      id,
      corpus_id: opts.corpus_id,
      pass: opts.pass,
      started_at,
      status: 'running',
      stats: JSON.stringify(emptyStats()),
    })
    .run()
  return {
    id,
    corpus_id: opts.corpus_id,
    pass: opts.pass,
    started_at,
    finished_at: null,
    status: 'running',
    stats: emptyStats(),
  }
}

/** Close a run row with the given status and stats. */
export function finishRun(
  db: Db,
  runId: string,
  status: 'completed' | 'failed' | 'skipped',
  stats: PassStats,
): void {
  db.update(runs)
    .set({
      finished_at: new Date().toISOString(),
      status,
      stats: JSON.stringify(stats),
    })
    .where(eq(runs.id, runId))
    .run()
}

/** Return the most recent run for each pass for a corpus, or null if none. */
export function latestRunsByPass(
  db: Db,
  corpus_id: string,
): Record<PassName, RunRecord | null> {
  const allPasses: PassName[] = ['chunk', 'extract_structure', 'extract_semantic', 'summarize']
  const result = {} as Record<PassName, RunRecord | null>

  for (const pass of allPasses) {
    const row = db
      .select()
      .from(runs)
      .where(and(eq(runs.corpus_id, corpus_id), eq(runs.pass, pass)))
      .orderBy(runs.started_at)
      .all()
      .at(-1)
    result[pass] = row ? rowToRecord(row) : null
  }

  return result
}
