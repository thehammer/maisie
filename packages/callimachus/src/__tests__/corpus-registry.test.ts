import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { runMigrations } from '../storage/migrator'
import * as schema from '../storage/schema'
import { AdapterRegistry } from '../adapter/registry'
import { CorpusRegistry } from '../registry/corpus-registry'

function makeTestRegistry(): CorpusRegistry {
  const sqlite = new Database(':memory:')
  runMigrations(sqlite)
  const db = drizzle(sqlite, { schema })
  const adapters = new AdapterRegistry()
  return new CorpusRegistry(db, adapters)
}

describe('CorpusRegistry.add', () => {
  it('persists a corpus and returns it with all fields populated', async () => {
    const registry = makeTestRegistry()
    const corpus = await registry.add({ kind: 'book', name: 'Xenos', source: '/books/xenos.epub' })

    expect(corpus.id).toBe('xenos')
    expect(corpus.name).toBe('Xenos')
    expect(corpus.kind).toBe('book')
    expect(corpus.source).toBe('/books/xenos.epub')
    expect(corpus.status).toBe('registered')
    expect(corpus.created_at).toBeInstanceOf(Date)
    expect(corpus.last_indexed_at).toBeNull()
  })

  it('uses an explicit id when provided', async () => {
    const registry = makeTestRegistry()
    const corpus = await registry.add({ id: 'my-book', kind: 'book', name: 'Xenos', source: '/books/xenos.epub' })

    expect(corpus.id).toBe('my-book')
  })

  it('slugifies the name to generate an id when no id is provided', async () => {
    const registry = makeTestRegistry()
    const corpus = await registry.add({ kind: 'book', name: 'My Great Book', source: '/books/mgb.epub' })

    expect(corpus.id).toBe('my-great-book')
  })

  it('throws an error containing "already exists" when adding a duplicate id', async () => {
    const registry = makeTestRegistry()
    await registry.add({ id: 'xenos', kind: 'book', name: 'Xenos', source: '/books/xenos.epub' })

    await expect(
      registry.add({ id: 'xenos', kind: 'book', name: 'Xenos 2', source: '/books/xenos2.epub' }),
    ).rejects.toThrow(/already exists/)
  })

  it('throws a validation error when source is empty', async () => {
    const registry = makeTestRegistry()

    await expect(
      registry.add({ kind: 'book', name: 'Xenos', source: '' }),
    ).rejects.toThrow()
  })

  it('stores config as a parsed object', async () => {
    const registry = makeTestRegistry()
    const corpus = await registry.add({
      kind: 'book',
      name: 'Xenos',
      source: '/books/xenos.epub',
      config: { language: 'en', chapters: 42 },
    })

    expect(corpus.config).toEqual({ language: 'en', chapters: 42 })
  })
})

describe('CorpusRegistry.list', () => {
  it('returns an empty array when no corpora are registered', async () => {
    const registry = makeTestRegistry()
    const list = await registry.list()

    expect(list).toEqual([])
  })

  it('returns all inserted corpora', async () => {
    const registry = makeTestRegistry()
    await registry.add({ kind: 'book', name: 'Xenos', source: '/books/xenos.epub' })
    await registry.add({ kind: 'book', name: 'Ilium', source: '/books/ilium.epub' })
    await registry.add({ kind: 'code', name: 'Agent', source: '/src/agent' })

    const list = await registry.list()
    const ids = list.map((c) => c.id)

    expect(ids).toContain('xenos')
    expect(ids).toContain('ilium')
    expect(ids).toContain('agent')
    expect(list).toHaveLength(3)
  })
})

describe('CorpusRegistry.get', () => {
  it('returns the corpus when it exists', async () => {
    const registry = makeTestRegistry()
    await registry.add({ kind: 'book', name: 'Xenos', source: '/books/xenos.epub' })

    const corpus = await registry.get('xenos')
    expect(corpus).not.toBeNull()
    expect(corpus?.name).toBe('Xenos')
  })

  it('returns null when the corpus does not exist', async () => {
    const registry = makeTestRegistry()
    const corpus = await registry.get('does-not-exist')

    expect(corpus).toBeNull()
  })
})

describe('CorpusRegistry.status', () => {
  it('returns zero counts and null last_run for a freshly registered corpus', async () => {
    const registry = makeTestRegistry()
    await registry.add({ kind: 'book', name: 'Xenos', source: '/books/xenos.epub' })

    const status = await registry.status('xenos')

    expect(status).not.toBeNull()
    expect(status?.chunk_count).toBe(0)
    expect(status?.entity_count).toBe(0)
    expect(status?.last_run).toBeNull()
  })

  it('includes the corpus details in the status result', async () => {
    const registry = makeTestRegistry()
    await registry.add({ kind: 'book', name: 'Xenos', source: '/books/xenos.epub' })

    const status = await registry.status('xenos')

    expect(status?.corpus.id).toBe('xenos')
    expect(status?.corpus.name).toBe('Xenos')
  })

  it('returns null when the corpus does not exist', async () => {
    const registry = makeTestRegistry()
    const status = await registry.status('does-not-exist')

    expect(status).toBeNull()
  })
})

describe('CorpusRegistry.remove', () => {
  it('deletes the corpus so get returns null afterward', async () => {
    const registry = makeTestRegistry()
    await registry.add({ kind: 'book', name: 'Xenos', source: '/books/xenos.epub' })
    await registry.remove('xenos')

    const corpus = await registry.get('xenos')
    expect(corpus).toBeNull()
  })

  it('removes the corpus from list results', async () => {
    const registry = makeTestRegistry()
    await registry.add({ kind: 'book', name: 'Xenos', source: '/books/xenos.epub' })
    await registry.add({ kind: 'book', name: 'Ilium', source: '/books/ilium.epub' })

    await registry.remove('xenos')

    const list = await registry.list()
    const ids = list.map((c) => c.id)
    expect(ids).not.toContain('xenos')
    expect(ids).toContain('ilium')
  })

  it('does not throw when removing a corpus that does not exist', async () => {
    const registry = makeTestRegistry()

    await expect(registry.remove('never-existed')).resolves.toBeUndefined()
  })
})
