import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../storage/db'
import { corpora, chunks, entities, runs } from '../storage/schema'
import type { AdapterRegistry } from '../adapter/registry'
import type { Corpus } from '../types/corpus'

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const AddInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  kind: z.string().min(1),
  source: z.string().min(1, 'source must be a non-empty string'),
  config: z.record(z.string(), z.unknown()).optional(),
})

type AddInput = z.infer<typeof AddInputSchema>

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface Run {
  id: string
  corpus_id: string
  pass: number
  started_at: string
  finished_at: string | null
  status: string
  stats: Record<string, unknown>
}

export interface CorpusStatus {
  corpus: Corpus
  chunk_count: number
  entity_count: number
  last_run: Run | null
}

// ---------------------------------------------------------------------------
// CorpusRegistry
// ---------------------------------------------------------------------------

/**
 * Service layer for managing corpora.
 * Constructed with a Drizzle DB and an AdapterRegistry.
 */
export class CorpusRegistry {
  constructor(
    private readonly db: Db,
    private readonly adapters: AdapterRegistry,
  ) {}

  /**
   * Register a new corpus.
   *
   * Validates that:
   * - `source` is a non-empty string (filesystem existence check is the adapter's job)
   * - `id` is unique
   *
   * Accepts any non-empty `kind` string — adapters may not be loaded yet during
   * the skeleton phase. Logs a warning when the kind is not registered.
   */
  async add(input: AddInput): Promise<Corpus> {
    const parsed = AddInputSchema.parse(input)

    const id = parsed.id ?? slugify(parsed.name)

    // Warn if the adapter isn't registered yet
    if (!this.adapters.get(parsed.kind)) {
      console.warn(
        `[callimachus] No adapter registered for kind '${parsed.kind}'. ` +
          `The corpus will be stored but cannot be indexed until an adapter is loaded.`,
      )
    }

    const now = new Date().toISOString()
    const row = {
      id,
      name: parsed.name,
      kind: parsed.kind,
      source: parsed.source,
      config: JSON.stringify(parsed.config ?? {}),
      created_at: now,
      last_indexed_at: null,
      status: 'registered' as const,
    }

    try {
      this.db.insert(corpora).values(row).run()
    } catch (err: unknown) {
      if (isUniqueConstraintError(err)) {
        throw new Error(`Corpus with id '${id}' already exists`)
      }
      throw err
    }

    return rowToCorpus(row)
  }

  async list(): Promise<Corpus[]> {
    const rows = this.db.select().from(corpora).orderBy(corpora.created_at).all()
    return rows.map(rowToCorpus)
  }

  async get(id: string): Promise<Corpus | null> {
    const row = this.db.select().from(corpora).where(eq(corpora.id, id)).get()
    return row ? rowToCorpus(row) : null
  }

  async status(id: string): Promise<CorpusStatus | null> {
    const corpus = await this.get(id)
    if (!corpus) return null

    const chunkCountRow = this.db
      .select({ count: sql<number>`count(*)` })
      .from(chunks)
      .where(eq(chunks.corpus_id, id))
      .get()

    const entityCountRow = this.db
      .select({ count: sql<number>`count(*)` })
      .from(entities)
      .where(eq(entities.corpus_id, id))
      .get()

    const lastRunRow = this.db
      .select()
      .from(runs)
      .where(eq(runs.corpus_id, id))
      .orderBy(sql`started_at DESC`)
      .limit(1)
      .get()

    const last_run: Run | null = lastRunRow
      ? {
          id: lastRunRow.id,
          corpus_id: lastRunRow.corpus_id,
          pass: lastRunRow.pass,
          started_at: lastRunRow.started_at,
          finished_at: lastRunRow.finished_at ?? null,
          status: lastRunRow.status,
          stats: parseJson(lastRunRow.stats),
        }
      : null

    return {
      corpus,
      chunk_count: chunkCountRow?.count ?? 0,
      entity_count: entityCountRow?.count ?? 0,
      last_run,
    }
  }

  /**
   * Remove a corpus and its associated data.
   * `keep_source` is accepted but is a no-op in the skeleton — Callimachus
   * does not own the source files.
   */
  async remove(id: string, opts?: { keep_source?: boolean }): Promise<void> {
    // Cascade-delete associated rows
    this.db.delete(chunks).where(eq(chunks.corpus_id, id)).run()
    this.db.delete(entities).where(eq(entities.corpus_id, id)).run()
    this.db.delete(runs).where(eq(runs.corpus_id, id)).run()
    this.db.delete(corpora).where(eq(corpora.id, id)).run()
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

type CorpusRow = {
  id: string
  name: string
  kind: string
  source: string
  config: string
  created_at: string
  last_indexed_at: string | null
  status: string
}

function rowToCorpus(row: CorpusRow): Corpus {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    source: row.source,
    config: parseJson(row.config),
    created_at: new Date(row.created_at),
    last_indexed_at: row.last_indexed_at ? new Date(row.last_indexed_at) : null,
    status: row.status as Corpus['status'],
  }
}

function parseJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes('UNIQUE constraint failed')
  }
  return false
}
