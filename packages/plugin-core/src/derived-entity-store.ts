/**
 * Persistence layer for derived entities.
 *
 * Stores EntityDef records in the `derived_entities` SQLite table via Drizzle.
 * Follows the same module pattern as layout-service.ts: lazy schema import,
 * Drizzle queries, upsert on save.
 */

import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import type { EntityDef } from '@maisie/shared'

export interface DerivedEntityStore {
  save(entity: EntityDef): Promise<void>
  loadAll(): Promise<EntityDef[]>
  delete(name: string): Promise<void>
  get(name: string): Promise<EntityDef | null>
}

export function createDerivedEntityStore(db: BunSQLiteDatabase<any>): DerivedEntityStore {
  async function save(entity: EntityDef): Promise<void> {
    const { derivedEntities } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    const now = new Date()
    const fields = entity.fields as Record<string, unknown>

    const existing = await db
      .select()
      .from(derivedEntities)
      .where(eq(derivedEntities.name, entity.name))
      .get()

    if (existing) {
      await db
        .update(derivedEntities)
        .set({
          description: entity.description ?? null,
          fields,
          updatedAt: now,
        })
        .where(eq(derivedEntities.name, entity.name))
    } else {
      await db.insert(derivedEntities).values({
        name: entity.name,
        description: entity.description ?? null,
        fields,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  async function loadAll(): Promise<EntityDef[]> {
    const { derivedEntities } = await import('../../agent/src/services/schema')

    const rows = await db.select().from(derivedEntities).all()
    return rows.map(rowToEntityDef)
  }

  async function deleteEntity(name: string): Promise<void> {
    const { derivedEntities } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    await db.delete(derivedEntities).where(eq(derivedEntities.name, name))
  }

  async function get(name: string): Promise<EntityDef | null> {
    const { derivedEntities } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    const row = await db
      .select()
      .from(derivedEntities)
      .where(eq(derivedEntities.name, name))
      .get()

    if (!row) return null
    return rowToEntityDef(row)
  }

  return { save, loadAll, delete: deleteEntity, get }
}

function rowToEntityDef(row: {
  name: string
  description: string | null
  fields: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}): EntityDef {
  return {
    name: row.name,
    description: row.description ?? undefined,
    source: 'derived',
    fields: row.fields as EntityDef['fields'],
  }
}
