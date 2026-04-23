/**
 * Type resolution for canvas placements.
 *
 * Fetches entity and component definitions from the server and derives
 * the TypeExpr at each port (output for entities, input/props for components).
 */

import type { TypeExpr, ComponentDef } from '@maisie/shared'
import type { EntityDef } from '@maisie/shared'

export interface PlacementPorts {
  /** Output type — the type this placement produces. Undefined if not applicable. */
  output?: TypeExpr
  /** Input type — what this placement consumes at its primary input. */
  input?: TypeExpr
  /** Per-prop types for component placements. */
  props?: Record<string, TypeExpr>
}

/**
 * Fetch the entity definition from the server and extract its ports.
 * Plugin entities (1:1 bridge) have a single 'result' data field that represents
 * the entity's output. Derived entities expose their declared fields as the output.
 */
export async function resolveEntityPorts(entityName: string): Promise<PlacementPorts | null> {
  try {
    const res = await fetch(`/api/entities/${encodeURIComponent(entityName)}`)
    if (!res.ok) return null
    const entity: EntityDef = await res.json()
    const output = inferEntityOutput(entity)
    return { output }
  } catch {
    return null
  }
}

/**
 * Fetch the component definition and extract its input + per-prop types.
 */
export async function resolveComponentPorts(componentName: string): Promise<PlacementPorts | null> {
  try {
    const res = await fetch(`/api/components/${encodeURIComponent(componentName)}`)
    if (!res.ok) return null
    const component: ComponentDef = await res.json()
    const props: Record<string, TypeExpr> = {}
    if (component.props) {
      for (const [name, decl] of Object.entries(component.props)) {
        props[name] = decl.type
      }
    }
    return {
      input: component.input,
      props: Object.keys(props).length > 0 ? props : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Derive an output TypeExpr from an entity's fields.
 * Strategy: if there's a single data field named 'result', use its type.
 * Otherwise construct a record type from all data fields.
 */
function inferEntityOutput(entity: EntityDef): TypeExpr | undefined {
  const dataFields = Object.entries(entity.fields).filter(([, f]) => f.kind === 'data')
  if (dataFields.length === 0) return undefined

  // 1:1 plugin bridge — single 'result' field
  if (dataFields.length === 1 && dataFields[0][0] === 'result') {
    const field = dataFields[0][1] as { kind: 'data'; type: string }
    return fieldTypeToTypeExpr(field.type)
  }

  // Multi-field entity — record shape
  const fields: Record<string, TypeExpr> = {}
  for (const [name, f] of dataFields) {
    const field = f as { kind: 'data'; type: string }
    const t = fieldTypeToTypeExpr(field.type)
    if (t) fields[name] = t
  }
  return { kind: 'record', fields }
}

function fieldTypeToTypeExpr(type: string): TypeExpr | undefined {
  if (type === 'collection') return { kind: 'collection', element: { kind: 'any' } }
  if (type === 'record') return { kind: 'record', fields: {} }
  // Assume scalar — cast to the scalar type union
  return { kind: 'scalar', type: type as import('@maisie/shared').MaisieFieldType }
}
