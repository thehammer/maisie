/**
 * AddressResolver — resolves MEL (Maisie Expression Language) addresses to data.
 *
 * An address is a dotted path: "<entity>.<field>", e.g. "services.status".
 * The resolver looks up the entity and field in the EntityRegistry, then dispatches
 * to the appropriate data provider:
 *   - Sentinel actions (starting with __) are handled inline here
 *   - Plugin actions are dispatched to the plugin action router (future work)
 */

import { entityRegistry } from "./entity-registry";

export type MaisieValue =
  | string
  | number
  | boolean
  | null
  | MaisieValue[]
  | { [key: string]: MaisieValue };

/**
 * Resolve a dotted entity address to its current value.
 *
 * @param address   Dot-separated address, e.g. "services.status"
 * @param baseUrl   Agent base URL, defaults to http://localhost:3001
 */
export async function resolveAddress(
  address: string,
  baseUrl = process.env.AGENT_BASE_URL ?? "http://localhost:3001",
): Promise<MaisieValue> {
  const dotIdx = address.indexOf(".");
  if (dotIdx === -1) {
    throw new Error(`Invalid address (no field separator): ${address}`);
  }
  const entityName = address.slice(0, dotIdx);
  const fieldName = address.slice(dotIdx + 1);

  const entity = entityRegistry.get(entityName);
  if (!entity) throw new Error(`Entity not found: ${entityName}`);

  const field = entity.fields[fieldName];
  if (!field) throw new Error(`Field not found: ${entityName}.${fieldName}`);

  return invokeAction(field.actionName, baseUrl);
}

/** Dispatch an action name to its concrete data provider */
async function invokeAction(
  actionName: string,
  baseUrl: string,
): Promise<MaisieValue> {
  // Sentinel dispatch — hardcoded handlers for built-in data sources
  if (actionName === "__services_status") {
    const res = await fetch(`${baseUrl}/api/services/status`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new Error(`Services status fetch failed: HTTP ${res.status}`);
    }
    return res.json() as Promise<MaisieValue>;
  }

  throw new Error(`No handler registered for action: ${actionName}`);
}
