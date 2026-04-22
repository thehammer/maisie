/**
 * Loads persisted derived entities from the database into the entity registry
 * at agent startup.
 *
 * Called once after the database is initialized, before plugins are loaded.
 * Entities that fail validation are logged and skipped (not fatal).
 */

import { entityRegistry } from '@maisie/plugin-core'
import { createDerivedEntityStore } from '@maisie/plugin-core/src/derived-entity-store'

export async function loadDerivedEntities(db: unknown): Promise<void> {
  const store = createDerivedEntityStore(db as any)
  let loaded = 0
  let failed = 0

  try {
    const entities = await store.loadAll()
    for (const entity of entities) {
      try {
        entityRegistry.register(entity)
        loaded++
      } catch (err) {
        console.warn(`[entity-loader] skipping "${entity.name}": ${err}`)
        failed++
      }
    }
    if (loaded > 0 || failed > 0) {
      console.log(`  ✓ Loaded ${loaded} derived entity${loaded !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`)
    }
    // Rebuild the dependency graph after all entities are loaded so that
    // ordering issues (derived loaded before its base) are resolved.
    entityRegistry.rebuildGraph()
  } catch (err) {
    console.warn(`[entity-loader] failed to load derived entities: ${err}`)
  }
}
