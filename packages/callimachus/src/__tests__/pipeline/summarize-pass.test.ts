import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { eq } from 'drizzle-orm'
import { runMigrations } from '../../storage/migrator'
import * as schema from '../../storage/schema'
import { summaries as summariesTable } from '../../storage/schema'
import { runSummarizePass } from '../../pipeline/passes/summarize-pass'
import { upsertChunk } from '../../pipeline/chunk-store'
import { DryRunLlmClient } from '../../pipeline/llm/dry-run-client'
import type { SourceAdapter, DiscoveredSource, ExtractedStructure, LlmClient } from '../../adapter/contract'
import type { Chunk } from '../../types/chunk'
import { hashChunk } from '../../types/chunk'
import type { Summary } from '../../types/summary'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const sqlite = new Database(':memory:')
  runMigrations(sqlite)
  return drizzle(sqlite, { schema })
}

const CORPUS_ID = 'sum-test'

function makeChunk(text: string, path: string, kind = 'scene'): Chunk {
  return {
    id: hashChunk(text),
    corpus_id: CORPUS_ID,
    parent_path: null,
    kind,
    location: { corpus_id: CORPUS_ID, path, uri: `calli://${CORPUS_ID}/${path}` },
    content: text,
    byte_length: Buffer.byteLength(text),
    created_at: new Date(),
  }
}

function makeCorpus() {
  return { id: CORPUS_ID, name: 'Test', kind: 'fake', source: '/src', config: {}, created_at: new Date(), last_indexed_at: null, status: 'registered' as const }
}

function makeSummarizingAdapter(): SourceAdapter {
  return {
    kind: 'fake',
    version: '0.0.1',
    async discover(): Promise<DiscoveredSource[]> { return [] },
    async *chunk(): AsyncIterable<Chunk> { },
    async extractStructure(): Promise<ExtractedStructure> {
      return { parent_path: null, children: [], metadata: {} }
    },
    async summarize(chunk: Chunk, _llm: LlmClient, depth: string): Promise<Summary> {
      return {
        id: '', // replaced by upsertSummary
        corpus_id: CORPUS_ID,
        target_kind: 'chunk',
        target_id: chunk.id,
        depth,
        text: `Summary of ${chunk.content.slice(0, 20)}`,
        model: null,
        generated_at: new Date(),
      }
    },
    formatLocation(chunk: Chunk) { return chunk.location.uri },
    parseLocation(uri: string) {
      const rest = uri.slice('calli://'.length)
      const slash = rest.indexOf('/')
      return { corpus_id: rest.slice(0, slash), path: rest.slice(slash + 1) }
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runSummarizePass — happy path', () => {
  it('produces one summary per chunk', async () => {
    const db = makeDb()
    const chunk1 = makeChunk('Scene one text here', 'ch/1/sc/1')
    const chunk2 = makeChunk('Scene two text here', 'ch/1/sc/2')
    upsertChunk(db, chunk1)
    upsertChunk(db, chunk2)

    const stats = await runSummarizePass({
      db,
      corpus: makeCorpus(),
      adapter: makeSummarizingAdapter(),
      llm: new DryRunLlmClient(),
      opts: { corpusId: CORPUS_ID },
    })

    expect(stats.processed).toBe(2)
    expect(stats.skipped).toBe(0)
    expect(stats.failed).toBe(0)

    const stored = db.select().from(summariesTable).where(eq(summariesTable.corpus_id, CORPUS_ID)).all()
    expect(stored).toHaveLength(2)
  })
})

describe('runSummarizePass — idempotency', () => {
  it('is a no-op on second run (summaries already exist)', async () => {
    const db = makeDb()
    const chunk = makeChunk('Chapter one content here', 'ch/1')
    upsertChunk(db, chunk)

    const corpus = makeCorpus()
    const opts = { corpusId: CORPUS_ID }
    const adapter = makeSummarizingAdapter()
    const llm = new DryRunLlmClient()

    // First run
    const stats1 = await runSummarizePass({ db, corpus, adapter, llm, opts })
    expect(stats1.processed).toBe(1)

    // Second run
    const stats2 = await runSummarizePass({ db, corpus, adapter, llm, opts })
    expect(stats2.processed).toBe(0)
    expect(stats2.skipped).toBe(1)

    // Still only one summary
    const stored = db.select().from(summariesTable).where(eq(summariesTable.corpus_id, CORPUS_ID)).all()
    expect(stored).toHaveLength(1)
  })
})

describe('runSummarizePass — adapter without summarize', () => {
  it('returns skipped=-1 when adapter does not support summarize', async () => {
    const db = makeDb()
    const adapter: SourceAdapter = {
      kind: 'simple',
      version: '0.0.1',
      async discover(): Promise<DiscoveredSource[]> { return [] },
      async *chunk(): AsyncIterable<Chunk> { },
      async extractStructure(): Promise<ExtractedStructure> {
        return { parent_path: null, children: [], metadata: {} }
      },
      formatLocation(chunk: Chunk) { return chunk.location.uri },
      parseLocation(uri: string) {
        const rest = uri.slice('calli://'.length)
        const slash = rest.indexOf('/')
        return { corpus_id: rest.slice(0, slash), path: rest.slice(slash + 1) }
      },
    }

    const stats = await runSummarizePass({
      db,
      corpus: makeCorpus(),
      adapter,
      llm: new DryRunLlmClient(),
      opts: { corpusId: CORPUS_ID },
    })

    expect(stats.skipped).toBe(-1)
  })
})
