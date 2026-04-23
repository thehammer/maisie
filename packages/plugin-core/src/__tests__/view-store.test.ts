import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { createViewStore } from '../view-store'
import type { ViewDef } from '@maisie/shared'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS views (
      name TEXT PRIMARY KEY,
      description TEXT,
      source TEXT NOT NULL,
      chain TEXT NOT NULL,
      component TEXT NOT NULL,
      component_props TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  return drizzle(sqlite)
}

function makeView(overrides: Partial<ViewDef> = {}): ViewDef {
  return {
    name: 'recent-movies-strip',
    description: 'Plex recently added as a movie strip',
    source: { entity: 'plex.list_recently_added', field: 'result' },
    chain: [],
    component: 'Strip',
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ViewStore', () => {
  let store: ReturnType<typeof createViewStore>

  beforeEach(() => {
    store = createViewStore(makeDb() as any)
  })

  it('loadAll returns empty array when no views saved', async () => {
    const views = await store.loadAll()
    expect(views).toEqual([])
  })

  it('save and loadAll round-trip preserves view structure', async () => {
    const view = makeView()
    await store.save(view)

    const all = await store.loadAll()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe(view.name)
    expect(all[0].description).toBe(view.description)
    expect(all[0].source).toEqual(view.source)
    expect(all[0].chain).toEqual(view.chain)
    expect(all[0].component).toBe(view.component)
  })

  it('save with same name twice updates (upsert)', async () => {
    await store.save(makeView())
    await store.save(makeView({ description: 'Updated description' }))

    const all = await store.loadAll()
    expect(all).toHaveLength(1)
    expect(all[0].description).toBe('Updated description')
  })

  it('delete removes the view', async () => {
    await store.save(makeView())
    await store.delete('recent-movies-strip')

    const all = await store.loadAll()
    expect(all).toHaveLength(0)
  })

  it('delete on non-existent name is a no-op', async () => {
    await store.delete('ghost-view')
    expect(await store.loadAll()).toHaveLength(0)
  })

  it('get returns the view when it exists', async () => {
    const view = makeView()
    await store.save(view)

    const found = await store.get(view.name)
    expect(found).not.toBeNull()
    expect(found!.name).toBe(view.name)
    expect(found!.component).toBe(view.component)
  })

  it('get returns null when view does not exist', async () => {
    const found = await store.get('ghost-view')
    expect(found).toBeNull()
  })

  it('preserves chain steps on round-trip', async () => {
    const view = makeView({
      chain: [
        { functionId: 'std.limit', params: { n: 5 } },
        { functionId: 'std.sort', params: { field: 'title', direction: 'asc' } },
      ],
    })
    await store.save(view)

    const found = await store.get(view.name)
    expect(found!.chain).toHaveLength(2)
    expect(found!.chain[0].functionId).toBe('std.limit')
    expect(found!.chain[0].params).toEqual({ n: 5 })
    expect(found!.chain[1].functionId).toBe('std.sort')
  })

  it('preserves componentProps on round-trip', async () => {
    const view = makeView({ componentProps: { orientation: 'horizontal', gap: 8 } })
    await store.save(view)

    const found = await store.get(view.name)
    expect(found!.componentProps).toEqual({ orientation: 'horizontal', gap: 8 })
  })

  it('returns undefined description when null in DB', async () => {
    await store.save(makeView({ description: undefined }))
    const found = await store.get('recent-movies-strip')
    expect(found!.description).toBeUndefined()
  })

  it('stores multiple views independently', async () => {
    await store.save(makeView({ name: 'view-a', component: 'Strip' }))
    await store.save(makeView({ name: 'view-b', component: 'Tile' }))

    const all = await store.loadAll()
    expect(all).toHaveLength(2)
    const names = all.map((v) => v.name).sort()
    expect(names).toEqual(['view-a', 'view-b'])
  })
})
