/**
 * Persistence layer for derived components.
 *
 * Stores ComponentDef records in the `derived_components` SQLite table via
 * Drizzle. Mirrors the pattern of derived-entity-store.ts: lazy schema import,
 * Drizzle queries, upsert on save.
 */

import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import type { ComponentDef } from '@maisie/shared'

export interface DerivedComponentStore {
  save(component: ComponentDef): Promise<void>
  loadAll(): Promise<ComponentDef[]>
  delete(name: string): Promise<void>
  get(name: string): Promise<ComponentDef | null>
}

export function createDerivedComponentStore(db: BunSQLiteDatabase<any>): DerivedComponentStore {
  async function save(component: ComponentDef): Promise<void> {
    const { derivedComponents } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    const now = new Date()

    const existing = await db
      .select()
      .from(derivedComponents)
      .where(eq(derivedComponents.name, component.name))
      .get()

    if (existing) {
      await db
        .update(derivedComponents)
        .set({
          description: component.description ?? null,
          input: component.input ?? null,
          props: (component.props as Record<string, unknown>) ?? null,
          render: component.render ?? null,
          updatedAt: now,
        })
        .where(eq(derivedComponents.name, component.name))
    } else {
      await db.insert(derivedComponents).values({
        name: component.name,
        description: component.description ?? null,
        input: component.input ?? null,
        props: (component.props as Record<string, unknown>) ?? null,
        render: component.render ?? null,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  async function loadAll(): Promise<ComponentDef[]> {
    const { derivedComponents } = await import('../../agent/src/services/schema')

    const rows = await db.select().from(derivedComponents).all()
    return rows.map(rowToComponentDef)
  }

  async function deleteComponent(name: string): Promise<void> {
    const { derivedComponents } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    await db.delete(derivedComponents).where(eq(derivedComponents.name, name))
  }

  async function get(name: string): Promise<ComponentDef | null> {
    const { derivedComponents } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    const row = await db
      .select()
      .from(derivedComponents)
      .where(eq(derivedComponents.name, name))
      .get()

    if (!row) return null
    return rowToComponentDef(row)
  }

  return { save, loadAll, delete: deleteComponent, get }
}

function rowToComponentDef(row: {
  name: string
  description: string | null
  input: unknown
  props: Record<string, unknown> | null
  render: unknown
  createdAt: Date
  updatedAt: Date
}): ComponentDef {
  return {
    name: row.name,
    kind: 'derived',
    description: row.description ?? undefined,
    input: row.input != null ? (row.input as ComponentDef['input']) : undefined,
    props: row.props != null ? (row.props as ComponentDef['props']) : undefined,
    render: row.render as ComponentDef['render'],
  }
}
