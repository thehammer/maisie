import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from 'drizzle-orm/sqlite-core'

// ---------------------------------------------------------------------------
// corpora
// ---------------------------------------------------------------------------
export const corpora = sqliteTable('corpora', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  source: text('source').notNull(),
  config: text('config').notNull().default('{}'),
  created_at: text('created_at').notNull(),
  last_indexed_at: text('last_indexed_at'),
  status: text('status').notNull().default('registered'),
})

// ---------------------------------------------------------------------------
// chunks
// ---------------------------------------------------------------------------
export const chunks = sqliteTable(
  'chunks',
  {
    id: text('id').primaryKey(),
    corpus_id: text('corpus_id').notNull(),
    parent_path: text('parent_path'),
    kind: text('kind').notNull(),
    location_uri: text('location_uri').notNull(),
    content: text('content').notNull(),
    byte_length: integer('byte_length').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [index('idx_chunks_corpus_id').on(t.corpus_id)],
)

// ---------------------------------------------------------------------------
// entities
// ---------------------------------------------------------------------------
export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey(),
    corpus_id: text('corpus_id').notNull(),
    canonical_name: text('canonical_name').notNull(),
    kind: text('kind').notNull(),
    aliases: text('aliases').notNull().default('[]'),
    description: text('description'),
    first_location_uri: text('first_location_uri'),
    last_location_uri: text('last_location_uri'),
    appearance_count: integer('appearance_count').notNull().default(0),
    confidence: real('confidence').notNull().default(0),
  },
  (t) => [index('idx_entities_corpus_name').on(t.corpus_id, t.canonical_name)],
)

// ---------------------------------------------------------------------------
// edges
// ---------------------------------------------------------------------------
export const edges = sqliteTable(
  'edges',
  {
    id: text('id').primaryKey(),
    corpus_id: text('corpus_id').notNull(),
    from_entity_id: text('from_entity_id').notNull(),
    to_entity_id: text('to_entity_id').notNull(),
    kind: text('kind').notNull(),
    location_uri: text('location_uri').notNull(),
    confidence: real('confidence').notNull().default(0),
  },
  (t) => [
    index('idx_edges_corpus_from').on(t.corpus_id, t.from_entity_id),
    index('idx_edges_corpus_to').on(t.corpus_id, t.to_entity_id),
  ],
)

// ---------------------------------------------------------------------------
// summaries
// ---------------------------------------------------------------------------
export const summaries = sqliteTable('summaries', {
  id: text('id').primaryKey(),
  corpus_id: text('corpus_id').notNull(),
  target_kind: text('target_kind').notNull(),
  target_id: text('target_id').notNull(),
  depth: text('depth').notNull(),
  text: text('text').notNull(),
  model: text('model'),
  generated_at: text('generated_at').notNull(),
})

// ---------------------------------------------------------------------------
// corrections — persist user-authored corrections separately from derived data
// ---------------------------------------------------------------------------
export const corrections = sqliteTable('corrections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  corpus_id: text('corpus_id').notNull(),
  kind: text('kind').notNull(),
  payload: text('payload').notNull().default('{}'),
  created_at: text('created_at').notNull(),
})

// ---------------------------------------------------------------------------
// runs — indexing run log
// ---------------------------------------------------------------------------
export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  corpus_id: text('corpus_id').notNull(),
  pass: integer('pass').notNull(),
  started_at: text('started_at').notNull(),
  finished_at: text('finished_at'),
  status: text('status').notNull().default('running'),
  stats: text('stats').notNull().default('{}'),
})
