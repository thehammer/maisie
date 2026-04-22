/**
 * Address resolver for derived entities.
 *
 * Maps entity addresses like `exterior-lights.switches` to live values by:
 * - Evaluating derived entity field expressions via `evalExprAsync`
 * - Delegating to plugin actions for base entity fields
 *
 * NOTE: `self` references are stubbed for Phase 2b. Derived entity expressions
 * that reference `self.xxx` will receive an empty record for `self`. Full self
 * support with lazy resolution and cycle detection is Phase 3.
 */

import type { AddressResolver, MaisieValue, MaisieRecord, EntityDef, FieldDef } from '@maisie/shared'
import { evalExprAsync, STD_LIB } from '@maisie/shared'
import { entityRegistry } from './entity-registry'
import { registry } from './registry'

// ActionContext is a minimal context object passed to plugin actions.
// In Phase 2b we only need enough for action.execute() to work.
export interface ActionContext {
  [key: string]: unknown
}

/**
 * Create an AddressResolver backed by the entity registry and plugin registry.
 *
 * Address shapes:
 *   "entity-name"                  → the entity itself (all fields resolved)
 *   "entity-name.field-name"       → a single field resolved to its live value
 *   "entity-name.field.sub"        → nested field access (drills into record)
 *
 * Entity names may contain dots (e.g. `home-assistant.list_switches`), so
 * resolution uses longest-prefix matching against the entity registry.
 */
export function createAddressResolver(actionContext: ActionContext): AddressResolver {
  // The resolver object — defined early so it can be passed recursively to evalExprAsync.
  const resolver: AddressResolver = {
    resolve,
    invoke,
  }

  async function resolve(address: string): Promise<MaisieValue> {
    // 1. Local entity match (longest prefix)
    const match = findLongestMatchingEntity(address)
    if (!match) {
      throw new Error(`Unresolved address: "${address}" (no matching entity)`)
    }
    const { entity, remainingPath } = match

    if (remainingPath.length === 0) {
      // Address is the entity itself — return a record of all data fields resolved.
      return resolveEntityRecord(entity)
    }

    const fieldName = remainingPath[0]
    const subPath = remainingPath.slice(1)
    const field = entity.fields[fieldName]
    if (!field) {
      throw new Error(`Field "${fieldName}" not found on entity "${entity.name}"`)
    }

    const value = await resolveField(entity, fieldName, field)

    // Drill into sub-path if present.
    if (subPath.length > 0) {
      return drillInto(value, subPath)
    }
    return value
  }

  async function invoke(address: string, args: MaisieRecord): Promise<MaisieValue> {
    const match = findLongestMatchingEntity(address)
    if (!match) {
      throw new Error(`Unresolved address: "${address}" (no matching entity)`)
    }
    const { entity, remainingPath } = match
    if (remainingPath.length !== 1) {
      throw new Error(`invoke requires an entity.field address, got: "${address}"`)
    }
    const fieldName = remainingPath[0]
    const field = entity.fields[fieldName]
    if (!field) {
      throw new Error(`Field "${fieldName}" not found on entity "${entity.name}"`)
    }
    if (field.kind !== 'function') {
      throw new Error(`Field "${fieldName}" on "${entity.name}" is not a function field`)
    }
    return invokeField(entity, fieldName, field, args)
  }

  async function resolveEntityRecord(entity: EntityDef): Promise<MaisieValue> {
    const result: MaisieRecord = {}
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (field.kind === 'data') {
        result[fieldName] = await resolveField(entity, fieldName, field)
      }
      // Function fields are omitted from the entity record (they're callables, not data)
    }
    return result
  }

  async function resolveField(entity: EntityDef, fieldName: string, field: FieldDef): Promise<MaisieValue> {
    if (field.kind === 'data') {
      if (entity.source === 'plugin') {
        // Invoke the underlying plugin action.
        return invokePluginAction(entity.pluginName!, field.actionName!, {})
      }
      // Derived data field: evaluate the MEL expression.
      if (!field.expression) {
        throw new Error(`Derived field "${fieldName}" on "${entity.name}" has no expression`)
      }
      const env = { self: makeSelfStub(entity) }
      return evalExprAsync(field.expression, resolver, env, STD_LIB)
    }

    // Function field: return a MaisieFunction wrapper.
    // Callers can invoke this via `invoke()` or by calling the returned function.
    return (args: MaisieRecord): MaisieValue => {
      return invokeField(entity, fieldName, field, args) as unknown as MaisieValue
    }
  }

  async function invokePluginAction(
    pluginName: string,
    actionName: string,
    input: MaisieRecord,
  ): Promise<MaisieValue> {
    const registered = registry.getAction(pluginName, actionName)
    if (!registered) {
      throw new Error(`Plugin action not found: ${pluginName}.${actionName}`)
    }
    const result = await registered.action.execute(input as never, actionContext as never)
    return result as MaisieValue
  }

  async function invokeField(
    entity: EntityDef,
    _fieldName: string,
    field: FieldDef,
    args: MaisieRecord,
  ): Promise<MaisieValue> {
    if (field.kind !== 'function') {
      throw new Error(`Not a function field`)
    }
    if (entity.source === 'plugin') {
      return invokePluginAction(entity.pluginName!, field.actionName!, args)
    }
    // Derived function: evaluate its expression with args and self in env.
    if (!field.expression) {
      throw new Error(`Derived function field has no expression`)
    }
    const env = { ...args, self: makeSelfStub(entity) }
    return evalExprAsync(field.expression, resolver, env, STD_LIB)
  }

  /**
   * Find the longest entity name that is a prefix of the given address.
   * Entity names may contain dots (e.g. `home-assistant.list_switches`), so
   * we must try all registered entity names and pick the longest match.
   *
   * Returns: { entity, remainingPath } where remainingPath is the dot-split
   * suffix after the entity name.
   */
  function findLongestMatchingEntity(
    address: string,
  ): { entity: EntityDef; remainingPath: string[] } | null {
    const entities = entityRegistry.list()
    let best: { entity: EntityDef; remainingPath: string[] } | null = null
    let bestLen = -1

    for (const entity of entities) {
      const prefix = entity.name
      if (address === prefix) {
        // Exact match — no remaining path.
        if (prefix.length > bestLen) {
          bestLen = prefix.length
          best = { entity, remainingPath: [] }
        }
      } else if (address.startsWith(prefix + '.')) {
        const rest = address.slice(prefix.length + 1)
        if (prefix.length > bestLen) {
          bestLen = prefix.length
          best = { entity, remainingPath: rest.split('.') }
        }
      }
    }

    return best
  }

  /**
   * Drill into a value using a sequence of field names.
   * Returns null if any step in the chain is null/undefined.
   */
  function drillInto(value: MaisieValue, path: string[]): MaisieValue {
    let current = value
    for (const key of path) {
      if (current == null || typeof current !== 'object' || Array.isArray(current)) {
        return null
      }
      current = (current as MaisieRecord)[key] ?? null
    }
    return current
  }

  /**
   * Phase 2b stub for `self` references in derived entity expressions.
   *
   * Returns an empty record. Derived entity expressions must not use `self.xxx`
   * in Phase 2b — those references will silently resolve to null. Full `self`
   * support (lazy resolution, cycle detection) lands in Phase 3.
   */
  function makeSelfStub(_entity: EntityDef): MaisieValue {
    // Phase 3: replace with a lazy proxy that resolves entity fields on demand.
    return {} as MaisieValue
  }

  return resolver
}
