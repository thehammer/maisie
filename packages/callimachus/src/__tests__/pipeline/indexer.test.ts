import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { eq, sql } from 'drizzle-orm'
import { runMigrations } from '../../storage/migrator'
import * as schema from '../../storage/schema'
import { chunks as chunksTable, entities as entitiesTable, summaries as summariesTable, corpora as corporaTable } from '../../storage/schema'
import { runIndex } from '../../pipeline/indexer'
import { DryRunLlmClient } from '../../pipeline/llm/dry-run-client'
import type { SourceAdapter, DiscoveredSource, ExtractedStructure, ExtractedSemantic, LlmClient } from '../../adapter/contract'
import type { Chunk } from '../../types/chunk'
import { hashChunk } from '../../types/chunk'
import type { Summary } from '../../types/summary'
import type { Corpus } from '../../types/corpus'

// ---------------------------------------------------------------------------
// Fake adapter: 2 chapters, 4 scenes (2 scenes per chapter)
// ---------------------------------------------------------------------------

const CORPUS_ID = 'test-book'
const CHAPTERS = 2
const SCENES_PER_CHAPTER = 2

function makeChunk(corpusId: string, text: string, kind: string, parentPath: string | null, path: string): Chunk {
  return {
    id: hashChunk(text),
    corpus_id: corpusId,
    parent_path: parentPath,
    kind,
    location: { corpus_id: corpusId, path, uri: `calli://${corpusId}/${path}` },
    content: text,
    byte_length: Buffer.byteLength(text),
    created_at: new Date(),
  }
}

function buildAllChunks(corpusId: string): Chunk[] {
  const result: Chunk[] = []
  for (let c = 1; c <= CHAPTERS; c++) {
    result.push(makeChunk(corpusId, `Chapter ${c} content`, 'chapter', null, `ch/${c}`))
    for (let s = 1; s <= SCENES_PER_CHAPTER; s++) {
      result.push(makeChunk(corpusId, `Chapter ${c} Scene ${s} content`, 'scene', `ch/${c}`, `ch/${c}/sc/${s}`))
    }
  }
  return result
}

function makeFullAdapter(corpusId: string): SourceAdapter {
  const allChunks = buildAllChunks(corpusId)
  return {
    kind: 'fake',
    version: '0.0.1',
    async discover(source: string): Promise<DiscoveredSource[]> {
      return [{ corpus_id: corpusId, path: source, uri: `file://${source}`, kind: 'fake' }]
    },
    async *chunk(_source: DiscoveredSource): AsyncIterable<Chunk> {
      for (const c of allChunks) yield c
    },
    async extractStructure(chunk: Chunk): Promise<ExtractedStructure> {
      return { parent_path: chunk.parent_path, children: [], metadata: {} }
    },
    async extractWithLlm(_chunk: Chunk, _llm: LlmClient): Promise<ExtractedSemantic> {
      return {
        entities: [{ canonical_name: 'Hero', kind: 'character', aliases: [], confidence: 0.8 }],
        summary_text: 'A brief scene.',
      }
    },
    async summarize(chunk: Chunk, _llm: LlmClient, depth: string): Promise<Summary> {
      return {
        id: '',
        corpus_id: corpusId,
        target_kind: 'chunk',
        target_id: chunk.id,
        depth,
        text: `Summary of ${chunk.kind}`,
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

function makeDb() {
  const sqlite = new Database(':memory:')
  runMigrations(sqlite)
  return drizzle(sqlite, { schema })
}

function makeCorpus(): Corpus {
  return {
    id: CORPUS_ID,
    name: 'Test Book',
    kind: 'fake',
    source: '/books/test.epub',
    config: {},
    created_at: new Date(),
    last_indexed_at: null,
    status: 'registered',
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runIndex — end-to-end with DryRunLlmClient', () => {
  it('indexes all chunks and inserts entities and summaries', async () => {
    const db = makeDb()
    // Seed the corpus row (required for status update)
    db.insert(corporaTable).values({
      id: CORPUS_ID,
      name: 'Test Book',
      kind: 'fake',
      source: '/books/test.epub',
      config: '{}',
      created_at: new Date().toISOString(),
      last_indexed_at: null,
      status: 'registered',
    }).run()

    const result = await runIndex({
      db,
      corpus: makeCorpus(),
      adapter: makeFullAdapter(CORPUS_ID),
      llm: new DryRunLlmClient(),
      opts: { corpusId: CORPUS_ID },
    })

    // 2 chapters + 4 scenes = 6 chunks
    expect(result.total_chunks).toBe(6)
    expect(result.total_entities).toBeGreaterThan(0)
  })

  it('transitions corpora.status registered → indexing → ready', async () => {
    const db = makeDb()
    db.insert(corporaTable).values({
      id: CORPUS_ID,
      name: 'Test Book',
      kind: 'fake',
      source: '/books/test.epub',
      config: '{}',
      created_at: new Date().toISOString(),
      last_indexed_at: null,
      status: 'registered',
    }).run()

    await runIndex({
      db,
      corpus: makeCorpus(),
      adapter: makeFullAdapter(CORPUS_ID),
      llm: new DryRunLlmClient(),
      opts: { corpusId: CORPUS_ID },
    })

    const row = db.select().from(corporaTable).where(eq(corporaTable.id, CORPUS_ID)).get()
    expect(row?.status).toBe('ready')
    expect(row?.last_indexed_at).not.toBeNull()
  })

  it('records one run row per pass', async () => {
    const db = makeDb()
    db.insert(corporaTable).values({
      id: CORPUS_ID,
      name: 'Test Book',
      kind: 'fake',
      source: '/books/test.epub',
      config: '{}',
      created_at: new Date().toISOString(),
      last_indexed_at: null,
      status: 'registered',
    }).run()

    const result = await runIndex({
      db,
      corpus: makeCorpus(),
      adapter: makeFullAdapter(CORPUS_ID),
      llm: new DryRunLlmClient(),
      opts: { corpusId: CORPUS_ID },
    })

    // 4 passes total (chunk, extract_structure, extract_semantic, summarize)
    expect(result.runs).toHaveLength(4)
    const statuses = result.runs.map((r) => r.status)
    // All should be completed or skipped (never failed)
    expect(statuses.every((s) => s === 'completed' || s === 'skipped')).toBe(true)
  })

  it('second invocation is a complete no-op (resume)', async () => {
    const db = makeDb()
    db.insert(corporaTable).values({
      id: CORPUS_ID,
      name: 'Test Book',
      kind: 'fake',
      source: '/books/test.epub',
      config: '{}',
      created_at: new Date().toISOString(),
      last_indexed_at: null,
      status: 'registered',
    }).run()

    const adapter = makeFullAdapter(CORPUS_ID)
    const llm = new DryRunLlmClient()
    const corpus = makeCorpus()
    const opts = { corpusId: CORPUS_ID }

    // First run
    const r1 = await runIndex({ db, corpus, adapter, llm, opts })

    // Second run — should process 0 new chunks
    const r2 = await runIndex({ db, corpus, adapter, llm, opts })

    const chunkRunOnSecond = r2.runs.find((r) => r.pass === 'chunk')
    expect(chunkRunOnSecond?.stats.processed).toBe(0)
    expect(chunkRunOnSecond?.stats.skipped).toBe(6)
  })

  it('opts.passes=["chunk"] produces no entities or summaries', async () => {
    const db = makeDb()
    db.insert(corporaTable).values({
      id: CORPUS_ID,
      name: 'Test Book',
      kind: 'fake',
      source: '/books/test.epub',
      config: '{}',
      created_at: new Date().toISOString(),
      last_indexed_at: null,
      status: 'registered',
    }).run()

    await runIndex({
      db,
      corpus: makeCorpus(),
      adapter: makeFullAdapter(CORPUS_ID),
      llm: new DryRunLlmClient(),
      opts: { corpusId: CORPUS_ID, passes: ['chunk'] },
    })

    const entityCount = db
      .select({ count: sql<number>`count(*)` })
      .from(entitiesTable)
      .where(eq(entitiesTable.corpus_id, CORPUS_ID))
      .get()?.count ?? 0

    const summaryCount = db
      .select({ count: sql<number>`count(*)` })
      .from(summariesTable)
      .where(eq(summariesTable.corpus_id, CORPUS_ID))
      .get()?.count ?? 0

    expect(entityCount).toBe(0)
    expect(summaryCount).toBe(0)
  })
})
