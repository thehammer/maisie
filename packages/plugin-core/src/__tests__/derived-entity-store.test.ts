import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { createDerivedEntityStore } from '../derived-entity-store'
import type { EntityDef } from '@maisie/shared'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS derived_entities (
      name TEXT PRIMARY KEY,
      description TEXT,
      fields TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  return drizzle(sqlite)
}

function makeEntity(overrides: Partial<EntityDef> = {}): EntityDef {
  return {
    name: 'test-entity',
    description: 'A test derived entity',
    source: 'derived',
    fields: {
      switches: {
        kind: 'data',
        type: 'collection',
        expression: { kind: 'ref', name: 'home-assistant.list_switches' },
      },
    },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DerivedEntityStore', () => {
  let store: ReturnType<typeof createDerivedEntityStore>

  beforeEach(() => {
    store = createDerivedEntityStore(makeDb() as any)
  })

  it('loadAll returns empty array when no entities saved', async () => {
    const entities = await store.loadAll()
    expect(entities).toEqual([])
  })

  it('save and loadAll round-trip preserves entity structure', async () => {
    const entity = makeEntity()
    await store.save(entity)

    const all = await store.loadAll()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe(entity.name)
    expect(all[0].description).toBe(entity.description)
    expect(all[0].source).toBe('derived')
    expect(all[0].fields).toEqual(entity.fields)
  })

  it('save with same name twice updates (upsert)', async () => {
    const entity = makeEntity()
    await store.save(entity)

    const updated = makeEntity({ description: 'Updated description' })
    await store.save(updated)

    const all = await store.loadAll()
    expect(all).toHaveLength(1) // still one row
    expect(all[0].description).toBe('Updated description')
  })

  it('delete removes the entity', async () => {
    await store.save(makeEntity())
    await store.delete('test-entity')

    const all = await store.loadAll()
    expect(all).toHaveLength(0)
  })

  it('delete is a no-op for non-existent name', async () => {
    // Should not throw
    await expect(store.delete('does-not-exist')).resolves.toBeUndefined()
  })

  it('get returns null for missing name', async () => {
    const result = await store.get('missing')
    expect(result).toBeNull()
  })

  it('get returns the entity after save', async () => {
    const entity = makeEntity()
    await store.save(entity)

    const result = await store.get('test-entity')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('test-entity')
    expect(result!.source).toBe('derived')
    expect(result!.fields).toEqual(entity.fields)
  })

  it('preserves expression AST in fields JSON', async () => {
    const entity = makeEntity({
      fields: {
        count: {
          kind: 'data',
          type: 'number',
          expression: {
            kind: 'pipe',
            value: { kind: 'ref', name: 'home-assistant.list_switches' },
            steps: [{ kind: 'apply', fn: 'std.count', args: [] }],
          },
        },
      },
    })
    await store.save(entity)

    const loaded = await store.get('test-entity')
    expect(loaded!.fields.count).toEqual(entity.fields.count)
  })

  it('handles multiple entities independently', async () => {
    await store.save(makeEntity({ name: 'entity-a', description: 'A' }))
    await store.save(makeEntity({ name: 'entity-b', description: 'B' }))

    const all = await store.loadAll()
    expect(all).toHaveLength(2)

    const a = await store.get('entity-a')
    const b = await store.get('entity-b')
    expect(a!.description).toBe('A')
    expect(b!.description).toBe('B')
  })
})
