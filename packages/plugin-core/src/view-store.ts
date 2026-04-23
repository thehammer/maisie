/**
 * Persistence layer for views.
 *
 * Stores ViewDef records in the `views` SQLite table via Drizzle.
 * Mirrors the pattern from derived-entity-store.ts: lazy schema import,
 * Drizzle queries, upsert on save.
 */

import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import type { ViewDef } from '@maisie/shared'

export interface ViewStore {
  save(view: ViewDef): Promise<void>
  loadAll(): Promise<ViewDef[]>
  delete(name: string): Promise<void>
  get(name: string): Promise<ViewDef | null>
}

export function createViewStore(db: BunSQLiteDatabase<any>): ViewStore {
  async function save(view: ViewDef): Promise<void> {
    const { views } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    const now = new Date()

    const existing = await db
      .select()
      .from(views)
      .where(eq(views.name, view.name))
      .get()

    if (existing) {
      await db
        .update(views)
        .set({
          description: view.description ?? null,
          source: view.source,
          chain: view.chain,
          component: view.component,
          componentProps: view.componentProps ?? null,
          updatedAt: now,
        })
        .where(eq(views.name, view.name))
    } else {
      await db.insert(views).values({
        name: view.name,
        description: view.description ?? null,
        source: view.source,
        chain: view.chain,
        component: view.component,
        componentProps: view.componentProps ?? null,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  async function loadAll(): Promise<ViewDef[]> {
    const { views } = await import('../../agent/src/services/schema')

    const rows = await db.select().from(views).all()
    return rows.map(rowToViewDef)
  }

  async function deleteView(name: string): Promise<void> {
    const { views } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    await db.delete(views).where(eq(views.name, name))
  }

  async function get(name: string): Promise<ViewDef | null> {
    const { views } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    const row = await db
      .select()
      .from(views)
      .where(eq(views.name, name))
      .get()

    if (!row) return null
    return rowToViewDef(row)
  }

  return { save, loadAll, delete: deleteView, get }
}

function rowToViewDef(row: {
  name: string
  description: string | null
  source: ViewDef['source']
  chain: import('@maisie/shared').ChainStep[]
  component: string
  componentProps: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}): ViewDef {
  return {
    name: row.name,
    description: row.description ?? undefined,
    source: row.source,
    chain: row.chain,
    component: row.component,
    componentProps: row.componentProps ?? undefined,
  }
}
