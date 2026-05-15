import { eq, sql, and, or, like, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../storage/db'
import { corpora, chunks, entities, edges, summaries } from '../storage/schema'
import type { CorpusRegistry } from '../registry/corpus-registry'
import type { AdapterRegistry } from '../adapter/registry'
import { parseLocation, formatLocation } from '../types/location'
import type { Location } from '../types/location'
import type { Entity } from '../types/entity'
import type { Edge } from '../types/edge'
import type { ToolResult } from '../types/result'
import type { Scope } from '../types/scope'
import { matchScope } from './scope-filter'
import { extractSnippet } from './snippet'
import {
  CorpusListInputSchema,
  CorpusOverviewInputSchema,
  SearchInputSchema,
  EntityInputSchema,
  EntityEdgesInputSchema,
  EntityMeetInputSchema,
  ReadInputSchema,
  SummarizeInputSchema,
  RelatedInputSchema,
  type CorpusListOutput,
  type CorpusOverviewOutput,
  type SearchOutput,
  type EntityEdgesOutput,
  type EntityMeetOutput,
  type ReadOutput,
  type SummarizeOutput,
  type RelatedOutput,
} from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueryServiceOptions {
  db: Db
  registry: CorpusRegistry
  adapters: AdapterRegistry
  clock?: () => Date
}

// ---------------------------------------------------------------------------
// QueryService
// ---------------------------------------------------------------------------

export class QueryService {
  private readonly db: Db
  private readonly registry: CorpusRegistry
  private readonly clock: () => Date

  constructor({ db, registry, clock }: QueryServiceOptions) {
    this.db = db
    this.registry = registry
    this.clock = clock ?? (() => new Date())
  }

  // -------------------------------------------------------------------------
  // corpus_list
  // -------------------------------------------------------------------------

  async corpus_list(_input: unknown): Promise<ToolResult<CorpusListOutput>> {
    const parseResult = CorpusListInputSchema.safeParse(_input ?? {})
    if (!parseResult.success) {
      return errorResult('invalid_input', parseResult.error.issues[0]?.message ?? 'Invalid input')
    }

    const rows = this.db.select().from(corpora).all()

    const data: CorpusListOutput = rows.map((row) => {
      const chunkCount = this.db
        .select({ count: sql<number>`count(*)` })
        .from(chunks)
        .where(eq(chunks.corpus_id, row.id))
        .get()
      const entityCount = this.db
        .select({ count: sql<number>`count(*)` })
        .from(entities)
        .where(eq(entities.corpus_id, row.id))
        .get()

      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        last_indexed: row.last_indexed_at ?? null,
        chunk_count: chunkCount?.count ?? 0,
        entity_count: entityCount?.count ?? 0,
      }
    })

    return successResult(data, {})
  }

  // -------------------------------------------------------------------------
  // corpus_overview
  // -------------------------------------------------------------------------

  async corpus_overview(input: unknown): Promise<ToolResult<CorpusOverviewOutput>> {
    const parseResult = CorpusOverviewInputSchema.safeParse(input)
    if (!parseResult.success) {
      return errorResult('invalid_input', parseResult.error.issues[0]?.message ?? 'Invalid input')
    }

    const { corpus_id } = parseResult.data
    const corpus = await this.registry.get(corpus_id)
    if (!corpus) {
      return notFoundCorpus(corpus_id)
    }

    const topEntities = this.db
      .select()
      .from(entities)
      .where(eq(entities.corpus_id, corpus_id))
      .orderBy(sql`${entities.appearance_count} DESC`)
      .limit(10)
      .all()

    const topLevelSummaryRow = this.db
      .select()
      .from(summaries)
      .where(
        and(
          eq(summaries.corpus_id, corpus_id),
          eq(summaries.target_kind, 'corpus'),
          eq(summaries.depth, 'corpus'),
        ),
      )
      .get()

    const structureSummaryRow = this.db
      .select()
      .from(summaries)
      .where(
        and(
          eq(summaries.corpus_id, corpus_id),
          eq(summaries.target_kind, 'corpus'),
          eq(summaries.depth, 'structure'),
        ),
      )
      .get()

    const data: CorpusOverviewOutput = {
      title: corpus.name,
      kind: corpus.kind,
      structure_summary: structureSummaryRow?.text ?? null,
      top_entities: topEntities.map(rowToEntity),
      top_level_summary: topLevelSummaryRow?.text ?? null,
      last_indexed: corpus.last_indexed_at?.toISOString() ?? null,
    }

    return successResult(data, {})
  }

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------

  async search(input: unknown): Promise<ToolResult<SearchOutput>> {
    const parseResult = SearchInputSchema.safeParse(input)
    if (!parseResult.success) {
      return errorResult('invalid_input', parseResult.error.issues[0]?.message ?? 'Invalid input')
    }

    const { corpus_id, query, mode, scope, limit } = parseResult.data

    const corpus = await this.registry.get(corpus_id)
    if (!corpus) return notFoundCorpus(corpus_id)

    let allRows: Array<{ id: string; location_uri: string; content: string; kind: string }> = []
    let relevanceMap = new Map<string, number>()

    if (mode === 'structural') {
      // LIKE search on entity names and chunk parent_path
      const queryLike = `%${query}%`

      const entityChunks = this.db
        .select({ id: chunks.id, location_uri: chunks.location_uri, content: chunks.content, kind: chunks.kind })
        .from(chunks)
        .innerJoin(entities, eq(entities.corpus_id, chunks.corpus_id))
        .where(
          and(
            eq(chunks.corpus_id, corpus_id),
            or(
              like(entities.canonical_name, queryLike),
              like(entities.aliases, queryLike),
              like(chunks.parent_path, queryLike),
            ),
          ),
        )
        .all()

      // Deduplicate
      const seen = new Set<string>()
      for (const row of entityChunks) {
        if (!seen.has(row.id)) {
          seen.add(row.id)
          allRows.push(row)
          relevanceMap.set(row.id, 0.5)
        }
      }
    } else {
      // hybrid / semantic: FTS5 if available, else LIKE on content
      const ftsAvailable = hasFts(this.db)

      if (ftsAvailable) {
        // FTS5 search
        try {
          const sqlite = getSqlite(this.db)
          const ftsRows = sqlite
            .query<{ id: string; location_uri: string; content: string; kind: string; score: number },
              [string, string]>(`
              SELECT c.id, c.location_uri, c.content, c.kind, bm25(chunks_fts) as score
              FROM chunks_fts
              INNER JOIN chunks c ON chunks_fts.rowid = c.rowid
              WHERE corpus_id = ? AND chunks_fts MATCH ?
              ORDER BY score
            `)
            .all(corpus_id, query)

          const minScore = Math.min(...ftsRows.map((r) => r.score), 0)
          const maxScore = Math.max(...ftsRows.map((r) => Math.abs(r.score)), 1)

          for (const row of ftsRows) {
            allRows.push({ id: row.id, location_uri: row.location_uri, content: row.content, kind: row.kind })
            // BM25 scores are negative; normalize to 0-1
            const normalized = Math.max(0, Math.min(1, (Math.abs(row.score) - Math.abs(minScore)) / maxScore))
            relevanceMap.set(row.id, normalized)
          }
        } catch {
          // FTS query failed — fall through to LIKE
          allRows = []
        }
      }

      if (allRows.length === 0) {
        // LIKE fallback
        const queryLike = `%${query}%`
        const likeRows = this.db
          .select({ id: chunks.id, location_uri: chunks.location_uri, content: chunks.content, kind: chunks.kind })
          .from(chunks)
          .where(and(eq(chunks.corpus_id, corpus_id), like(chunks.content, queryLike)))
          .all()

        for (const row of likeRows) {
          allRows.push(row)
          relevanceMap.set(row.id, 0.5)
        }
      }
    }

    // Apply scope filter
    const filtered = allRows.filter((row) => matchScope(row.location_uri, scope))

    const total = filtered.length
    const paginated = filtered.slice(0, limit)

    const results = paginated.map((row) => ({
      location: parseLocation(row.location_uri),
      snippet: extractSnippet(row.content, query, 200),
      relevance: relevanceMap.get(row.id) ?? 0.5,
      kind: row.kind,
    }))

    return successResult({ results, total, returned: results.length }, scope ?? {})
  }

  // -------------------------------------------------------------------------
  // entity
  // -------------------------------------------------------------------------

  async entity(input: unknown): Promise<ToolResult<Entity>> {
    const parseResult = EntityInputSchema.safeParse(input)
    if (!parseResult.success) {
      return errorResult('invalid_input', parseResult.error.issues[0]?.message ?? 'Invalid input')
    }

    const { corpus_id, name_or_id } = parseResult.data
    const corpus = await this.registry.get(corpus_id)
    if (!corpus) return notFoundCorpus(corpus_id)

    // Try by exact id
    let row = this.db
      .select()
      .from(entities)
      .where(and(eq(entities.corpus_id, corpus_id), eq(entities.id, name_or_id)))
      .get()

    // Try by canonical_name (case-insensitive)
    if (!row) {
      row = this.db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.corpus_id, corpus_id),
            sql`lower(${entities.canonical_name}) = lower(${name_or_id})`,
          ),
        )
        .get()
    }

    // Try by alias (JSON array search)
    if (!row) {
      const allRows = this.db
        .select()
        .from(entities)
        .where(eq(entities.corpus_id, corpus_id))
        .all()

      row = allRows.find((r) => {
        try {
          const aliases = JSON.parse(r.aliases) as string[]
          return aliases.some((a) => a.toLowerCase() === name_or_id.toLowerCase())
        } catch {
          return false
        }
      })
    }

    if (!row) {
      // Provide suggestions
      const suggestions = this.db
        .select({ canonical_name: entities.canonical_name })
        .from(entities)
        .where(eq(entities.corpus_id, corpus_id))
        .orderBy(sql`${entities.appearance_count} DESC`)
        .limit(5)
        .all()
        .map((r) => r.canonical_name)

      return { ok: false, kind: 'not_found', suggestions }
    }

    return successResult(rowToEntity(row), {})
  }

  // -------------------------------------------------------------------------
  // entity_edges
  // -------------------------------------------------------------------------

  async entity_edges(input: unknown): Promise<ToolResult<EntityEdgesOutput>> {
    const parseResult = EntityEdgesInputSchema.safeParse(input)
    if (!parseResult.success) {
      return errorResult('invalid_input', parseResult.error.issues[0]?.message ?? 'Invalid input')
    }

    const { corpus_id, entity_id, direction, kind: edgeKind, scope, limit } = parseResult.data
    const corpus = await this.registry.get(corpus_id)
    if (!corpus) return notFoundCorpus(corpus_id)

    // Verify entity exists
    const entityRow = this.db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.corpus_id, corpus_id), eq(entities.id, entity_id)))
      .get()
    if (!entityRow) {
      return { ok: false, kind: 'not_found', suggestions: [`Entity '${entity_id}' not found in corpus '${corpus_id}'`] }
    }

    const conditions = [eq(edges.corpus_id, corpus_id)]

    if (direction === 'outbound') {
      conditions.push(eq(edges.from_entity_id, entity_id))
    } else if (direction === 'inbound') {
      conditions.push(eq(edges.to_entity_id, entity_id))
    } else {
      // both
      conditions.push(
        or(eq(edges.from_entity_id, entity_id), eq(edges.to_entity_id, entity_id))!,
      )
    }

    if (edgeKind) {
      conditions.push(eq(edges.kind, edgeKind))
    }

    let allEdges = this.db
      .select()
      .from(edges)
      .where(and(...conditions))
      .all()

    // Apply scope
    if (scope) {
      allEdges = allEdges.filter((e) => matchScope(e.location_uri, scope))
    }

    const total = allEdges.length
    const paginated = allEdges.slice(0, limit)

    const result: EdgeResult[] = paginated.map((row) => ({
      id: row.id,
      corpus_id: row.corpus_id,
      from_entity_id: row.from_entity_id,
      to_entity_id: row.to_entity_id,
      kind: row.kind,
      location: parseLocation(row.location_uri),
      confidence: row.confidence,
    }))

    return successResult({ edges: result as Edge[], total, returned: result.length }, scope ?? {})
  }

  // -------------------------------------------------------------------------
  // entity_meet
  // -------------------------------------------------------------------------

  async entity_meet(input: unknown): Promise<ToolResult<EntityMeetOutput>> {
    const parseResult = EntityMeetInputSchema.safeParse(input)
    if (!parseResult.success) {
      return errorResult('invalid_input', parseResult.error.issues[0]?.message ?? 'Invalid input')
    }

    const { corpus_id, entity_a, entity_b, scope } = parseResult.data
    const corpus = await this.registry.get(corpus_id)
    if (!corpus) return notFoundCorpus(corpus_id)

    // Find all location_uris where BOTH entity_a and entity_b have edge rows
    const sqlite = getSqlite(this.db)
    const rows = sqlite
      .query<{ location_uri: string }, [string, string, string, string, string, string]>(`
        SELECT DISTINCT e1.location_uri
        FROM edges e1
        INNER JOIN edges e2 ON e1.location_uri = e2.location_uri
        WHERE e1.corpus_id = ? AND e1.from_entity_id = ? AND e2.from_entity_id = ?
        UNION
        SELECT DISTINCT e1.location_uri
        FROM edges e1
        INNER JOIN edges e2 ON e1.location_uri = e2.location_uri
        WHERE e1.corpus_id = ? AND e1.to_entity_id = ? AND e2.to_entity_id = ?
      `)
      .all(corpus_id, entity_a, entity_b, corpus_id, entity_a, entity_b)

    // Also check cross-direction
    const crossRows = sqlite
      .query<{ location_uri: string }, [string, string, string, string, string, string]>(`
        SELECT DISTINCT e1.location_uri
        FROM edges e1
        INNER JOIN edges e2 ON e1.location_uri = e2.location_uri
        WHERE e1.corpus_id = ? AND e1.from_entity_id = ? AND e2.to_entity_id = ?
        UNION
        SELECT DISTINCT e1.location_uri
        FROM edges e1
        INNER JOIN edges e2 ON e1.location_uri = e2.location_uri
        WHERE e1.corpus_id = ? AND e1.to_entity_id = ? AND e2.from_entity_id = ?
      `)
      .all(corpus_id, entity_a, entity_b, corpus_id, entity_a, entity_b)

    const allUris = Array.from(
      new Set([...rows.map((r) => r.location_uri), ...crossRows.map((r) => r.location_uri)]),
    ).sort()

    // Apply scope filter
    const filtered = scope ? allUris.filter((uri) => matchScope(uri, scope)) : allUris

    if (filtered.length === 0) {
      return { ok: false, kind: 'not_found', suggestions: [`${entity_a} and ${entity_b} never co-occur in corpus ${corpus_id}`] }
    }

    const locations: Location[] = filtered.map(parseLocation)

    return successResult(
      {
        first_co_occurrence: locations[0],
        all: locations,
        count: locations.length,
      },
      scope ?? {},
    )
  }

  // -------------------------------------------------------------------------
  // read
  // -------------------------------------------------------------------------

  async read(input: unknown): Promise<ToolResult<ReadOutput>> {
    const parseResult = ReadInputSchema.safeParse(input)
    if (!parseResult.success) {
      return errorResult('invalid_input', parseResult.error.issues[0]?.message ?? 'Invalid input')
    }

    const { corpus_id: explicitCorpusId, location: locationUri, depth } = parseResult.data

    // Parse the location URI to extract corpus_id if not explicitly provided
    let parsedLoc: Location
    try {
      parsedLoc = parseLocation(locationUri)
    } catch {
      return { ok: false, kind: 'not_found', suggestions: [`Invalid location URI: ${locationUri}`] }
    }

    // Use corpus_id from URI if not explicitly provided; validate consistency if both present
    const corpus_id = explicitCorpusId ?? parsedLoc.corpus_id
    if (explicitCorpusId && parsedLoc.corpus_id !== explicitCorpusId) {
      return errorResult('invalid_input', `Location URI corpus_id '${parsedLoc.corpus_id}' does not match corpus_id '${explicitCorpusId}'`)
    }

    const corpus = await this.registry.get(corpus_id)
    if (!corpus) return notFoundCorpus(corpus_id)

    const chunk = this.db
      .select()
      .from(chunks)
      .where(and(eq(chunks.corpus_id, corpus_id), eq(chunks.location_uri, locationUri)))
      .get()

    if (!chunk) {
      return { ok: false, kind: 'not_found', suggestions: [`No chunk found at location: ${locationUri}`] }
    }

    // entities_present: entities with edges at this location
    const edgeEntityIds = this.db
      .select({ from: edges.from_entity_id, to: edges.to_entity_id })
      .from(edges)
      .where(and(eq(edges.corpus_id, corpus_id), eq(edges.location_uri, locationUri)))
      .all()

    const entityIds = Array.from(
      new Set([...edgeEntityIds.map((e) => e.from), ...edgeEntityIds.map((e) => e.to)]),
    )

    const presentEntities =
      entityIds.length > 0
        ? this.db.select().from(entities).where(inArray(entities.id, entityIds)).all().map(rowToEntity)
        : []

    // child_locations: chunks whose parent_path starts with this chunk's path
    const chunkPath = parsedLoc.path
    const childRows = this.db
      .select()
      .from(chunks)
      .where(
        and(
          eq(chunks.corpus_id, corpus_id),
          sql`${chunks.parent_path} = ${chunkPath}`,
        ),
      )
      .all()

    const childLocations: Location[] = childRows.map((c) => parseLocation(c.location_uri))

    const output: ReadOutput = {
      location: parsedLoc,
      entities_present: presentEntities,
      child_locations: childLocations,
    }

    if (depth === 'summary' || depth === 'scenes') {
      // Load chunk summary
      const summaryRow = this.db
        .select()
        .from(summaries)
        .where(
          and(
            eq(summaries.corpus_id, corpus_id),
            eq(summaries.target_kind, 'chunk'),
            eq(summaries.target_id, chunk.id),
          ),
        )
        .get()

      if (summaryRow) {
        output.summary = summaryRow.text
      }
    }

    if (depth === 'full') {
      output.content = chunk.content

      // Include summary too if available
      const summaryRow = this.db
        .select()
        .from(summaries)
        .where(
          and(
            eq(summaries.corpus_id, corpus_id),
            eq(summaries.target_kind, 'chunk'),
            eq(summaries.target_id, chunk.id),
          ),
        )
        .get()

      if (summaryRow) {
        output.summary = summaryRow.text
      }
    }

    return successResult(output, {})
  }

  // -------------------------------------------------------------------------
  // summarize
  // -------------------------------------------------------------------------

  async summarize(input: unknown): Promise<ToolResult<SummarizeOutput>> {
    const parseResult = SummarizeInputSchema.safeParse(input)
    if (!parseResult.success) {
      return errorResult('invalid_input', parseResult.error.issues[0]?.message ?? 'Invalid input')
    }

    const { corpus_id, target, depth } = parseResult.data
    const corpus = await this.registry.get(corpus_id)
    if (!corpus) return notFoundCorpus(corpus_id)

    let targetKind: string
    let targetId: string

    switch (target.kind) {
      case 'corpus':
        targetKind = 'corpus'
        targetId = corpus_id
        break
      case 'entity':
        targetKind = 'entity'
        targetId = target.entity_id
        break
      case 'location': {
        // Resolve location_uri → chunk id
        const chunk = this.db
          .select({ id: chunks.id })
          .from(chunks)
          .where(
            and(eq(chunks.corpus_id, corpus_id), eq(chunks.location_uri, target.location)),
          )
          .get()
        if (!chunk) {
          return { ok: false, kind: 'not_found', suggestions: [`No chunk found at location: ${target.location}`, `Run \`calli index ${corpus_id} --pass=summarize\``] }
        }
        targetKind = 'chunk'
        targetId = chunk.id
        break
      }
      case 'range':
        targetKind = 'range'
        targetId = `${target.from}__${target.to}`
        break
    }

    const conditions = [
      eq(summaries.corpus_id, corpus_id),
      eq(summaries.target_kind, targetKind),
      eq(summaries.target_id, targetId),
    ]

    if (depth) {
      conditions.push(eq(summaries.depth, depth))
    }

    const row = this.db.select().from(summaries).where(and(...conditions)).get()

    if (!row) {
      return {
        ok: false,
        kind: 'not_found',
        suggestions: [`Run \`calli index ${corpus_id} --pass=summarize\``],
      }
    }

    return successResult(
      { text: row.text, level: row.depth, generated_at: row.generated_at },
      {},
    )
  }

  // -------------------------------------------------------------------------
  // related
  // -------------------------------------------------------------------------

  async related(input: unknown): Promise<ToolResult<RelatedOutput>> {
    const parseResult = RelatedInputSchema.safeParse(input)
    if (!parseResult.success) {
      return errorResult('invalid_input', parseResult.error.issues[0]?.message ?? 'Invalid input')
    }

    const { corpus_id, location: locationUri, kinds, limit } = parseResult.data
    const corpus = await this.registry.get(corpus_id)
    if (!corpus) return notFoundCorpus(corpus_id)

    // Get entities at this location via edges
    const edgeRows = this.db
      .select()
      .from(edges)
      .where(and(eq(edges.corpus_id, corpus_id), eq(edges.location_uri, locationUri)))
      .all()

    const entityIds = Array.from(
      new Set([...edgeRows.map((e) => e.from_entity_id), ...edgeRows.map((e) => e.to_entity_id)]),
    )

    if (entityIds.length === 0) {
      return successResult({ related: [] }, {})
    }

    // For each entity, get its outgoing edges to find related locations
    let relatedEdges = this.db
      .select()
      .from(edges)
      .where(
        and(
          eq(edges.corpus_id, corpus_id),
          inArray(edges.from_entity_id, entityIds),
        ),
      )
      .all()

    // Exclude the query location itself
    relatedEdges = relatedEdges.filter((e) => e.location_uri !== locationUri)

    // Apply kinds filter
    if (kinds && kinds.length > 0) {
      relatedEdges = relatedEdges.filter((e) => kinds.includes(e.kind))
    }

    // Rank by frequency × confidence
    type UriInfo = { count: number; totalConfidence: number; kind: string }
    const byUri = new Map<string, UriInfo>()

    for (const edge of relatedEdges) {
      const existing = byUri.get(edge.location_uri)
      if (existing) {
        existing.count++
        existing.totalConfidence += edge.confidence
      } else {
        byUri.set(edge.location_uri, { count: 1, totalConfidence: edge.confidence, kind: edge.kind })
      }
    }

    const maxFreq = Math.max(...Array.from(byUri.values()).map((v) => v.count), 1)

    const ranked = Array.from(byUri.entries())
      .map(([uri, info]) => ({
        location: parseLocation(uri),
        relationship: info.kind,
        score: (info.totalConfidence / info.count) * (info.count / maxFreq),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return successResult({ related: ranked }, {})
  }

  // -------------------------------------------------------------------------
  // corpusCount (used by HTTP /health endpoint)
  // -------------------------------------------------------------------------

  async corpusCount(): Promise<number> {
    const row = this.db.select({ count: sql<number>`count(*)` }).from(corpora).get()
    return row?.count ?? 0
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function successResult<T>(data: T, scope: Scope): ToolResult<T> {
  return {
    ok: true,
    data,
    scope_applied: scope,
    generated_at: new Date().toISOString(),
  }
}

function errorResult(code: string, message: string, retriable = false): ToolResult<never> {
  return { ok: false, kind: 'error', code, message, retriable }
}

function notFoundCorpus(corpus_id: string): ToolResult<never> {
  return errorResult('corpus_not_found', `No corpus found with id '${corpus_id}'`)
}

type EntityRow = {
  id: string
  corpus_id: string
  canonical_name: string
  kind: string
  aliases: string
  description: string | null
  first_location_uri: string | null
  last_location_uri: string | null
  appearance_count: number
  confidence: number
}

function rowToEntity(row: EntityRow): Entity {
  let aliases: string[] = []
  try {
    aliases = JSON.parse(row.aliases) as string[]
  } catch {
    aliases = []
  }

  return {
    id: row.id,
    corpus_id: row.corpus_id,
    canonical_name: row.canonical_name,
    kind: row.kind,
    aliases,
    description: row.description ?? null,
    first_location: row.first_location_uri ? parseLocation(row.first_location_uri) : null,
    last_location: row.last_location_uri ? parseLocation(row.last_location_uri) : null,
    appearance_count: row.appearance_count,
    confidence: row.confidence,
  }
}

type EdgeResult = {
  id: string
  corpus_id: string
  from_entity_id: string
  to_entity_id: string
  kind: string
  location: Location
  confidence: number
}

/**
 * Probe whether an FTS5 table `chunks_fts` exists.
 */
function hasFts(db: Db): boolean {
  try {
    const sqlite = getSqlite(db)
    const rows = sqlite
      .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'`)
      .all()
    return rows.length > 0
  } catch {
    return false
  }
}

type SqliteClient = {
  query<R, P extends unknown[]>(sql: string): { all: (...args: P) => R[]; run: (...args: P) => void }
  exec(sql: string): void
}

function getSqlite(db: Db): SqliteClient {
  return (db as unknown as { $client: SqliteClient }).$client
}
