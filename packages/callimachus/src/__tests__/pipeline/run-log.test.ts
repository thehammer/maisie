import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { runMigrations } from '../../storage/migrator'
import * as schema from '../../storage/schema'
import { startRun, finishRun, latestRunsByPass } from '../../pipeline/run-log'
import type { PassStats } from '../../pipeline/types'

function makeDb() {
  const sqlite = new Database(':memory:')
  runMigrations(sqlite)
  return drizzle(sqlite, { schema })
}

const EMPTY_STATS: PassStats = { processed: 0, skipped: 0, failed: 0, errors: [] }

describe('startRun', () => {
  it('inserts a run with status=running and returns a RunRecord', () => {
    const db = makeDb()
    const run = startRun(db, { corpus_id: 'test', pass: 'chunk' })

    expect(run.id).toBeTruthy()
    expect(run.corpus_id).toBe('test')
    expect(run.pass).toBe('chunk')
    expect(run.status).toBe('running')
    expect(run.finished_at).toBeNull()
  })

  it('each call generates a unique run id', () => {
    const db = makeDb()
    const r1 = startRun(db, { corpus_id: 'test', pass: 'chunk' })
    const r2 = startRun(db, { corpus_id: 'test', pass: 'chunk' })
    expect(r1.id).not.toBe(r2.id)
  })
})

describe('finishRun', () => {
  it('transitions running → completed', () => {
    const db = makeDb()
    const run = startRun(db, { corpus_id: 'test', pass: 'chunk' })
    finishRun(db, run.id, 'completed', { ...EMPTY_STATS, processed: 5 })

    // Verify via latestRunsByPass
    const latest = latestRunsByPass(db, 'test')
    const record = latest['chunk']
    expect(record).not.toBeNull()
    expect(record?.status).toBe('completed')
    expect(record?.stats.processed).toBe(5)
    expect(record?.finished_at).not.toBeNull()
  })

  it('transitions running → failed and preserves error count in stats', () => {
    const db = makeDb()
    const run = startRun(db, { corpus_id: 'test', pass: 'extract_semantic' })
    const stats: PassStats = {
      processed: 1,
      skipped: 0,
      failed: 2,
      errors: [
        { chunk_id: 'abc', message: 'boom' },
        { chunk_id: 'def', message: 'zap' },
      ],
    }
    finishRun(db, run.id, 'failed', stats)

    const latest = latestRunsByPass(db, 'test')
    const record = latest['extract_semantic']
    expect(record?.status).toBe('failed')
    expect(record?.stats.errors).toHaveLength(2)
  })
})

describe('latestRunsByPass', () => {
  it('returns null for each pass when no runs exist', () => {
    const db = makeDb()
    const result = latestRunsByPass(db, 'no-such-corpus')

    expect(result.chunk).toBeNull()
    expect(result.extract_structure).toBeNull()
    expect(result.extract_semantic).toBeNull()
    expect(result.summarize).toBeNull()
  })

  it('returns the most recent run for each pass', () => {
    const db = makeDb()

    const r1 = startRun(db, { corpus_id: 'c1', pass: 'chunk' })
    finishRun(db, r1.id, 'completed', { ...EMPTY_STATS, processed: 3 })

    const r2 = startRun(db, { corpus_id: 'c1', pass: 'chunk' })
    finishRun(db, r2.id, 'completed', { ...EMPTY_STATS, processed: 7 })

    const latest = latestRunsByPass(db, 'c1')
    // Should return the most recent (r2)
    expect(latest.chunk?.stats.processed).toBe(7)
  })

  it('isolates results by corpus_id', () => {
    const db = makeDb()
    const r = startRun(db, { corpus_id: 'corpus-a', pass: 'chunk' })
    finishRun(db, r.id, 'completed', EMPTY_STATS)

    const result = latestRunsByPass(db, 'corpus-b')
    expect(result.chunk).toBeNull()
  })
})
