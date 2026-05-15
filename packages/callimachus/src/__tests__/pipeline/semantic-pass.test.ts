import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { runMigrations } from '../../storage/migrator'
import * as schema from '../../storage/schema'
import { runSemanticPass } from '../../pipeline/passes/semantic-pass'
import { upsertChunk } from '../../pipeline/chunk-store'
import { listEntitiesForCorpus } from '../../pipeline/entity-store'
import { DryRunLlmClient } from '../../pipeline/llm/dry-run-client'
import type { SourceAdapter, DiscoveredSource, ExtractedStructure, ExtractedSemantic, EntityMerge, LlmClient } from '../../adapter/contract'
import type { Chunk } from '../../types/chunk'
import { hashChunk } from '../../types/chunk'
import type { Summary } from '../../types/summary'
import type { Entity } from '../../types/entity'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const sqlite = new Database(':memory:')
  runMigrations(sqlite)
  return drizzle(sqlite, { schema })
}

const CORPUS_ID = 'sem-test'

function makeChunk(text: string, path = 'ch/1'): Chunk {
  return {
    id: hashChunk(text),
    corpus_id: CORPUS_ID,
    parent_path: null,
    kind: 'scene',
    location: { corpus_id: CORPUS_ID, path, uri: `calli://${CORPUS_ID}/${path}` },
    content: text,
    byte_length: Buffer.byteLength(text),
    created_at: new Date(),
  }
}

function makeCorpus() {
  return { id: CORPUS_ID, name: 'Test', kind: 'fake', source: '/src', config: {}, created_at: new Date(), last_indexed_at: null, status: 'registered' as const }
}

// Fake LLM that returns a specific entity list
function makeFakeLlm(entities: Partial<Entity>[], summaryText?: string): LlmClient {
  return {
    async complete(_prompt: string): Promise<string> {
      return JSON.stringify({ entities, summary_text: summaryText ?? null })
    },
  }
}

// Adapter with extractWithLlm
function makeSemanticAdapter(
  llmResult: (chunk: Chunk, llm: LlmClient) => Promise<ExtractedSemantic>,
  resolveAliases?: (entities: Entity[]) => Promise<EntityMerge[]>,
): SourceAdapter {
  return {
    kind: 'fake',
    version: '0.0.1',
    async discover(): Promise<DiscoveredSource[]> { return [] },
    async *chunk(): AsyncIterable<Chunk> { },
    async extractStructure(): Promise<ExtractedStructure> {
      return { parent_path: null, children: [], metadata: {} }
    },
    async extractWithLlm(chunk: Chunk, llm: LlmClient): Promise<ExtractedSemantic> {
      return llmResult(chunk, llm)
    },
    resolveAliases,
    formatLocation(chunk: Chunk): string { return chunk.location.uri },
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

describe('runSemanticPass — happy path', () => {
  it('upserts entities returned by extractWithLlm', async () => {
    const db = makeDb()
    const chunk = makeChunk('Ada Lovelace was a mathematician.')
    upsertChunk(db, chunk)

    const adapter = makeSemanticAdapter(async (_chunk, _llm) => ({
      entities: [
        { canonical_name: 'Ada Lovelace', kind: 'character', aliases: ['Ada'], confidence: 0.9 },
      ],
      summary_text: null,
    }))

    await runSemanticPass({
      db,
      corpus: makeCorpus(),
      adapter,
      llm: new DryRunLlmClient(),
      opts: { corpusId: CORPUS_ID },
    })

    const entities = listEntitiesForCorpus(db, CORPUS_ID)
    expect(entities).toHaveLength(1)
    expect(entities[0].canonical_name).toBe('Ada Lovelace')
    expect(entities[0].aliases).toContain('Ada')
  })
})

describe('runSemanticPass — merged aliases', () => {
  it('merges aliases when the same entity appears in multiple chunks', async () => {
    const db = makeDb()
    const chunk1 = makeChunk('Ada Lovelace wrote code.', 'ch/1')
    const chunk2 = makeChunk('Lady Ada worked with Babbage.', 'ch/2')
    upsertChunk(db, chunk1)
    upsertChunk(db, chunk2)

    let callCount = 0
    const adapter = makeSemanticAdapter(async (chunk, _llm) => {
      callCount++
      if (callCount === 1) {
        return {
          entities: [{ canonical_name: 'Ada Lovelace', kind: 'character', aliases: ['Ada'], confidence: 0.9 }],
          summary_text: null,
        }
      }
      return {
        entities: [{ canonical_name: 'Ada Lovelace', kind: 'character', aliases: ['Lady Ada'], confidence: 0.8 }],
        summary_text: null,
      }
    })

    await runSemanticPass({
      db,
      corpus: makeCorpus(),
      adapter,
      llm: new DryRunLlmClient(),
      opts: { corpusId: CORPUS_ID },
    })

    const entities = listEntitiesForCorpus(db, CORPUS_ID)
    expect(entities).toHaveLength(1)
    expect(entities[0].aliases).toContain('Ada')
    expect(entities[0].aliases).toContain('Lady Ada')
    expect(entities[0].appearance_count).toBe(2)
  })
})

describe('runSemanticPass — malformed LLM response', () => {
  it('records parse failure as chunk-scoped error without aborting the run', async () => {
    const db = makeDb()
    const chunk = makeChunk('Some content')
    upsertChunk(db, chunk)

    const adapter = makeSemanticAdapter(async (_chunk, _llm) => {
      throw new Error('LLM returned garbage JSON')
    })

    const stats = await runSemanticPass({
      db,
      corpus: makeCorpus(),
      adapter,
      llm: new DryRunLlmClient(),
      opts: { corpusId: CORPUS_ID },
    })

    expect(stats.failed).toBe(1)
    expect(stats.errors).toHaveLength(1)
    expect(stats.errors[0].message).toContain('garbage JSON')
    // No entities inserted
    expect(listEntitiesForCorpus(db, CORPUS_ID)).toHaveLength(0)
  })
})

describe('runSemanticPass — resolveAliases', () => {
  it('applies merges returned by resolveAliases after extraction', async () => {
    const db = makeDb()
    const chunk1 = makeChunk('Alan Turing solved the problem.', 'ch/1')
    const chunk2 = makeChunk('Turing was brilliant.', 'ch/2')
    upsertChunk(db, chunk1)
    upsertChunk(db, chunk2)

    let callCount = 0
    const adapter = makeSemanticAdapter(
      async (_chunk, _llm) => {
        callCount++
        const name = callCount === 1 ? 'Alan Turing' : 'Turing'
        return {
          entities: [{ canonical_name: name, kind: 'character', aliases: [], confidence: 0.9 }],
          summary_text: null,
        }
      },
      async (entities: Entity[]) => {
        const turingId = entities.find((e) => e.canonical_name === 'Alan Turing')?.id
        const aliasId = entities.find((e) => e.canonical_name === 'Turing')?.id
        if (turingId && aliasId) {
          return [{
            canonical: 'Alan Turing',
            aliases: ['Turing'],
            entity_ids: [turingId, aliasId],
          }]
        }
        return []
      },
    )

    await runSemanticPass({
      db,
      corpus: makeCorpus(),
      adapter,
      llm: new DryRunLlmClient(),
      opts: { corpusId: CORPUS_ID },
    })

    const entities = listEntitiesForCorpus(db, CORPUS_ID)
    expect(entities).toHaveLength(1)
    expect(entities[0].canonical_name).toBe('Alan Turing')
    expect(entities[0].aliases).toContain('Turing')
  })
})

describe('runSemanticPass — adapter without extractWithLlm', () => {
  it('returns skipped=-1 signal when adapter does not support LLM extraction', async () => {
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

    const stats = await runSemanticPass({
      db,
      corpus: makeCorpus(),
      adapter,
      llm: new DryRunLlmClient(),
      opts: { corpusId: CORPUS_ID },
    })

    expect(stats.skipped).toBe(-1) // not-applicable signal
  })
})
