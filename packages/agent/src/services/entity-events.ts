/**
 * Entity event bridge — watches MQTT plugin events and publishes invalidation
 * notices for derived entities that depend on the triggering base entity.
 *
 * Topic format for invalidation events: home/entity/{entityName}/invalidated
 * Payload: { at: number, trigger: string }
 *
 * How it works:
 *   1. Subscribe to home/# (all events).
 *   2. On each message, extract the plugin name from the topic.
 *   3. For every base entity that belongs to that plugin, walk the dependency
 *      graph and publish invalidation events for all transitively-derived
 *      entities.
 *
 * This is deliberately coarse (plugin-wide invalidation). A precise approach
 * would require an explicit `invalidates` field on PluginEvent that names
 * specific base entity addresses — that's a Phase 5+ refinement.
 */

import { entityRegistry } from '@maisie/plugin-core'
import { entityDependencyGraph } from '@maisie/plugin-core/src/entity-dependency-graph'
import { subscribe, publish } from './mqtt'

/** MQTT topic for entity invalidation events. */
export function entityInvalidatedTopic(entityName: string): string {
  return `home/entity/${entityName}/invalidated`
}

/**
 * Start the entity event bridge. Must be called after MQTT is connected and
 * all plugins/entities are loaded.
 */
export function startEntityEventBridge(): void {
  subscribe('home/#', (_payload, topic) => {
    const parts = topic.split('/')
    if (parts.length < 3 || parts[0] !== 'home') return

    // Skip entity-invalidated events to avoid feedback loops
    if (parts[1] === 'entity') return

    const pluginName = parts[1]

    // Coarse invalidation: find every base entity for this plugin and invalidate
    // all derived entities that depend on any of them (transitively).
    //
    // Phase 5+ refinement: add `invalidates?: string[]` to PluginEvent so
    // events can declare exactly which base entity addresses they affect,
    // enabling precise per-entity invalidation instead of plugin-wide.
    const invalidated = new Set<string>()
    for (const entity of entityRegistry.list()) {
      if (entity.source === 'plugin' && entity.pluginName === pluginName) {
        for (const derived of entityDependencyGraph.transitiveDependentsOf(entity.name)) {
          invalidated.add(derived)
        }
      }
    }

    for (const derivedName of invalidated) {
      publish(entityInvalidatedTopic(derivedName), {
        at: Date.now(),
        trigger: topic,
      })
    }
  })
}
