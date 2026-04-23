import type { MaisieFieldType } from './field'
import type { TypeExpr } from './component'
import type { ExprNode } from './ops'

/**
 * An entity is the fundamental unit of the Maisie system. It has a name,
 * optional description, and a set of typed fields. Base entities come from
 * plugins (their fields resolve via API calls). Derived entities come from
 * user-written MEL expressions (their fields resolve via expression evaluation).
 */
export interface EntityDef {
  name: string
  description?: string
  source: 'plugin' | 'derived'
  pluginName?: string        // present when source === 'plugin'
  section?: string           // for catalog grouping
  fields: Record<string, FieldDef>
}

export type FieldDef = DataFieldDef | FunctionFieldDef

export interface DataFieldDef {
  kind: 'data'
  /** Either a coarse string label (legacy) or a full TypeExpr for structural matching. */
  type: MaisieFieldType | 'record' | 'collection' | TypeExpr
  /** MEL expression defining this field (derived entities only). */
  expression?: ExprNode
  /** Plugin action name this field wraps (plugin entities only). */
  actionName?: string
}

export interface FunctionFieldDef {
  kind: 'function'
  params: Array<{ name: string; type: MaisieFieldType }>
  returnType: MaisieFieldType | 'record' | 'collection'
  /** MEL expression defining this function's body (derived entities only). */
  expression?: ExprNode
  /** Plugin action name this function wraps (plugin entities only). */
  actionName?: string
  /** Safety tier for agent invocation. */
  tier: 'inform' | 'advise' | 'act'
}

/**
 * Convert a DataFieldDef's type to a TypeExpr. String forms are converted
 * with a best-effort fallback; TypeExpr values pass through unchanged.
 */
export function dataFieldTypeExpr(type: DataFieldDef['type']): TypeExpr {
  if (typeof type === 'string') {
    if (type === 'record') return { kind: 'record', fields: {} }
    if (type === 'collection') return { kind: 'collection', element: { kind: 'any' } }
    return { kind: 'scalar', type: type as MaisieFieldType }
  }
  return type
}

/**
 * Validation result: empty array on success, or an array of error messages.
 */
export function validateEntityDef(entity: EntityDef): string[] {
  const errors: string[] = []

  if (!entity.name || entity.name.length === 0) {
    errors.push('entity name is required')
  } else if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(entity.name)) {
    errors.push(`invalid entity name: "${entity.name}"`)
  }

  if (entity.source === 'plugin' && !entity.pluginName) {
    errors.push('plugin entities must have pluginName')
  }

  if (Object.keys(entity.fields).length === 0) {
    errors.push('entity must have at least one field')
  }

  const reserved = new Set(['self', 'description'])
  for (const [fieldName, field] of Object.entries(entity.fields)) {
    if (reserved.has(fieldName)) {
      errors.push(`field name "${fieldName}" is reserved`)
    }
    if (field.kind === 'data') {
      if (entity.source === 'plugin' && !field.actionName) {
        errors.push(`field "${fieldName}": plugin data field must have actionName`)
      }
      if (entity.source === 'derived' && !field.expression) {
        errors.push(`field "${fieldName}": derived data field must have expression`)
      }
    } else if (field.kind === 'function') {
      if (entity.source === 'plugin' && !field.actionName) {
        errors.push(`field "${fieldName}": plugin function field must have actionName`)
      }
      if (entity.source === 'derived' && !field.expression) {
        errors.push(`field "${fieldName}": derived function field must have expression`)
      }
      if (!['inform', 'advise', 'act'].includes(field.tier)) {
        errors.push(`field "${fieldName}": invalid tier "${field.tier}"`)
      }
    }
  }

  return errors
}
