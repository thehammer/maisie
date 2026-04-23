/**
 * Loads persisted derived components from the database into the component
 * registry at agent startup.
 *
 * Called once after the database is initialized. Components that fail
 * validation are logged and skipped (not fatal).
 */

import { componentRegistry } from '@maisie/plugin-core'
import { createDerivedComponentStore } from '@maisie/plugin-core/src/derived-component-store'

export async function loadDerivedComponents(db: unknown): Promise<void> {
  const store = createDerivedComponentStore(db as any)
  let loaded = 0
  let failed = 0

  try {
    const components = await store.loadAll()
    for (const c of components) {
      try {
        componentRegistry.register(c)
        loaded++
      } catch (err) {
        console.warn(`[component-loader] skipping "${c.name}": ${err}`)
        failed++
      }
    }
    if (loaded > 0 || failed > 0) {
      console.log(
        `  ✓ Loaded ${loaded} derived component${loaded !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`,
      )
    }
  } catch (err) {
    console.warn(`[component-loader] failed to load components: ${err}`)
  }
}
