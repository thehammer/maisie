import type { Db } from '../storage/db'
import { summaries } from '../storage/schema'
import type { Summary } from '../types/summary'
import { eq, and } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function hashId(...parts: string[]): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(parts.join('|'))
  return hasher.digest('hex')
}

export function summaryId(
  corpus_id: string,
  target_kind: string,
  target_id: string,
  depth: string,
): string {
  return hashId(corpus_id, target_kind, target_id, depth)
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Upsert a summary. id = sha256(corpus_id|target_kind|target_id|depth).
 * INSERT OR REPLACE so re-summarisation overwrites the prior summary.
 */
export function upsertSummary(db: Db, summary: Summary): void {
  const id = summaryId(summary.corpus_id, summary.target_kind, summary.target_id, summary.depth)
  db.insert(summaries)
    .values({
      id,
      corpus_id: summary.corpus_id,
      target_kind: summary.target_kind,
      target_id: summary.target_id,
      depth: summary.depth,
      text: summary.text,
      model: summary.model ?? null,
      generated_at: summary.generated_at.toISOString(),
    })
    .onConflictDoUpdate({
      target: summaries.id,
      set: {
        text: summary.text,
        model: summary.model ?? null,
        generated_at: summary.generated_at.toISOString(),
      },
    })
    .run()
}

/**
 * Check if a summary already exists for the given coordinates.
 */
export function hasSummary(
  db: Db,
  corpus_id: string,
  target_kind: string,
  target_id: string,
  depth: string,
): boolean {
  const id = summaryId(corpus_id, target_kind, target_id, depth)
  const row = db.select({ id: summaries.id }).from(summaries).where(eq(summaries.id, id)).get()
  return row !== undefined
}
