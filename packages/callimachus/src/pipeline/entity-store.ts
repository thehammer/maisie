import { eq, and } from 'drizzle-orm'
import type { Db } from '../storage/db'
import { entities, edges } from '../storage/schema'
import type { Entity } from '../types/entity'
import type { Edge } from '../types/edge'
import type { EntityMerge } from '../adapter/contract'

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function hashId(...parts: string[]): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(parts.join('|'))
  return hasher.digest('hex')
}

export function entityId(corpus_id: string, kind: string, canonical_name: string): string {
  return hashId(corpus_id, kind, canonical_name)
}

export function edgeId(
  corpus_id: string,
  from: string,
  to: string,
  kind: string,
  location_uri: string,
): string {
  return hashId(corpus_id, from, to, kind, location_uri)
}

// ---------------------------------------------------------------------------
// Row ↔ Entity conversion
// ---------------------------------------------------------------------------

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
  let aliases: string[]
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
    first_location: row.first_location_uri ? { corpus_id: row.corpus_id, path: row.first_location_uri, uri: row.first_location_uri } : null,
    last_location: row.last_location_uri ? { corpus_id: row.corpus_id, path: row.last_location_uri, uri: row.last_location_uri } : null,
    appearance_count: row.appearance_count,
    confidence: row.confidence,
  }
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Upsert an entity.
 * - id = sha256(corpus_id|kind|canonical_name)
 * - On conflict: increment appearance_count, merge aliases (union deduped),
 *   update last_location_uri, bump confidence to max(existing, incoming).
 */
export function upsertEntity(db: Db, entity: Entity): void {
  const id = entityId(entity.corpus_id, entity.kind, entity.canonical_name)
  const aliasesJson = JSON.stringify(entity.aliases ?? [])
  const firstUri = entity.first_location?.uri ?? null
  const lastUri = entity.last_location?.uri ?? null

  // Try insert first
  const existing = db
    .select()
    .from(entities)
    .where(eq(entities.id, id))
    .get() as EntityRow | undefined

  if (!existing) {
    db.insert(entities)
      .values({
        id,
        corpus_id: entity.corpus_id,
        canonical_name: entity.canonical_name,
        kind: entity.kind,
        aliases: aliasesJson,
        description: entity.description ?? null,
        first_location_uri: firstUri,
        last_location_uri: lastUri,
        appearance_count: entity.appearance_count,
        confidence: entity.confidence,
      })
      .run()
    return
  }

  // Merge aliases
  let existingAliases: string[]
  try {
    existingAliases = JSON.parse(existing.aliases) as string[]
  } catch {
    existingAliases = []
  }
  const mergedAliases = Array.from(new Set([...existingAliases, ...entity.aliases]))

  db.update(entities)
    .set({
      aliases: JSON.stringify(mergedAliases),
      last_location_uri: lastUri ?? existing.last_location_uri,
      appearance_count: existing.appearance_count + entity.appearance_count,
      confidence: Math.max(existing.confidence, entity.confidence),
    })
    .where(eq(entities.id, id))
    .run()
}

/** Upsert an edge. INSERT OR IGNORE — edges are identified by their content hash. */
export function upsertEdge(db: Db, edge: Edge): void {
  const id = edgeId(
    edge.corpus_id,
    edge.from_entity_id,
    edge.to_entity_id,
    edge.kind,
    edge.location.uri,
  )
  db.insert(edges)
    .values({
      id,
      corpus_id: edge.corpus_id,
      from_entity_id: edge.from_entity_id,
      to_entity_id: edge.to_entity_id,
      kind: edge.kind,
      location_uri: edge.location.uri,
      confidence: edge.confidence,
    })
    .onConflictDoNothing()
    .run()
}

/**
 * Apply entity merges: fold aliases into canonical entity, delete source rows.
 */
export function applyEntityMerges(
  db: Db,
  corpus_id: string,
  merges: EntityMerge[],
): void {
  for (const merge of merges) {
    // Find the canonical entity
    const canonicalRows = db
      .select()
      .from(entities)
      .where(and(eq(entities.corpus_id, corpus_id), eq(entities.canonical_name, merge.canonical)))
      .all() as EntityRow[]

    if (canonicalRows.length === 0) continue
    const canonical = canonicalRows[0]

    // Collect all aliases from the to-be-merged entities
    const allAliases: string[] = merge.aliases.slice()
    let existingAliases: string[]
    try {
      existingAliases = JSON.parse(canonical.aliases) as string[]
    } catch {
      existingAliases = []
    }

    // Delete source entities
    for (const entityIdToMerge of merge.entity_ids) {
      if (entityIdToMerge === canonical.id) continue
      const srcRow = db
        .select()
        .from(entities)
        .where(eq(entities.id, entityIdToMerge))
        .get() as EntityRow | undefined
      if (srcRow) {
        try {
          allAliases.push(...(JSON.parse(srcRow.aliases) as string[]))
        } catch {
          // ignore
        }
        allAliases.push(srcRow.canonical_name)
        db.delete(entities).where(eq(entities.id, entityIdToMerge)).run()
      }
    }

    // Update canonical with merged aliases
    const mergedAliases = Array.from(
      new Set([...existingAliases, ...allAliases.filter((a) => a !== canonical.canonical_name)]),
    )
    db.update(entities)
      .set({ aliases: JSON.stringify(mergedAliases) })
      .where(eq(entities.id, canonical.id))
      .run()
  }
}

/** List all entities for a corpus. */
export function listEntitiesForCorpus(db: Db, corpus_id: string): Entity[] {
  const rows = db
    .select()
    .from(entities)
    .where(eq(entities.corpus_id, corpus_id))
    .all() as EntityRow[]
  return rows.map(rowToEntity)
}
