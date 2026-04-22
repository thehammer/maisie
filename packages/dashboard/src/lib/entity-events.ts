/**
 * Entity invalidation event bus — dashboard side.
 *
 * The App's MQTT handler detects home/entity/{name}/invalidated topics and
 * calls notifyEntityInvalidated(name). Hooks subscribe via onEntityInvalidated.
 *
 * This is a simple in-process pub/sub: no external dependencies, no context,
 * no React state. Listeners register by entity name and receive a callback
 * when that entity is invalidated.
 */

type Listener = () => void

const listeners = new Map<string, Set<Listener>>()

/**
 * Subscribe to invalidation events for a single entity.
 * Returns an unsubscribe function — call it in useEffect cleanup.
 */
export function onEntityInvalidated(entityName: string, listener: Listener): () => void {
  if (!listeners.has(entityName)) listeners.set(entityName, new Set())
  listeners.get(entityName)!.add(listener)
  return () => listeners.get(entityName)?.delete(listener)
}

/**
 * Notify all subscribers that the given entity has been invalidated.
 * Called by the App's MQTT message handler.
 */
export function notifyEntityInvalidated(entityName: string): void {
  listeners.get(entityName)?.forEach((l) => l())
}
