import type { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const MIGRATIONS_DIR = join(import.meta.dir, 'migrations')

/**
 * Apply all SQL migration files in `migrations/` in lexicographic order.
 * Tracks applied migrations in a `_migrations` table so each file runs once.
 */
export function runMigrations(sqlite: Database): void {
  // Bootstrap the migrations tracking table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  const applied = new Set<string>(
    sqlite
      .query<{ name: string }, []>('SELECT name FROM _migrations')
      .all()
      .map((r) => r.name),
  )

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) continue

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
    sqlite.exec(sql)

    sqlite
      .query('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')
      .run(file, new Date().toISOString())
  }
}
