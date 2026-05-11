/**
 * Loads persisted views from the database into the view registry at agent startup.
 *
 * Called once after the database is initialized, before the API starts.
 * Views that fail validation are logged and skipped (not fatal).
 *
 * Also exposes seedBuiltInViews() which inserts platform-shipped ViewDefs that
 * have not yet been stored (idempotent — skips existing entries).
 */

import { viewRegistry } from '@maisie/plugin-core'
import { createViewStore } from '@maisie/plugin-core/src/view-store'
import { views } from './schema'
import { eq } from 'drizzle-orm'
import type { getDb } from './db'

type Db = ReturnType<typeof getDb>

/** Built-in views shipped with the platform — seeded once at first boot */
const BUILT_IN_VIEWS = [
  {
    name: 'services-status',
    description: 'Health status of all connected services',
    source: { entity: 'services', field: 'status', endpoint: '/api/services/status' },
    chain: [] as unknown[],
    component: 'service-chips',
    componentProps: {} as Record<string, unknown>,
  },
  {
    name: 'youtube-cleanup',
    description: 'YouTube cleanup status — likes and subs remaining, progress',
    source: { entity: 'youtube', field: 'cleanup', endpoint: '/api/youtube/cleanup/status' },
    chain: [] as unknown[],
    component: 'json',
    componentProps: { expanded: true } as Record<string, unknown>,
    // Wave 5 follow-up: expose runCleanup as an ai.tier:'act' PluginAction so the
    // agent persona can trigger it. The ViewCard component will surface a button
    // via the agentic invoke pattern once that tier is implemented.
  },
  {
    name: 'now-playing',
    description: 'Plex currently-playing sessions',
    source: { entity: 'plex', field: 'nowPlaying', endpoint: '/api/plex/now-playing' },
    chain: [] as unknown[],
    component: 'json',
    componentProps: { expanded: false } as Record<string, unknown>,
  },
  {
    name: 'network-summary',
    description: 'UniFi network device summary — counts, alerts, misplaced IoT',
    source: { entity: 'network', field: 'summary', endpoint: '/api/devices/summary' },
    chain: [] as unknown[],
    component: 'json',
    componentProps: { expanded: true } as Record<string, unknown>,
  },
] as const

/**
 * Seed built-in views that do not yet exist in the database.
 * Called once during agent startup, after the database is initialised.
 */
export async function seedBuiltInViews(db: Db): Promise<void> {
  for (const def of BUILT_IN_VIEWS) {
    const existing = await db
      .select({ name: views.name })
      .from(views)
      .where(eq(views.name, def.name))
      .get()
    if (!existing) {
      await db.insert(views).values({
        name: def.name,
        description: def.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        source: def.source as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chain: def.chain as any,
        component: def.component,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        componentProps: def.componentProps as any,
      })
      console.log(`  ✓ View seeded: ${def.name}`)
    }
  }
}

export async function loadViewsIntoRegistry(db: unknown): Promise<void> {
  const store = createViewStore(db as any)
  let loaded = 0
  let failed = 0

  try {
    const views = await store.loadAll()
    for (const view of views) {
      try {
        viewRegistry.register(view)
        loaded++
      } catch (err) {
        console.warn(`[view-loader] skipping "${view.name}": ${err}`)
        failed++
      }
    }
    if (loaded > 0 || failed > 0) {
      console.log(`  ✓ Loaded ${loaded} view${loaded !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`)
    }
  } catch (err) {
    console.warn(`[view-loader] failed to load views: ${err}`)
  }
}
