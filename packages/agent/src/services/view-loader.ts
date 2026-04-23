/**
 * Loads persisted views from the database into the view registry at agent startup.
 *
 * Called once after the database is initialized, before the API starts.
 * Views that fail validation are logged and skipped (not fatal).
 */

import { viewRegistry } from '@maisie/plugin-core'
import { createViewStore } from '@maisie/plugin-core/src/view-store'

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
