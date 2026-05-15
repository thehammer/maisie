import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import * as schema from './schema'
import { runMigrations } from './migrator'

export type Db = ReturnType<typeof drizzle<typeof schema>>

let _db: Db | null = null

/**
 * Open (or return a cached) Callimachus SQLite database.
 *
 * Path resolution order:
 *   1. `path` argument (explicit override, used in tests)
 *   2. `CALLIMACHUS_DB` env var
 *   3. `./data/callimachus.db` (relative to cwd)
 */
export function openDb(path?: string): Db {
  const dbPath = path ?? process.env.CALLIMACHUS_DB ?? './data/callimachus.db'

  if (dbPath !== ':memory:') {
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  const sqlite = new Database(dbPath)
  sqlite.exec('PRAGMA journal_mode = WAL')

  runMigrations(sqlite)

  const db = drizzle(sqlite, { schema })
  return db
}

/**
 * Get the cached default DB, initialising it on first call.
 * Only used by the CLI — tests should call openDb() directly with ':memory:'.
 */
export function getDefaultDb(): Db {
  if (!_db) {
    _db = openDb()
  }
  return _db
}
