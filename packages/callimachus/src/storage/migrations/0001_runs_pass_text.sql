-- Change runs.pass from INTEGER to TEXT to support named pass identifiers
-- (chunk, extract_structure, extract_semantic, summarize)
-- SQLite does not support ALTER COLUMN TYPE, so we recreate the table.
DROP TABLE IF EXISTS runs;
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL,
  pass TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  stats TEXT NOT NULL DEFAULT '{}'
);
