import type { CardConfig } from './types'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'

export const DEFAULT_WIDGET_ORDER: CardConfig[] = [
  { id: 'ServiceStatus',         visible: true,  col_span: 1, order: 0  },
  { id: 'NetworkCard',           visible: true,  col_span: 1, order: 1  },
  { id: 'NasCard',               visible: true,  col_span: 1, order: 2  },
  { id: 'PlexCard',              visible: true,  col_span: 1, order: 3  },
  { id: 'MediaCard',             visible: true,  col_span: 1, order: 4  },
  { id: 'HdhrCard',              visible: true,  col_span: 1, order: 5  },
  { id: 'DakboardCard',          visible: true,  col_span: 1, order: 6  },
  { id: 'BambuCard',             visible: true,  col_span: 1, order: 7  },
  { id: 'CalibreCard',           visible: true,  col_span: 1, order: 8  },
  { id: 'CalibreEnrichmentCard', visible: true,  col_span: 1, order: 9  },
  { id: 'NightlyCard',           visible: true,  col_span: 1, order: 10 },
  { id: 'YouTubeCleanupCard',    visible: true,  col_span: 1, order: 11 },
  { id: 'PackagesCard',          visible: true,  col_span: 1, order: 12 },
  { id: 'RecentlyAddedCard',     visible: true,  col_span: 2, order: 13 },
  { id: 'SmartHomeCard',         visible: true,  col_span: 1, order: 14 },
]

export function createLayoutService(db: BunSQLiteDatabase<any>) {
  async function getLayout(page: string): Promise<CardConfig[]> {
    const { dashboardLayouts } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')

    const row = await db
      .select()
      .from(dashboardLayouts)
      .where(eq(dashboardLayouts.page, page))
      .get()

    if (!row) return [...DEFAULT_WIDGET_ORDER]

    const parsed = JSON.parse(row.widgets) as CardConfig[]
    // Ensure any widgets added since the layout was saved are appended
    const knownIds = new Set(parsed.map((w) => w.id))
    const missing = DEFAULT_WIDGET_ORDER
      .filter((w) => !knownIds.has(w.id))
      .map((w, i) => ({ ...w, order: parsed.length + i }))

    return [...parsed, ...missing].sort((a, b) => a.order - b.order)
  }

  async function updateLayout(page: string, widgets: CardConfig[]): Promise<void> {
    const { dashboardLayouts } = await import('../../agent/src/services/schema')
    const { eq } = await import('drizzle-orm')
    const { randomUUID } = await import('crypto')

    const sorted = [...widgets].sort((a, b) => a.order - b.order)
    const json = JSON.stringify(sorted)
    const now = new Date()

    const existing = await db
      .select()
      .from(dashboardLayouts)
      .where(eq(dashboardLayouts.page, page))
      .get()

    if (existing) {
      await db
        .update(dashboardLayouts)
        .set({ widgets: json, updatedAt: now })
        .where(eq(dashboardLayouts.page, page))
    } else {
      await db.insert(dashboardLayouts).values({
        id: randomUUID(),
        page,
        widgets: json,
        updatedAt: now,
      })
    }
  }

  async function patchWidget(
    page: string,
    id: string,
    patch: Partial<Pick<CardConfig, 'visible' | 'col_span'>>,
  ): Promise<CardConfig[]> {
    const current = await getLayout(page)
    const updated = current.map((w) => (w.id === id ? { ...w, ...patch } : w))
    await updateLayout(page, updated)
    return updated
  }

  async function reorderWidgets(page: string, orderedIds: string[]): Promise<CardConfig[]> {
    const current = await getLayout(page)
    const idSet = new Set(orderedIds)

    // Widgets explicitly listed get their new order; rest stay appended
    const reordered = orderedIds
      .map((id, i) => {
        const w = current.find((c) => c.id === id)
        return w ? { ...w, order: i } : null
      })
      .filter((w): w is CardConfig => w !== null)

    const trailing = current
      .filter((w) => !idSet.has(w.id))
      .map((w, i) => ({ ...w, order: orderedIds.length + i }))

    const result = [...reordered, ...trailing]
    await updateLayout(page, result)
    return result
  }

  return { getLayout, updateLayout, patchWidget, reorderWidgets }
}

export type LayoutService = ReturnType<typeof createLayoutService>
