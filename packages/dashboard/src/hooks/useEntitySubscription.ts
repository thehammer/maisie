import { useEffect, useState } from "react";
import { onEntityInvalidated } from "../lib/entity-events";

/**
 * Subscribe to an entity's invalidation events via the MQTT bridge.
 * Returns a tick counter that increments on each invalidation — cards use it
 * as a useEffect dependency to trigger re-fetches.
 *
 * Usage:
 *   const tick = useEntitySubscription("exterior-lights")
 *   useEffect(() => { refetch() }, [tick])
 *
 * Pass null to opt out (e.g. when the entity name is not yet known).
 */
export function useEntitySubscription(entityName: string | null): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!entityName) return;
    return onEntityInvalidated(entityName, () => setTick((n) => n + 1));
  }, [entityName]);

  return tick;
}
