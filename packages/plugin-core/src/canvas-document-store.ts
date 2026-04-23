/**
 * Persistence layer for canvas documents (work-in-progress compositions).
 *
 * Stores the raw CanvasDocument JSON in the `canvas_documents` table via Drizzle.
 * Uses a simple keyed store — the primary key is an id string; the production
 * singleton is 'default'. Future: per-user keys.
 */

import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'

export interface CanvasDocumentStore {
  save(id: string, document: unknown): Promise<void>
  load(id: string): Promise<unknown | null>
  clear(id: string): Promise<void>
}

export function createCanvasDocumentStore(db: BunSQLiteDatabase<any>): CanvasDocumentStore {
  async function save(id: string, document: unknown): Promise<void> {
    const { canvasDocuments } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    const now = new Date()
    const existing = await db
      .select()
      .from(canvasDocuments)
      .where(eq(canvasDocuments.id, id))
      .get()

    if (existing) {
      await db
        .update(canvasDocuments)
        .set({ document, updatedAt: now })
        .where(eq(canvasDocuments.id, id))
    } else {
      await db.insert(canvasDocuments).values({ id, document, updatedAt: now })
    }
  }

  async function load(id: string): Promise<unknown | null> {
    const { canvasDocuments } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    const row = await db
      .select()
      .from(canvasDocuments)
      .where(eq(canvasDocuments.id, id))
      .get()

    if (!row) return null
    return row.document
  }

  async function clear(id: string): Promise<void> {
    const { canvasDocuments } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    await db.delete(canvasDocuments).where(eq(canvasDocuments.id, id))
  }

  return { save, load, clear }
}
