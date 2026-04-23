/**
 * Address resolver for derived entities.
 *
 * Maps entity addresses like `exterior-lights.switches` to live values by:
 * - Evaluating derived entity field expressions via `evalExprAsync`
 * - Delegating to plugin actions for base entity fields
 *
 * Phase 3: `self` references in derived entity expressions are resolved by
 * pre-populating a record of all data fields and function wrappers before the
 * field expression runs. Cycle detection prevents infinite recursion when field
 * A depends on self.B which depends on self.A.
 */

import type { AddressResolver, MaisieValue, MaisieRecord, MaisieFunction, EntityDef, FieldDef, ExprNode } from '@maisie/shared'
import { evalExprAsync, STD_LIB } from '@maisie/shared'
import { entityRegistry } from './entity-registry'
import { registry } from './registry'

// ActionContext is a minimal context object passed to plugin actions.
// In Phase 2b we only need enough for action.execute() to work.

/** Tracks which entity fields are currently being resolved (for cycle detection). */
interface ResolutionFrame {
  entityName: string
  fieldName: string
}

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

  async function resolveField(
    entity: EntityDef,
    fieldName: string,
    field: FieldDef,
    resolutionStack: ResolutionFrame[] = [],
  ): Promise<MaisieValue> {
    if (field.kind === 'data') {
      if (entity.source === 'plugin') {
        // Invoke the underlying plugin action.
        return invokePluginAction(entity.pluginName!, field.actionName!, {})
      }
      // Derived data field: evaluate the MEL expression with self in scope.
      if (!field.expression) {
        throw new Error(`Derived field "${fieldName}" on "${entity.name}" has no expression`)
      }
      const frame: ResolutionFrame = { entityName: entity.name, fieldName }
      if (resolutionStack.some((f) => f.entityName === frame.entityName && f.fieldName === frame.fieldName)) {
        throw new Error(`Cycle detected in entity "${entity.name}" field "${fieldName}"`)
      }
      // Push current field to stack BEFORE building self.
      // buildSelfRecord uses this stack to detect when the expression of another field
      // would circularly re-enter the current field's resolution.
      const newStack = [...resolutionStack, frame]

      // Only build `self` if the expression actually references it. This avoids
      // the eager-resolution overhead for simple literal/non-self fields.
      let env: Record<string, MaisieValue> = {}
      if (expressionReferencesSelf(field.expression)) {
        // Pass `fieldName` so buildSelfRecord knows which field is "current" and
        // should be skipped (not a cycle — just the field resolving itself).
        const selfRecord = await buildSelfRecord(entity, newStack, fieldName)
        env = { self: selfRecord }
      }
      return evalExprAsync(field.expression, resolver, env, STD_LIB)
    }

    // Function field: return a MaisieFunction wrapper.
    // Callers can invoke this via `invoke()` or by calling the returned function.
    return (args: MaisieRecord): MaisieValue => {
      return invokeField(entity, fieldName, field, args, resolutionStack) as unknown as MaisieValue
    }
  }

  async function invokePluginAction(
    pluginName: string,
    actionName: string,
    input: MaisieRecord,
  ): Promise<MaisieValue> {
    // Special sentinel: return the live entity list as entity descriptors.
    if (actionName === '__catalog_items') {
      return entityRegistry.list().map(entityToDescriptor) as MaisieValue
    }

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
    resolutionStack: ResolutionFrame[] = [],
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
    let env: Record<string, MaisieValue> = { ...args }
    if (expressionReferencesSelf(field.expression)) {
      // Function fields are invoked (not resolved), so no frame for _fieldName
      // is in the stack — pass null as currentFieldName.
      const selfRecord = await buildSelfRecord(entity, resolutionStack, null)
      env = { ...args, self: selfRecord }
    }
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
   * Build a `self` record for use in derived entity field expressions.
   *
   * Pre-resolves all data fields (using the resolution stack for cycle detection) and
   * wraps all function fields as callable MaisieFunctions. This gives expressions
   * access to `self.fieldName` for any field on the entity.
   *
   * `currentFieldName` is the field whose expression is about to be evaluated. It
   * will always appear in `resolutionStack` — but this is expected (not a cycle),
   * so we skip it with a null placeholder rather than throwing. Any OTHER field in
   * the stack indicates a real cycle and throws immediately.
   */
  async function buildSelfRecord(
    entity: EntityDef,
    resolutionStack: ResolutionFrame[],
    currentFieldName: string | null,
  ): Promise<MaisieRecord> {
    const record: MaisieRecord = {}

    for (const [name, field] of Object.entries(entity.fields)) {
      if (field.kind === 'data') {
        const inStack = resolutionStack.some(
          (f) => f.entityName === entity.name && f.fieldName === name,
        )
        if (inStack) {
          if (name === currentFieldName) {
            // The current field being resolved is always in the stack.
            // Provide a null placeholder — accessing self.currentField within its
            // own expression is unusual but not inherently a cycle.
            record[name] = null
          } else {
            // A different field is in the stack while we're trying to include it
            // in self. This is a real cycle: the chain of self references loops back.
            throw new Error(`Cycle detected in entity "${entity.name}" field "${name}"`)
          }
          continue
        }
        record[name] = await resolveField(entity, name, field, resolutionStack)
      } else {
        // Function field — wrap as a callable MaisieFunction.
        // The closure captures `name` and `field` per iteration.
        const capturedField = field
        const capturedName = name
        record[capturedName] = ((args: MaisieRecord): MaisieValue => {
          return invokeField(entity, capturedName, capturedField, args, resolutionStack) as unknown as MaisieValue
        }) as MaisieFunction
      }
    }

    return record
  }

  return resolver
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert an EntityDef to a plain descriptor record suitable for MEL queries.
 * This is the value shape returned by `catalog.items`.
 */
function entityToDescriptor(entity: EntityDef): MaisieRecord {
  return {
    name: entity.name,
    description: entity.description ?? null,
    source: entity.source,
    section: entity.section ?? null,
    pluginName: entity.pluginName ?? null,
    fields: Object.fromEntries(
      Object.entries(entity.fields).map(([k, f]) => [
        k,
        { kind: f.kind, type: f.kind === 'data' ? f.type : f.returnType },
      ]),
    ),
  } as MaisieRecord
}

/**
 * Returns true if the expression tree contains a RefNode named 'self'.
 * Used to skip the expensive `buildSelfRecord` call for expressions that
 * don't reference self at all (most base expressions like literals and
 * external entity refs).
 */
function expressionReferencesSelf(node: ExprNode): boolean {
  switch (node.kind) {
    case 'literal':
      return false
    case 'ref':
      return node.name === 'self'
    case 'lambda':
      return expressionReferencesSelf(node.body)
    case 'apply':
      return node.args.some(expressionReferencesSelf)
    case 'let':
      return node.bindings.some((b) => expressionReferencesSelf(b.value)) ||
        expressionReferencesSelf(node.body)
    case 'pipe':
      return expressionReferencesSelf(node.value) ||
        node.steps.some(expressionReferencesSelf)
    case 'component-call':
    case 'layout-call':
      return Object.values(node.args).some(expressionReferencesSelf)
  }
}
