import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { createCanvasDocumentStore } from '../canvas-document-store'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS canvas_documents (
      id TEXT PRIMARY KEY,
      document TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  return drizzle(sqlite)
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    placements: [],
    wires: [],
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CanvasDocumentStore', () => {
  let store: ReturnType<typeof createCanvasDocumentStore>

  beforeEach(() => {
    store = createCanvasDocumentStore(makeDb() as any)
  })

  it('load returns null when document does not exist', async () => {
    const result = await store.load('default')
    expect(result).toBeNull()
  })

  it('save and load round-trip preserves the document', async () => {
    const doc = makeDoc({ placements: [{ id: 'p1', kind: 'entity', targetName: 'foo', position: { x: 0, y: 0 } }] })
    await store.save('default', doc)

    const loaded = await store.load('default')
    expect(loaded).not.toBeNull()
    expect(loaded).toEqual(doc)
  })

  it('save with same id twice updates (upsert)', async () => {
    await store.save('default', makeDoc())
    const updated = makeDoc({ placements: [{ id: 'p1', kind: 'component', targetName: 'Strip', position: { x: 100, y: 0 } }] })
    await store.save('default', updated)

    const loaded = await store.load('default')
    expect(loaded).toEqual(updated)
  })

  it('clear removes the document', async () => {
    await store.save('default', makeDoc())
    await store.clear('default')

    const loaded = await store.load('default')
    expect(loaded).toBeNull()
  })

  it('clear on non-existent id is a no-op', async () => {
    await expect(store.clear('ghost')).resolves.toBeUndefined()
  })

  it('different ids are stored independently', async () => {
    const docA = makeDoc({ placements: [{ id: 'a', kind: 'entity', targetName: 'A', position: { x: 0, y: 0 } }] })
    const docB = makeDoc({ placements: [{ id: 'b', kind: 'component', targetName: 'B', position: { x: 0, y: 0 } }] })

    await store.save('user-1', docA)
    await store.save('user-2', docB)

    const loadedA = await store.load('user-1')
    const loadedB = await store.load('user-2')
    expect(loadedA).toEqual(docA)
    expect(loadedB).toEqual(docB)
  })

  it('preserves complex document structure on round-trip', async () => {
    const doc = {
      version: 1 as const,
      placements: [
        { id: 'p1', kind: 'entity', targetName: 'plex.recently_added', position: { x: 60, y: 120 } },
        { id: 'p2', kind: 'function', targetName: 'std.limit', position: { x: 260, y: 120 }, config: { n: 5 } },
        { id: 'p3', kind: 'component', targetName: 'Strip', position: { x: 460, y: 120 } },
      ],
      wires: [
        { id: 'w1', source: { placementId: 'p1' }, target: { placementId: 'p2' } },
        { id: 'w2', source: { placementId: 'p2' }, target: { placementId: 'p3' } },
      ],
    }
    await store.save('default', doc)
    const loaded = await store.load('default')
    expect(loaded).toEqual(doc)
  })
})
