import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { runMigrations } from '../../storage/migrator'
import * as schema from '../../storage/schema'
import { runChunkPass } from '../../pipeline/passes/chunk-pass'
import { listChunksForCorpus } from '../../pipeline/chunk-store'
import type { SourceAdapter, DiscoveredSource } from '../../adapter/contract'
import type { Chunk } from '../../types/chunk'
import { hashChunk } from '../../types/chunk'
import type { ExtractedStructure, ExtractedSemantic, EntityMerge } from '../../adapter/contract'
import type { Summary } from '../../types/summary'

// ---------------------------------------------------------------------------
// Minimal fake adapter for chunk-pass tests
// ---------------------------------------------------------------------------

function makeChunk(corpusId: string, text: string, path: string): Chunk {
  const content = text
  return {
    id: hashChunk(content),
    corpus_id: corpusId,
    parent_path: null,
    kind: 'scene',
    location: { corpus_id: corpusId, path, uri: `calli://${corpusId}/${path}` },
    content,
    byte_length: Buffer.byteLength(content),
    created_at: new Date(),
  }
}

function makeFakeAdapter(
  corpusId: string,
  chunkTexts: string[],
): SourceAdapter {
  return {
    kind: 'fake',
    version: '0.0.1',
    async discover(source: string): Promise<DiscoveredSource[]> {
      return [{ corpus_id: corpusId, path: source, uri: `file://${source}`, kind: 'fake' }]
    },
    async *chunk(source: DiscoveredSource): AsyncIterable<Chunk> {
      for (let i = 0; i < chunkTexts.length; i++) {
        yield makeChunk(corpusId, chunkTexts[i], `ch/${i}`)
      }
    },
    async extractStructure(chunk: Chunk): Promise<ExtractedStructure> {
      return { parent_path: null, children: [], metadata: {} }
    },
    formatLocation(chunk: Chunk): string {
      return chunk.location.uri
    },
    parseLocation(uri: string): { corpus_id: string; path: string } {
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

const CORPUS_ID = 'test-corpus'
const CHUNK_TEXTS = ['Chapter one content', 'Chapter two content', 'Chapter three content']

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runChunkPass — happy path', () => {
  it('inserts all chunks on a fresh run', async () => {
    const db = makeDb()
    const adapter = makeFakeAdapter(CORPUS_ID, CHUNK_TEXTS)

    const stats = await runChunkPass({
      db,
      corpus: { id: CORPUS_ID, name: 'Test', kind: 'fake', source: '/src', config: {}, created_at: new Date(), last_indexed_at: null, status: 'registered' },
      adapter,
      opts: { corpusId: CORPUS_ID },
    })

    expect(stats.processed).toBe(3)
    expect(stats.skipped).toBe(0)
    expect(stats.failed).toBe(0)

    const stored = listChunksForCorpus(db, CORPUS_ID)
    expect(stored).toHaveLength(3)
  })
})

describe('runChunkPass — resume (idempotency)', () => {
  it('skips already-indexed chunks on second run', async () => {
    const db = makeDb()
    const adapter = makeFakeAdapter(CORPUS_ID, CHUNK_TEXTS)
    const corpus = { id: CORPUS_ID, name: 'Test', kind: 'fake', source: '/src', config: {}, created_at: new Date(), last_indexed_at: null, status: 'registered' as const }

    // First run
    await runChunkPass({ db, corpus, adapter, opts: { corpusId: CORPUS_ID } })

    // Second run
    const stats2 = await runChunkPass({ db, corpus, adapter, opts: { corpusId: CORPUS_ID } })

    expect(stats2.processed).toBe(0)
    expect(stats2.skipped).toBe(3)
    const stored = listChunksForCorpus(db, CORPUS_ID)
    expect(stored).toHaveLength(3) // still 3, no duplicates
  })
})

describe('runChunkPass — fromChunk', () => {
  it('skips chunks before the given fromChunk id', async () => {
    const db = makeDb()
    const adapter = makeFakeAdapter(CORPUS_ID, CHUNK_TEXTS)
    const corpus = { id: CORPUS_ID, name: 'Test', kind: 'fake', source: '/src', config: {}, created_at: new Date(), last_indexed_at: null, status: 'registered' as const }

    // Build the id of the second chunk
    const secondChunkId = hashChunk(CHUNK_TEXTS[1])

    const stats = await runChunkPass({
      db,
      corpus,
      adapter,
      opts: { corpusId: CORPUS_ID, fromChunk: secondChunkId },
    })

    // First chunk was skipped (before fromChunk), second and third processed
    expect(stats.skipped).toBe(1)
    expect(stats.processed).toBe(2)

    const stored = listChunksForCorpus(db, CORPUS_ID)
    expect(stored).toHaveLength(2)
  })
})

describe('runChunkPass — dry-run', () => {
  it('counts chunks without inserting any rows', async () => {
    const db = makeDb()
    const adapter = makeFakeAdapter(CORPUS_ID, CHUNK_TEXTS)
    const corpus = { id: CORPUS_ID, name: 'Test', kind: 'fake', source: '/src', config: {}, created_at: new Date(), last_indexed_at: null, status: 'registered' as const }

    const stats = await runChunkPass({
      db,
      corpus,
      adapter,
      opts: { corpusId: CORPUS_ID, dryRun: true },
    })

    expect(stats.processed).toBe(3)
    const stored = listChunksForCorpus(db, CORPUS_ID)
    expect(stored).toHaveLength(0) // nothing written
  })
})
