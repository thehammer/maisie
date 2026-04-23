import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { createDerivedComponentStore } from '../derived-component-store'
import type { ComponentDef } from '@maisie/shared'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS derived_components (
      name TEXT PRIMARY KEY,
      description TEXT,
      input TEXT,
      props TEXT,
      render TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  return drizzle(sqlite)
}

function makeComponent(overrides: Partial<ComponentDef> = {}): ComponentDef {
  return {
    name: 'test.MyTile',
    kind: 'derived',
    description: 'A test derived component',
    input: { kind: 'record', fields: { title: { kind: 'scalar', type: 'string' } } },
    props: {
      maxLines: { type: { kind: 'scalar', type: 'number' }, default: 3 },
    },
    render: { kind: 'literal', value: 'stub-render-tree' },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DerivedComponentStore', () => {
  let store: ReturnType<typeof createDerivedComponentStore>

  beforeEach(() => {
    store = createDerivedComponentStore(makeDb() as any)
  })

  it('loadAll returns empty array when nothing saved', async () => {
    const components = await store.loadAll()
    expect(components).toEqual([])
  })

  it('save and loadAll round-trip preserves ComponentDef structure', async () => {
    const c = makeComponent()
    await store.save(c)

    const all = await store.loadAll()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe(c.name)
    expect(all[0].kind).toBe('derived')
    expect(all[0].description).toBe(c.description)
    expect(all[0].input).toEqual(c.input)
    expect(all[0].props).toEqual(c.props)
    expect(all[0].render).toEqual(c.render)
  })

  it('save is an upsert — second save updates the row', async () => {
    await store.save(makeComponent())
    await store.save(makeComponent({ description: 'Updated' }))

    const all = await store.loadAll()
    expect(all).toHaveLength(1)
    expect(all[0].description).toBe('Updated')
  })

  it('delete removes a saved component', async () => {
    await store.save(makeComponent())
    await store.delete('test.MyTile')

    const all = await store.loadAll()
    expect(all).toHaveLength(0)
  })

  it('delete is a no-op for non-existent name', async () => {
    await expect(store.delete('does-not-exist')).resolves.toBeUndefined()
  })

  it('get returns null for unknown name', async () => {
    const result = await store.get('missing')
    expect(result).toBeNull()
  })

  it('get returns the component after save', async () => {
    const c = makeComponent()
    await store.save(c)

    const result = await store.get('test.MyTile')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('test.MyTile')
    expect(result!.kind).toBe('derived')
    expect(result!.render).toEqual(c.render)
  })

  it('preserves render AST through JSON serialization round-trip', async () => {
    const c = makeComponent({
      render: {
        kind: 'apply',
        fn: 'stack',
        args: [
          { kind: 'literal', value: 'child1' },
          { kind: 'literal', value: 'child2' },
        ],
      } as any,
    })
    await store.save(c)

    const loaded = await store.get('test.MyTile')
    expect(loaded!.render).toEqual(c.render)
  })

  it('handles components without optional fields (no input, no props)', async () => {
    const minimal: ComponentDef = {
      name: 'test.Minimal',
      kind: 'derived',
      render: { kind: 'literal', value: 'x' },
    }
    await store.save(minimal)

    const loaded = await store.get('test.Minimal')
    expect(loaded).not.toBeNull()
    expect(loaded!.input).toBeUndefined()
    expect(loaded!.props).toBeUndefined()
  })

  it('handles multiple components independently', async () => {
    await store.save(makeComponent({ name: 'test.A', description: 'A' }))
    await store.save(makeComponent({ name: 'test.B', description: 'B' }))

    const all = await store.loadAll()
    expect(all).toHaveLength(2)

    const a = await store.get('test.A')
    const b = await store.get('test.B')
    expect(a!.description).toBe('A')
    expect(b!.description).toBe('B')
  })
})
