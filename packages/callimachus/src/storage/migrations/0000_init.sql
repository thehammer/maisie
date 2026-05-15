-- Callimachus initial schema
-- Applied idempotently via CREATE TABLE IF NOT EXISTS

CREATE TABLE IF NOT EXISTS corpora (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  last_indexed_at TEXT,
  status TEXT NOT NULL DEFAULT 'registered'
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL,
  parent_path TEXT,
  kind TEXT NOT NULL,
  location_uri TEXT NOT NULL,
  content TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_corpus_id ON chunks (corpus_id);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  first_location_uri TEXT,
  last_location_uri TEXT,
  appearance_count INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entities_corpus_name ON entities (corpus_id, canonical_name);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL,
  from_entity_id TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  location_uri TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_edges_corpus_from ON edges (corpus_id, from_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_corpus_to ON edges (corpus_id, to_entity_id);

CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  depth TEXT NOT NULL,
  text TEXT NOT NULL,
  model TEXT,
  generated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corpus_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL,
  pass INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  stats TEXT NOT NULL DEFAULT '{}'
);
