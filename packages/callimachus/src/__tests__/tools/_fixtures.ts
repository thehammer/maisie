/**
 * Shared seed fixture for in-memory SQLite tests.
 *
 * Call `seedDb(db)` once per test suite to populate a consistent dataset
 * covering one corpus, six chunks, four entities, twelve edges, and nine summaries.
 */

import type { Db } from '../../storage/db'
import { corpora, chunks, entities, edges, summaries } from '../../storage/schema'

// ---------------------------------------------------------------------------
// Stable IDs referenced across tests
// ---------------------------------------------------------------------------

export const CORPUS_ID = 'eisenhorn'

export const CHUNK_IDS = {
  'ch/1':       'chunk-ch1',
  'ch/1/sc/1':  'chunk-ch1-sc1',
  'ch/1/sc/2':  'chunk-ch1-sc2',
  'ch/1/sc/3':  'chunk-ch1-sc3',
  'ch/2':       'chunk-ch2',
  'ch/2/sc/1':  'chunk-ch2-sc1',
  'ch/2/sc/2':  'chunk-ch2-sc2',
  'ch/2/sc/3':  'chunk-ch2-sc3',
} as const

export const ENTITY_IDS = {
  eisenhorn:     'ent-eisenhorn',
  bequin:        'ent-bequin',
  glaw:          'ent-glaw',
  'pontius-glaw': 'ent-pontius-glaw',
} as const

// ---------------------------------------------------------------------------
// URI helpers
// ---------------------------------------------------------------------------

export function chunkUri(path: string): string {
  return `calli://${CORPUS_ID}/${path}`
}

// ---------------------------------------------------------------------------
// seedDb
// ---------------------------------------------------------------------------

export function seedDb(db: Db): void {
  const now = new Date().toISOString()

  // ---- corpus ---------------------------------------------------------------
  db.insert(corpora).values({
    id: CORPUS_ID,
    name: 'Eisenhorn',
    kind: 'book',
    source: '/books/eisenhorn.epub',
    config: '{}',
    created_at: now,
    last_indexed_at: now,
    status: 'ready',
  }).run()

  // ---- chunks ---------------------------------------------------------------
  // Chapter containers (parent_path null)
  db.insert(chunks).values([
    {
      id: CHUNK_IDS['ch/1'],
      corpus_id: CORPUS_ID,
      parent_path: null,
      kind: 'chapter',
      location_uri: chunkUri('ch/1'),
      content: 'Chapter 1: Inquisitor Gregor Eisenhorn arrives on Gudrun to investigate reports of heresy.',
      byte_length: 85,
      created_at: now,
    },
    {
      id: CHUNK_IDS['ch/2'],
      corpus_id: CORPUS_ID,
      parent_path: null,
      kind: 'chapter',
      location_uri: chunkUri('ch/2'),
      content: 'Chapter 2: Eisenhorn pursues the trail of Pontius Glaw deeper into the underhive.',
      byte_length: 81,
      created_at: now,
    },
  ]).run()

  // Scene children
  db.insert(chunks).values([
    {
      id: CHUNK_IDS['ch/1/sc/1'],
      corpus_id: CORPUS_ID,
      parent_path: 'ch/1',
      kind: 'scene',
      location_uri: chunkUri('ch/1/sc/1'),
      content: 'Gregor Eisenhorn investigates heresy in scene 1. Alizebeth Bequin joins his retinue here for the first time.',
      byte_length: 104,
      created_at: now,
    },
    {
      id: CHUNK_IDS['ch/1/sc/2'],
      corpus_id: CORPUS_ID,
      parent_path: 'ch/1',
      kind: 'scene',
      location_uri: chunkUri('ch/1/sc/2'),
      content: 'Eisenhorn confronts the heretic Glaw at a secret conclave, narrowly escaping an ambush.',
      byte_length: 87,
      created_at: now,
    },
    {
      id: CHUNK_IDS['ch/1/sc/3'],
      corpus_id: CORPUS_ID,
      parent_path: 'ch/1',
      kind: 'scene',
      location_uri: chunkUri('ch/1/sc/3'),
      content: 'Glaw reveals his true identity as Pontius Glaw, the infamous radical inquisitor.',
      byte_length: 79,
      created_at: now,
    },
    {
      id: CHUNK_IDS['ch/2/sc/1'],
      corpus_id: CORPUS_ID,
      parent_path: 'ch/2',
      kind: 'scene',
      location_uri: chunkUri('ch/2/sc/1'),
      content: 'Eisenhorn meets Bequin again at the underhive docks. They plan their next move together.',
      byte_length: 87,
      created_at: now,
    },
    {
      id: CHUNK_IDS['ch/2/sc/2'],
      corpus_id: CORPUS_ID,
      parent_path: 'ch/2',
      kind: 'scene',
      location_uri: chunkUri('ch/2/sc/2'),
      content: 'The conflict between Eisenhorn and Glaw escalates into open violence on the streets of Dorsay.',
      byte_length: 92,
      created_at: now,
    },
    {
      id: CHUNK_IDS['ch/2/sc/3'],
      corpus_id: CORPUS_ID,
      parent_path: 'ch/2',
      kind: 'scene',
      location_uri: chunkUri('ch/2/sc/3'),
      content: 'Eisenhorn captures Pontius Glaw and secures the evidence needed for condemnation.',
      byte_length: 80,
      created_at: now,
    },
  ]).run()

  // ---- entities -------------------------------------------------------------
  db.insert(entities).values([
    {
      id: ENTITY_IDS.eisenhorn,
      corpus_id: CORPUS_ID,
      canonical_name: 'Eisenhorn',
      kind: 'character',
      aliases: '["Gregor Eisenhorn","Gregor"]',
      description: 'Inquisitor of the Ordo Xenos. Protagonist.',
      first_location_uri: chunkUri('ch/1/sc/1'),
      last_location_uri: chunkUri('ch/2/sc/3'),
      appearance_count: 6,
      confidence: 0.95,
    },
    {
      id: ENTITY_IDS.bequin,
      corpus_id: CORPUS_ID,
      canonical_name: 'Bequin',
      kind: 'character',
      aliases: '["Alizebeth Bequin","Alizebeth"]',
      description: 'Untouchable. Member of Eisenhorn\'s retinue.',
      first_location_uri: chunkUri('ch/1/sc/1'),
      last_location_uri: chunkUri('ch/2/sc/1'),
      appearance_count: 4,
      confidence: 0.9,
    },
    {
      id: ENTITY_IDS.glaw,
      corpus_id: CORPUS_ID,
      canonical_name: 'Glaw',
      kind: 'character',
      aliases: '[]',
      description: 'Heretic encountered by Eisenhorn.',
      first_location_uri: chunkUri('ch/1/sc/2'),
      last_location_uri: chunkUri('ch/2/sc/2'),
      appearance_count: 3,
      confidence: 0.85,
    },
    {
      id: ENTITY_IDS['pontius-glaw'],
      corpus_id: CORPUS_ID,
      canonical_name: 'Pontius Glaw',
      kind: 'character',
      aliases: '["Glaw"]',
      description: 'Infamous radical inquisitor, true identity of Glaw.',
      first_location_uri: chunkUri('ch/1/sc/3'),
      last_location_uri: chunkUri('ch/2/sc/3'),
      appearance_count: 2,
      confidence: 0.8,
    },
  ]).run()

  // ---- edges ----------------------------------------------------------------
  // 12 total
  db.insert(edges).values([
    // Eisenhorn → Bequin 'knows' at ch/1/sc/1
    {
      id: 'edge-001',
      corpus_id: CORPUS_ID,
      from_entity_id: ENTITY_IDS.eisenhorn,
      to_entity_id: ENTITY_IDS.bequin,
      kind: 'knows',
      location_uri: chunkUri('ch/1/sc/1'),
      confidence: 0.9,
    },
    // Bequin → Eisenhorn 'knows' at ch/1/sc/1 (so they co-occur at ch/1/sc/1)
    {
      id: 'edge-002',
      corpus_id: CORPUS_ID,
      from_entity_id: ENTITY_IDS.bequin,
      to_entity_id: ENTITY_IDS.eisenhorn,
      kind: 'knows',
      location_uri: chunkUri('ch/1/sc/1'),
      confidence: 0.9,
    },
    // Eisenhorn → Glaw 'enemies' at ch/1/sc/2
    {
      id: 'edge-003',
      corpus_id: CORPUS_ID,
      from_entity_id: ENTITY_IDS.eisenhorn,
      to_entity_id: ENTITY_IDS.glaw,
      kind: 'enemies',
      location_uri: chunkUri('ch/1/sc/2'),
      confidence: 0.85,
    },
    // Glaw → Eisenhorn 'enemies' at ch/1/sc/2
    {
      id: 'edge-004',
      corpus_id: CORPUS_ID,
      from_entity_id: ENTITY_IDS.glaw,
      to_entity_id: ENTITY_IDS.eisenhorn,
      kind: 'enemies',
      location_uri: chunkUri('ch/1/sc/2'),
      confidence: 0.85,
    },
    // Glaw → Pontius Glaw 'is' at ch/1/sc/3
    {
      id: 'edge-005',
      corpus_id: CORPUS_ID,
      from_entity_id: ENTITY_IDS.glaw,
      to_entity_id: ENTITY_IDS['pontius-glaw'],
      kind: 'is',
      location_uri: chunkUri('ch/1/sc/3'),
      confidence: 0.95,
    },
    // Eisenhorn → Bequin 'knows' at ch/2/sc/1
    {
      id: 'edge-006',
      corpus_id: CORPUS_ID,
      from_entity_id: ENTITY_IDS.eisenhorn,
      to_entity_id: ENTITY_IDS.bequin,
      kind: 'knows',
      location_uri: chunkUri('ch/2/sc/1'),
      confidence: 0.9,
    },
    // Eisenhorn → Bequin 'meets' at ch/2/sc/1
    {
      id: 'edge-007',
      corpus_id: CORPUS_ID,
      from_entity_id: ENTITY_IDS.eisenhorn,
      to_entity_id: ENTITY_IDS.bequin,
      kind: 'meets',
      location_uri: chunkUri('ch/2/sc/1'),
      confidence: 0.88,
    },
    // Bequin → Eisenhorn 'meets' at ch/2/sc/1 (second co-occurrence)
    {
      id: 'edge-008',
      corpus_id: CORPUS_ID,
      from_entity_id: ENTITY_IDS.bequin,
      to_entity_id: ENTITY_IDS.eisenhorn,
      kind: 'meets',
      location_uri: chunkUri('ch/2/sc/1'),
      confidence: 0.88,
    },
    // Eisenhorn → Glaw 'enemies' at ch/2/sc/2
    {
      id: 'edge-009',
      corpus_id: CORPUS_ID,
      from_entity_id: ENTITY_IDS.eisenhorn,
      to_entity_id: ENTITY_IDS.glaw,
      kind: 'enemies',
      location_uri: chunkUri('ch/2/sc/2'),
      confidence: 0.85,
    },
    // Glaw → Eisenhorn 'enemies' at ch/2/sc/2
    {
      id: 'edge-010',
      corpus_id: CORPUS_ID,
      from_entity_id: ENTITY_IDS.glaw,
      to_entity_id: ENTITY_IDS.eisenhorn,
      kind: 'enemies',
      location_uri: chunkUri('ch/2/sc/2'),
      confidence: 0.85,
    },
    // Eisenhorn → Pontius Glaw 'captures' at ch/2/sc/3
    {
      id: 'edge-011',
      corpus_id: CORPUS_ID,
      from_entity_id: ENTITY_IDS.eisenhorn,
      to_entity_id: ENTITY_IDS['pontius-glaw'],
      kind: 'captures',
      location_uri: chunkUri('ch/2/sc/3'),
      confidence: 0.92,
    },
    // Pontius Glaw → Eisenhorn 'captured_by' at ch/2/sc/3
    {
      id: 'edge-012',
      corpus_id: CORPUS_ID,
      from_entity_id: ENTITY_IDS['pontius-glaw'],
      to_entity_id: ENTITY_IDS.eisenhorn,
      kind: 'captured_by',
      location_uri: chunkUri('ch/2/sc/3'),
      confidence: 0.92,
    },
  ]).run()

  // ---- summaries ------------------------------------------------------------
  // 9 total: 1 corpus-level, 1 structure, 1 per chunk (ch/1 and ch/2 have chapter depth,
  // scenes have scene depth). We use 6 chunk summaries + corpus + structure = 9 (8 + 1
  // structure = 9 total but that's 9 with 1+1+7... let's do: corpus, structure, ch1-chapter,
  // ch2-chapter, and 4 scene summaries = 8. Add one more: ch1-overview = 9).
  // Simpler: 1 corpus-depth, 1 structure-depth, then one 'chapter'-depth summary per chunk (6) = 8.
  // Plus 1 range summary for ch/1 = 9.
  db.insert(summaries).values([
    // Corpus-level summary
    {
      id: 'sum-corpus',
      corpus_id: CORPUS_ID,
      target_kind: 'corpus',
      target_id: CORPUS_ID,
      depth: 'corpus',
      text: 'Eisenhorn is the first novel in Dan Abnett\'s Inquisitor trilogy. Gregor Eisenhorn, an Inquisitor of the Ordo Xenos, investigates heresy and confronts the radical Pontius Glaw across several worlds.',
      model: 'claude-3-5-sonnet-20241022',
      generated_at: now,
    },
    // Structure summary
    {
      id: 'sum-structure',
      corpus_id: CORPUS_ID,
      target_kind: 'corpus',
      target_id: CORPUS_ID,
      depth: 'structure',
      text: 'Part 1 — Prologue. Chapter 1: Gudrun arrival. Chapter 2: Underhive pursuit. [2 chapters, 6 scenes total]',
      model: 'claude-3-5-sonnet-20241022',
      generated_at: now,
    },
    // Chapter-level summaries for each chunk
    {
      id: 'sum-ch1',
      corpus_id: CORPUS_ID,
      target_kind: 'chunk',
      target_id: CHUNK_IDS['ch/1'],
      depth: 'chapter',
      text: 'Eisenhorn arrives on Gudrun, recruits Bequin, and confronts Glaw for the first time.',
      model: 'claude-3-5-sonnet-20241022',
      generated_at: now,
    },
    {
      id: 'sum-ch2',
      corpus_id: CORPUS_ID,
      target_kind: 'chunk',
      target_id: CHUNK_IDS['ch/2'],
      depth: 'chapter',
      text: 'Eisenhorn pursues Glaw into the underhive and captures Pontius Glaw.',
      model: 'claude-3-5-sonnet-20241022',
      generated_at: now,
    },
    {
      id: 'sum-ch1-sc1',
      corpus_id: CORPUS_ID,
      target_kind: 'chunk',
      target_id: CHUNK_IDS['ch/1/sc/1'],
      depth: 'chapter',
      text: 'Eisenhorn meets Bequin. Their partnership begins.',
      model: 'claude-3-5-sonnet-20241022',
      generated_at: now,
    },
    {
      id: 'sum-ch1-sc2',
      corpus_id: CORPUS_ID,
      target_kind: 'chunk',
      target_id: CHUNK_IDS['ch/1/sc/2'],
      depth: 'chapter',
      text: 'First confrontation with Glaw. Eisenhorn survives an ambush.',
      model: 'claude-3-5-sonnet-20241022',
      generated_at: now,
    },
    {
      id: 'sum-ch1-sc3',
      corpus_id: CORPUS_ID,
      target_kind: 'chunk',
      target_id: CHUNK_IDS['ch/1/sc/3'],
      depth: 'chapter',
      text: 'Glaw\'s true identity as Pontius Glaw is revealed.',
      model: 'claude-3-5-sonnet-20241022',
      generated_at: now,
    },
    {
      id: 'sum-ch2-sc1',
      corpus_id: CORPUS_ID,
      target_kind: 'chunk',
      target_id: CHUNK_IDS['ch/2/sc/1'],
      depth: 'chapter',
      text: 'Eisenhorn and Bequin reunite at the docks and plan their pursuit.',
      model: 'claude-3-5-sonnet-20241022',
      generated_at: now,
    },
    {
      id: 'sum-ch2-sc2',
      corpus_id: CORPUS_ID,
      target_kind: 'chunk',
      target_id: CHUNK_IDS['ch/2/sc/2'],
      depth: 'chapter',
      text: 'Open conflict on the streets of Dorsay between Eisenhorn and Glaw.',
      model: 'claude-3-5-sonnet-20241022',
      generated_at: now,
    },
  ]).run()
}
