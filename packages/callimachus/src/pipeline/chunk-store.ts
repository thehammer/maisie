import { eq, gt, sql } from 'drizzle-orm'
import type { Db } from '../storage/db'
import { chunks } from '../storage/schema'
import type { Chunk } from '../types/chunk'
import { parseLocation } from '../types/location'

// ---------------------------------------------------------------------------
// Row ↔ Chunk conversion
// ---------------------------------------------------------------------------

type ChunkRow = {
  id: string
  corpus_id: string
  parent_path: string | null
  kind: string
  location_uri: string
  content: string
  byte_length: number
  created_at: string
}

function rowToChunk(row: ChunkRow): Chunk {
  const location = parseLocation(row.location_uri)
  return {
    id: row.id,
    corpus_id: row.corpus_id,
    parent_path: row.parent_path ?? null,
    kind: row.kind,
    location,
    content: row.content,
    byte_length: row.byte_length,
    created_at: new Date(row.created_at),
  }
}

function chunkToRow(chunk: Chunk): ChunkRow {
  return {
    id: chunk.id,
    corpus_id: chunk.corpus_id,
    parent_path: chunk.parent_path ?? null,
    kind: chunk.kind,
    location_uri: chunk.location.uri,
    content: chunk.content,
    byte_length: chunk.byte_length,
    created_at: chunk.created_at.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Returns true if a chunk with this id already exists. */
export function hasChunk(db: Db, chunk_id: string): boolean {
  const row = db
    .select({ id: chunks.id })
    .from(chunks)
    .where(eq(chunks.id, chunk_id))
    .get()
  return row !== undefined
}

/**
 * Insert a chunk if it does not already exist (content-addressed — id is the
 * sha256 of content so an INSERT OR IGNORE is safe and idempotent).
 */
export function upsertChunk(db: Db, chunk: Chunk): void {
  db.insert(chunks).values(chunkToRow(chunk)).onConflictDoNothing().run()
}

/**
 * List all chunks for a corpus, in insert order.
 * Optionally paginate with afterId + limit.
 */
export function listChunksForCorpus(
  db: Db,
  corpus_id: string,
  opts?: { afterId?: string; limit?: number },
): Chunk[] {
  let query = db.select().from(chunks).where(eq(chunks.corpus_id, corpus_id))

  if (opts?.afterId) {
    // Lexicographic cursor via rowid — use a subquery to get the rowid of afterId
    // and then filter by rowid > that value. Since IDs are sha256 hex strings,
    // we use SQL rowid for ordering consistency.
    const cursorRow = db
      .select({ rowid: sql<number>`rowid` })
      .from(chunks)
      .where(eq(chunks.id, opts.afterId))
      .get()
    if (cursorRow) {
      query = db
        .select()
        .from(chunks)
        .where(
          sql`corpus_id = ${corpus_id} AND rowid > ${cursorRow.rowid}`,
        ) as typeof query
    }
  }

  if (opts?.limit) {
    return (query.limit(opts.limit).all() as ChunkRow[]).map(rowToChunk)
  }

  return (query.all() as ChunkRow[]).map(rowToChunk)
}

/** Get a single chunk by id. */
export function getChunk(db: Db, chunk_id: string): Chunk | null {
  const row = db.select().from(chunks).where(eq(chunks.id, chunk_id)).get() as
    | ChunkRow
    | undefined
  return row ? rowToChunk(row) : null
}

/** Update the parent_path of an existing chunk. */
export function updateChunkParentPath(
  db: Db,
  chunk_id: string,
  parent_path: string | null,
): void {
  db.update(chunks).set({ parent_path }).where(eq(chunks.id, chunk_id)).run()
}
