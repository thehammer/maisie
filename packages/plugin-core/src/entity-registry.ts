import type { EntityDef, MaisiePlugin, PluginAction, ActionTier } from '@maisie/shared'
import { validateEntityDef, inferTier, STD_LIB } from '@maisie/shared'

/**
 * The EntityRegistry holds all entities in the system — base entities
 * synthesized from plugin actions, and derived entities defined by users.
 * It is the single source of truth for the catalog.
 */
export class EntityRegistry {
  private entities = new Map<string, EntityDef>()

  constructor() {
    // Register the synthetic catalog entity. It is always present — its single
    // 'items' data field uses a special sentinel action name that the address
    // resolver intercepts to return the live entity list.
    const catalogEntity: EntityDef = {
      name: 'catalog',
      description: 'The registry of all entities in the system',
      source: 'plugin',
      pluginName: 'core',
      section: 'system',
      fields: {
        items: {
          kind: 'data',
          type: 'collection',
          actionName: '__catalog_items',
        },
      },
    }
    this.entities.set('catalog', catalogEntity)
  }

  /** Register an entity. Throws if validation fails. */
  register(entity: EntityDef): void {
    const errors = validateEntityDef(entity)
    if (errors.length > 0) {
      throw new Error(`Invalid entity "${entity.name}": ${errors.join(', ')}`)
    }

    // Phase 3: infer safety tiers for derived function fields from their expressions.
    // This overrides the conservative 'advise' default set by entity-convert.ts —
    // the default is still the safe fallback when inference can't resolve a reference.
    if (entity.source === 'derived') {
      for (const field of Object.values(entity.fields)) {
        if (field.kind === 'function' && field.expression) {
          field.tier = inferTier(field.expression, (ref) =>
            resolveTierForRef(ref, this.entities),
          )
        }
      }
    }

    this.entities.set(entity.name, entity)
  }

  /** Unregister an entity (used for derived entity CRUD). */
  unregister(name: string): boolean {
    return this.entities.delete(name)
  }

  get(name: string): EntityDef | undefined {
    return this.entities.get(name)
  }

  list(): EntityDef[] {
    return [...this.entities.values()]
  }

  /** Filter entities to those that have a section matching the given value. */
  findBySection(section: string): EntityDef[] {
    return this.list().filter((e) => e.section === section)
  }

  /**
   * Find entities whose fields include the given required shape.
   * Each required field is matched by name, kind ('data'|'function'),
   * and optionally type. An entity matches if for every required field,
   * it has a matching field entry.
   */
  findByInterface(required: Record<string, { kind: 'data' | 'function'; type?: string }>): EntityDef[] {
    return this.list().filter((entity) => {
      for (const [fieldName, req] of Object.entries(required)) {
        const field = entity.fields[fieldName]
        if (!field) return false
        if (field.kind !== req.kind) return false
        if (req.type) {
          const fieldType = field.kind === 'data' ? field.type : field.returnType
          if (fieldType !== req.type) return false
        }
      }
      return true
    })
  }

  /** Clear all entities (for testing). */
  clear(): void {
    this.entities.clear()
  }
}

/**
 * Synthesize an EntityDef from a single PluginAction.
 *
 * Phase 2a uses a 1:1 mapping — each PluginAction becomes one EntityDef
 * with a single primary field. This preserves the existing catalog shape
 * (one card per action) while routing through the entity registry. Later
 * phases can add explicit grouping of related actions into multi-field
 * entities.
 *
 * Data actions (list_, get_, stream_, subscribe_) produce entities with
 * a single data field. Function actions (set_, invoke_, create_, delete_)
 * produce entities with a single function field.
 *
 * The entity's single field is named 'result' — consistent regardless of
 * action verb. The entity id is `{plugin}.{action}` — same as the
 * existing CardDescriptor id.
 */
export function synthesizeEntityFromAction(
  plugin: MaisiePlugin,
  action: PluginAction,
): EntityDef | null {
  // Skip actions that opt out of UI; they still exist as plugin actions
  // but aren't catalog-browsable entities.
  if (action.ui === false) return null

  const isFunctionVerb = /^(set_|invoke_|create_|delete_)/.test(action.name)
  const section = action.ui.section

  const fields: Record<string, EntityDef['fields'][string]> = {}

  if (isFunctionVerb) {
    const tier = action.ai !== false ? action.ai.tier : 'advise'
    fields.result = {
      kind: 'function',
      params: [],  // Phase 2a: params inferred lazily; detailed mapping deferred
      returnType: 'record',
      actionName: action.name,
      tier,
    }
  } else {
    // Determine shape from output schema; for Phase 2a just tag as 'record'
    // (the CardDescriptor introspection in getCardCatalog provides the
    // detailed field list independently). Shape is a loose approximation;
    // refinement comes when output-schema introspection lands in the registry.
    fields.result = {
      kind: 'data',
      type: 'record',
      actionName: action.name,
    }
  }

  return {
    name: `${plugin.name}.${action.name}`,
    description: action.description,
    source: 'plugin',
    pluginName: plugin.name,
    section,
    fields,
  }
}

/**
 * Synthesize all entities for a plugin.
 */
export function synthesizeEntitiesForPlugin(plugin: MaisiePlugin): EntityDef[] {
  const entities: EntityDef[] = []
  for (const action of plugin.actions) {
    const entity = synthesizeEntityFromAction(plugin, action)
    if (entity) entities.push(entity)
  }
  return entities
}

/** Singleton instance. */
export const entityRegistry = new EntityRegistry()

// ── Tier resolution ───────────────────────────────────────────────────────────

/**
 * All known primitive names. Primitives are pure (read-only) operations,
 * so they always resolve to 'inform'.
 */
const KNOWN_PRIMITIVES = new Set([
  'reduce', 'sort', 'append',
  'get', 'set', 'merge',
  'eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith',
  'add', 'sub', 'mul', 'div', 'mod',
  'and', 'or', 'not',
  'concat', 'len', 'str',
  'if', 'identity', 'call',
])

/**
 * Resolve a function reference or address to its safety tier.
 *
 * Resolution order:
 * 1. Known primitives → 'inform' (pure operations)
 * 2. Std lib functions → 'inform' (all std lib is read-only)
 * 3. Entity function fields (dotted path) → field.tier
 * 4. Returns null if the reference cannot be resolved (not a function)
 *
 * Used by inferTier at entity registration time. Takes the entity map as a
 * parameter to avoid relying on the singleton before it is populated.
 */
function resolveTierForRef(
  ref: string,
  entities: Map<string, EntityDef>,
): ActionTier | null {
  // Primitives are inform (pure).
  if (KNOWN_PRIMITIVES.has(ref)) return 'inform'

  // Std lib functions are inform (they're pure higher-order ops).
  if (ref in STD_LIB) return 'inform'

  // Dotted path — try entity.field lookup.
  const lastDot = ref.lastIndexOf('.')
  if (lastDot >= 0) {
    const entityName = ref.slice(0, lastDot)
    const fieldName = ref.slice(lastDot + 1)
    const entity = entities.get(entityName)
    if (entity) {
      const field = entity.fields[fieldName]
      if (field?.kind === 'function') return field.tier
    }
    // Plugin action format is handled via the entity registry (plugin entities
    // are registered before derived entities that reference them).
  }

  return null
}
