import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { runMigrations } from '../storage/migrator'

const EXPECTED_TABLES = ['corpora', 'chunks', 'entities', 'edges', 'summaries', 'corrections', 'runs', '_migrations']

describe('database schema', () => {
  it('creates all expected tables after running migrations', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite)

    const rows = sqlite
      .query<{ name: string }, []>('SELECT name FROM sqlite_master WHERE type=\'table\'')
      .all()

    const tableNames = rows.map((r) => r.name)

    for (const expected of EXPECTED_TABLES) {
      expect(tableNames).toContain(expected)
    }
  })

  it('creates the _migrations tracking table', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite)

    const rows = sqlite
      .query<{ name: string }, []>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'_migrations\'')
      .all()

    expect(rows).toHaveLength(1)
  })

  it('is idempotent — running migrations twice does not throw', () => {
    const sqlite = new Database(':memory:')
    expect(() => {
      runMigrations(sqlite)
      runMigrations(sqlite)
    }).not.toThrow()
  })

  it('records applied migrations in the _migrations table', () => {
    const sqlite = new Database(':memory:')
    runMigrations(sqlite)

    const rows = sqlite
      .query<{ name: string }, []>('SELECT name FROM _migrations')
      .all()

    // At least one migration file should have been applied
    expect(rows.length).toBeGreaterThan(0)
  })
})
