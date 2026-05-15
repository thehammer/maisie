import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { runMigrations } from '../../storage/migrator'
import * as schema from '../../storage/schema'
import { AdapterRegistry } from '../../adapter/registry'
import { CorpusRegistry } from '../../registry/corpus-registry'
import { QueryService } from '../../tools/query-service'
import { seedDb, CORPUS_ID, ENTITY_IDS, CHUNK_IDS, chunkUri } from './_fixtures'
import { parseLocation } from '../../types/location'
import type { Db } from '../../storage/db'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeDb(): Db {
  const sqlite = new Database(':memory:')
  runMigrations(sqlite)
  return drizzle(sqlite, { schema })
}

function makeService(db: Db): QueryService {
  const adapters = new AdapterRegistry()
  const registry = new CorpusRegistry(db, adapters)
  const fixedClock = () => new Date('2025-01-15T12:00:00.000Z')
  return new QueryService({ db, registry, adapters, clock: fixedClock })
}

// Assert that a result is a Success and return its data
function assertSuccess<T>(result: unknown): { data: T; scope_applied: unknown; generated_at: string } {
  const r = result as { ok: boolean; data: T; scope_applied: unknown; generated_at: string }
  expect(r.ok).toBe(true)
  return r
}

// ---------------------------------------------------------------------------
// corpus_list
// ---------------------------------------------------------------------------

describe('QueryService.corpus_list', () => {
  it('returns the seeded corpus in a Success result', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.corpus_list({})
    const { data } = assertSuccess<unknown[]>(result)
    expect(Array.isArray(data)).toBe(true)
    expect((data as Array<{ id: string }>).some((c) => c.id === CORPUS_ID)).toBe(true)
  })

  it('includes live chunk_count and entity_count on each entry', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.corpus_list({})
    const { data } = assertSuccess<Array<{ id: string; chunk_count: number; entity_count: number }>>(result)
    const entry = data.find((c) => c.id === CORPUS_ID)
    expect(entry).toBeDefined()
    expect(entry!.chunk_count).toBeGreaterThan(0)
    expect(entry!.entity_count).toBeGreaterThan(0)
  })

  it('returns a Success with ok:true, empty scope_applied, and ISO generated_at', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.corpus_list({}) as { ok: boolean; scope_applied: unknown; generated_at: string }
    expect(result.ok).toBe(true)
    expect(result.scope_applied).toBeDefined()
    // generated_at should be a valid ISO 8601 string
    expect(() => new Date(result.generated_at).toISOString()).not.toThrow()
  })

  it('returns an empty array (not NotFound) when no corpora exist', async () => {
    const db = makeDb()
    const svc = makeService(db)

    const result = await svc.corpus_list({}) as { ok: boolean; data: unknown[] }
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// corpus_overview
// ---------------------------------------------------------------------------

describe('QueryService.corpus_overview', () => {
  it('returns Success with title, kind, top_entities, and top_level_summary', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.corpus_overview({ corpus_id: CORPUS_ID })
    const { data } = assertSuccess<{
      title: string
      kind: string
      top_entities: Array<{ id: string }>
      top_level_summary: string | null
      structure_summary: string | null
    }>(result)

    expect(data.title).toBe('Eisenhorn')
    expect(data.kind).toBe('book')
    expect(Array.isArray(data.top_entities)).toBe(true)
    expect(data.top_entities.length).toBeLessThanOrEqual(10)
    expect(typeof data.top_level_summary).toBe('string')
  })

  it('top_level_summary contains the seeded corpus summary text', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.corpus_overview({ corpus_id: CORPUS_ID })
    const { data } = assertSuccess<{ top_level_summary: string | null }>(result)
    expect(data.top_level_summary).toContain('Eisenhorn')
  })

  it('returns structure_summary as null when no structure-depth summary exists', async () => {
    const db = makeDb()
    // Do not seed — empty DB
    const svc = makeService(db)

    // Register a corpus but no summaries
    const adapters = new AdapterRegistry()
    const registry = new CorpusRegistry(db, adapters)
    await registry.add({ id: 'empty-book', kind: 'book', name: 'Empty', source: '/books/empty.epub' })

    // Update corpus status to ready
    db.update(schema.corpora)
      .set({ status: 'ready' })
      .where(schema.corpora.id === 'empty-book' as unknown as Parameters<typeof db.update>[0])

    const result = await svc.corpus_overview({ corpus_id: 'empty-book' })
    const { data } = assertSuccess<{ structure_summary: string | null }>(result)
    expect(data.structure_summary).toBeNull()
  })

  it('returns ErrorResult with code corpus_not_found for an unknown corpus_id', async () => {
    const db = makeDb()
    const svc = makeService(db)

    const result = await svc.corpus_overview({ corpus_id: 'no-such-corpus' }) as { ok: boolean; kind: string; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('corpus_not_found')
  })

  it('returns ErrorResult with code invalid_input when corpus_id is missing', async () => {
    const db = makeDb()
    const svc = makeService(db)

    const result = await svc.corpus_overview({} as { corpus_id: string }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_input')
  })
})

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe('QueryService.search', () => {
  it('returns matching chunks for a structural search on entity name', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.search({ corpus_id: CORPUS_ID, query: 'Eisenhorn', mode: 'structural' })
    const { data } = assertSuccess<{ results: Array<{ location: unknown; snippet: string; relevance: number }>; total: number; returned: number }>(result)
    expect(data.results.length).toBeGreaterThan(0)
    expect(data.results.some((r) => r.snippet.toLowerCase().includes('eisenhorn'))).toBe(true)
  })

  it('returns results with location, snippet, and relevance for hybrid search', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.search({ corpus_id: CORPUS_ID, query: 'Bequin', mode: 'hybrid' })
    const { data } = assertSuccess<{ results: Array<{ location: { uri: string }; snippet: string; relevance: number }> }>(result)
    expect(data.results.length).toBeGreaterThan(0)
    const first = data.results[0]
    expect(typeof first.location.uri).toBe('string')
    expect(first.location.uri).toMatch(/^calli:\/\//)
    expect(typeof first.snippet).toBe('string')
    expect(typeof first.relevance).toBe('number')
  })

  it('returned count does not exceed limit', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const limit = 2
    const result = await svc.search({ corpus_id: CORPUS_ID, query: 'Eisenhorn', limit })
    const { data } = assertSuccess<{ results: unknown[]; total: number; returned: number }>(result)
    expect(data.returned).toBeLessThanOrEqual(limit)
    expect(data.results.length).toBeLessThanOrEqual(limit)
    expect(data.total).toBeGreaterThanOrEqual(data.returned)
  })

  it('returns ErrorResult with code corpus_not_found for unknown corpus', async () => {
    const db = makeDb()
    const svc = makeService(db)

    const result = await svc.search({ corpus_id: 'ghost', query: 'test' }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('corpus_not_found')
  })

  it('returns ErrorResult with code invalid_input when query is missing', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.search({ corpus_id: CORPUS_ID } as { corpus_id: string; query: string }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_input')
  })
})

// ---------------------------------------------------------------------------
// entity
// ---------------------------------------------------------------------------

describe('QueryService.entity', () => {
  it('resolves an entity by id', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.entity({ corpus_id: CORPUS_ID, name_or_id: ENTITY_IDS.eisenhorn })
    const { data } = assertSuccess<{ id: string; canonical_name: string }>(result)
    expect(data.id).toBe(ENTITY_IDS.eisenhorn)
    expect(data.canonical_name).toBe('Eisenhorn')
  })

  it('resolves an entity by canonical name', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.entity({ corpus_id: CORPUS_ID, name_or_id: 'Bequin' })
    const { data } = assertSuccess<{ id: string }>(result)
    expect(data.id).toBe(ENTITY_IDS.bequin)
  })

  it('resolves an entity by alias when no canonical match exists', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    // 'Glaw' is seeded as a canonical entity, so this test verifies alias lookup
    // for 'Pontius Glaw' which has alias 'Glaw' — only meaningful if no entity
    // is named exactly 'Pontius' or similar ambiguous alias.
    // Test: lookup 'Gregor' which is an alias for Eisenhorn (no canonical named 'Gregor')
    const result = await svc.entity({ corpus_id: CORPUS_ID, name_or_id: 'Gregor' })
    const { data } = assertSuccess<{ id: string }>(result)
    expect(data.id).toBe(ENTITY_IDS.eisenhorn)
  })

  it('returns NotFound with suggestions when entity does not exist', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.entity({ corpus_id: CORPUS_ID, name_or_id: 'Heldane' }) as { ok: boolean; kind: string; suggestions?: string[] }
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('not_found')
    expect(Array.isArray(result.suggestions)).toBe(true)
    expect((result.suggestions ?? []).length).toBeLessThanOrEqual(5)
  })
})

// ---------------------------------------------------------------------------
// entity_edges
// ---------------------------------------------------------------------------

describe('QueryService.entity_edges', () => {
  it('returns outbound edges from Eisenhorn', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.entity_edges({
      corpus_id: CORPUS_ID,
      entity_id: ENTITY_IDS.eisenhorn,
      direction: 'outbound',
    })
    const { data } = assertSuccess<{ edges: Array<{ from_entity_id: string }>; total: number; returned: number }>(result)
    expect(data.edges.length).toBeGreaterThan(0)
    expect(data.edges.every((e) => e.from_entity_id === ENTITY_IDS.eisenhorn)).toBe(true)
  })

  it('returns inbound edges to Eisenhorn', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.entity_edges({
      corpus_id: CORPUS_ID,
      entity_id: ENTITY_IDS.eisenhorn,
      direction: 'inbound',
    })
    const { data } = assertSuccess<{ edges: Array<{ to_entity_id: string }>; total: number; returned: number }>(result)
    expect(data.edges.length).toBeGreaterThan(0)
    expect(data.edges.every((e) => e.to_entity_id === ENTITY_IDS.eisenhorn)).toBe(true)
  })

  it('returns a union of inbound and outbound edges for direction:both', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const outboundResult = await svc.entity_edges({ corpus_id: CORPUS_ID, entity_id: ENTITY_IDS.eisenhorn, direction: 'outbound' })
    const inboundResult = await svc.entity_edges({ corpus_id: CORPUS_ID, entity_id: ENTITY_IDS.eisenhorn, direction: 'inbound' })
    const bothResult = await svc.entity_edges({ corpus_id: CORPUS_ID, entity_id: ENTITY_IDS.eisenhorn, direction: 'both' })

    const { data: outData } = assertSuccess<{ total: number }>(outboundResult)
    const { data: inData } = assertSuccess<{ total: number }>(inboundResult)
    const { data: bothData } = assertSuccess<{ total: number }>(bothResult)

    expect(bothData.total).toBeGreaterThanOrEqual(Math.max(outData.total, inData.total))
  })

  it('filters edges by kind when kind is provided', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.entity_edges({
      corpus_id: CORPUS_ID,
      entity_id: ENTITY_IDS.eisenhorn,
      direction: 'outbound',
      kind: 'knows',
    })
    const { data } = assertSuccess<{ edges: Array<{ kind: string }> }>(result)
    expect(data.edges.every((e) => e.kind === 'knows')).toBe(true)
  })

  it('total and returned are consistent', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.entity_edges({
      corpus_id: CORPUS_ID,
      entity_id: ENTITY_IDS.eisenhorn,
      direction: 'both',
    })
    const { data } = assertSuccess<{ edges: unknown[]; total: number; returned: number }>(result)
    expect(data.returned).toBe(data.edges.length)
    expect(data.total).toBeGreaterThanOrEqual(data.returned)
  })

  it('returns NotFound for an unknown entity', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.entity_edges({ corpus_id: CORPUS_ID, entity_id: 'no-such-entity', direction: 'outbound' }) as { ok: boolean; kind: string }
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('not_found')
  })
})

// ---------------------------------------------------------------------------
// entity_meet
// ---------------------------------------------------------------------------

describe('QueryService.entity_meet', () => {
  it('returns first co-occurrence location for Eisenhorn and Bequin', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.entity_meet({
      corpus_id: CORPUS_ID,
      entity_a: ENTITY_IDS.eisenhorn,
      entity_b: ENTITY_IDS.bequin,
    })
    const { data } = assertSuccess<{
      first_co_occurrence: { uri: string }
      count: number
    }>(result)

    expect(data.count).toBeGreaterThanOrEqual(1)
    expect(typeof data.first_co_occurrence.uri).toBe('string')
    // First co-occurrence should be at ch/1/sc/1 (both edges seed that location)
    expect(data.first_co_occurrence.uri).toBe(chunkUri('ch/1/sc/1'))
  })

  it('first_co_occurrence.uri round-trips through parseLocation/formatLocation', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.entity_meet({
      corpus_id: CORPUS_ID,
      entity_a: ENTITY_IDS.eisenhorn,
      entity_b: ENTITY_IDS.bequin,
    })
    const { data } = assertSuccess<{ first_co_occurrence: { uri: string } }>(result)

    const parsed = parseLocation(data.first_co_occurrence.uri)
    expect(parsed.corpus_id).toBe(CORPUS_ID)
    expect(parsed.uri).toBe(data.first_co_occurrence.uri)
  })

  it('returns NotFound when two entities have no co-occurrence', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    // Bequin and Pontius Glaw share no seeded edge locations
    const result = await svc.entity_meet({
      corpus_id: CORPUS_ID,
      entity_a: ENTITY_IDS.bequin,
      entity_b: ENTITY_IDS['pontius-glaw'],
    }) as { ok: boolean; kind: string }
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('not_found')
  })
})

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

describe('QueryService.read', () => {
  it('returns summary text (no content) for depth:summary', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.read({ location: chunkUri('ch/1/sc/1'), depth: 'summary' })
    const { data } = assertSuccess<{ summary: string | null; content: string | undefined }>(result)
    expect(typeof data.summary).toBe('string')
    expect(data.content).toBeUndefined()
  })

  it('returns raw content for depth:full', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.read({ location: chunkUri('ch/1/sc/1'), depth: 'full' })
    const { data } = assertSuccess<{ content: string }>(result)
    expect(typeof data.content).toBe('string')
    expect(data.content.length).toBeGreaterThan(0)
    // Should be byte-for-byte what was seeded
    expect(data.content).toContain('Gregor Eisenhorn')
  })

  it('returns child_locations for depth:scenes', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.read({ location: chunkUri('ch/1'), depth: 'scenes' })
    const { data } = assertSuccess<{ child_locations: Array<{ uri: string }> }>(result)
    expect(Array.isArray(data.child_locations)).toBe(true)
    expect(data.child_locations.length).toBeGreaterThan(0)
    // All child URIs should be under ch/1
    expect(data.child_locations.every((loc) => loc.uri.includes('ch/1'))).toBe(true)
  })

  it('entities_present includes entities whose edges are at that location', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.read({ location: chunkUri('ch/1/sc/1'), depth: 'summary' })
    const { data } = assertSuccess<{ entities_present: Array<{ id: string }> }>(result)
    expect(Array.isArray(data.entities_present)).toBe(true)
    // Both Eisenhorn and Bequin have edges at ch/1/sc/1
    const ids = data.entities_present.map((e) => e.id)
    expect(ids).toContain(ENTITY_IDS.eisenhorn)
    expect(ids).toContain(ENTITY_IDS.bequin)
  })

  it('returns NotFound for an unknown location URI', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.read({ location: 'calli://eisenhorn/ch/99/sc/99', depth: 'full' }) as { ok: boolean; kind: string }
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('not_found')
  })
})

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

describe('QueryService.summarize', () => {
  it('returns the seeded corpus-level summary text', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.summarize({ corpus_id: CORPUS_ID, target: { kind: 'corpus' } })
    const { data } = assertSuccess<{ text: string }>(result)
    expect(typeof data.text).toBe('string')
    expect(data.text).toContain('Eisenhorn')
  })

  it('returns summary text for a specific location', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.summarize({
      corpus_id: CORPUS_ID,
      target: { kind: 'location', location: chunkUri('ch/1/sc/1') },
    })
    const { data } = assertSuccess<{ text: string }>(result)
    expect(typeof data.text).toBe('string')
    expect(data.text.length).toBeGreaterThan(0)
  })

  it('returns NotFound with suggestion to run "calli index" when no summary exists', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.summarize({
      corpus_id: CORPUS_ID,
      target: { kind: 'location', location: chunkUri('ch/2/sc/3') },
    }) as { ok: boolean; kind: string; suggestions?: string[] }
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('not_found')
    const suggestions = result.suggestions ?? []
    expect(suggestions.some((s) => s.toLowerCase().includes('calli'))).toBe(true)
  })

  it('returns ErrorResult with code invalid_input when corpus_id is missing', async () => {
    const db = makeDb()
    const svc = makeService(db)

    const result = await svc.summarize({ target: { kind: 'corpus' } } as { corpus_id: string; target: { kind: 'corpus' } }) as { ok: boolean; code: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_input')
  })
})

// ---------------------------------------------------------------------------
// related
// ---------------------------------------------------------------------------

describe('QueryService.related', () => {
  it('returns related locations for a location that has entities with edges', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.related({ corpus_id: CORPUS_ID, location: chunkUri('ch/1/sc/1') })
    const { data } = assertSuccess<{ related: Array<{ location: { uri: string }; relationship: string; score: number }> }>(result)
    expect(Array.isArray(data.related)).toBe(true)
    expect(data.related.length).toBeGreaterThan(0)
    // Each entry has the required shape
    const first = data.related[0]
    expect(typeof first.location.uri).toBe('string')
    expect(typeof first.relationship).toBe('string')
    expect(typeof first.score).toBe('number')
  })

  it('respects the limit parameter', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.related({ corpus_id: CORPUS_ID, location: chunkUri('ch/1/sc/1'), limit: 1 })
    const { data } = assertSuccess<{ related: unknown[] }>(result)
    expect(data.related.length).toBeLessThanOrEqual(1)
  })

  it('returns an empty related array (not an error) for a location with no entity connections', async () => {
    const db = makeDb()
    const svc = makeService(db)

    // Register a corpus with one chunk but no edges
    const adapters = new AdapterRegistry()
    const registry = new CorpusRegistry(db, adapters)
    await registry.add({ id: 'empty-book', kind: 'book', name: 'Empty', source: '/books/empty.epub' })
    db.insert(schema.chunks).values({
      id: 'lone-chunk',
      corpus_id: 'empty-book',
      parent_path: null,
      kind: 'scene',
      location_uri: 'calli://empty-book/ch/1',
      content: 'A lone scene.',
      byte_length: 13,
      created_at: new Date().toISOString(),
    }).run()

    const result = await svc.related({ corpus_id: 'empty-book', location: 'calli://empty-book/ch/1' })
    const { data } = assertSuccess<{ related: unknown[] }>(result)
    expect(data.related).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Cross-cutting: result shape and no-throw guarantee
// ---------------------------------------------------------------------------

describe('QueryService — result shape contract', () => {
  it('all methods return ToolResult (never throw) on unexpected input', async () => {
    const db = makeDb()
    const svc = makeService(db)

    // None of these should throw; all should return ok:false results
    const calls = [
      svc.corpus_overview({ corpus_id: 'x' }),
      svc.search({ corpus_id: 'x', query: 'y' }),
      svc.entity({ corpus_id: 'x', name_or_id: 'y' }),
      svc.entity_edges({ corpus_id: 'x', entity_id: 'y', direction: 'outbound' }),
      svc.entity_meet({ corpus_id: 'x', entity_a: 'a', entity_b: 'b' }),
      svc.read({ location: 'calli://x/y', depth: 'full' }),
      svc.summarize({ corpus_id: 'x', target: { kind: 'corpus' } }),
      svc.related({ corpus_id: 'x', location: 'calli://x/y' }),
    ]

    const results = await Promise.all(calls)
    for (const result of results) {
      expect(result).toHaveProperty('ok')
    }
  })

  it('generated_at on Success results is a valid ISO 8601 string', async () => {
    const db = makeDb()
    seedDb(db)
    const svc = makeService(db)

    const result = await svc.corpus_list({}) as { ok: boolean; generated_at: string }
    expect(result.ok).toBe(true)
    const d = new Date(result.generated_at)
    expect(isNaN(d.getTime())).toBe(false)
    expect(result.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
