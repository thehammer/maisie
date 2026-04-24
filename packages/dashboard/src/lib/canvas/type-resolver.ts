/**
 * Type resolution for canvas placements.
 *
 * Fetches entity and component definitions from the server and derives
 * the TypeExpr at each port (output for entities, input/props for components).
 */

import type { TypeExpr, ComponentDef } from '@maisie/shared'
import type { EntityDef, DataFieldDef } from '@maisie/shared'
import { dataFieldTypeExpr, getFunctionDescriptor, inferFunctionOutput } from '@maisie/shared'

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
 * Resolve ports for a function placement from the static FunctionDescriptor registry.
 * Function placements have both an input port (left) and an output port (right).
 * Returns null if the function id is unknown.
 *
 * The output type here is the static fallback (no upstream or params known).
 * Canvas.tsx computes the refined inferred output via inferFunctionOutput when
 * the input port is wired.
 */
export function resolveFunctionPorts(functionId: string): PlacementPorts | null {
  const descriptor = getFunctionDescriptor(functionId)
  if (!descriptor) return null
  // Resolve static output (no upstream, no params) as the port's declared type.
  // The inferencer returns any/collection<any> for input-relative specs without context.
  const staticOutput = inferFunctionOutput(descriptor, undefined, {})
  return {
    input: descriptor.input,
    output: staticOutput,
  }
}

/**
 * Derive an output TypeExpr from an entity's fields.
 * Strategy: if there's a single data field named 'result', use its type.
 * Otherwise construct a record type from all data fields.
 *
 * Uses dataFieldTypeExpr() to handle both legacy string types and richer
 * TypeExpr values that come from zodToTypeExpr (Phase 3g).
 */
function inferEntityOutput(entity: EntityDef): TypeExpr | undefined {
  const dataFields = Object.entries(entity.fields).filter(([, f]) => f.kind === 'data')
  if (dataFields.length === 0) return undefined

  // 1:1 plugin bridge — single 'result' field
  if (dataFields.length === 1 && dataFields[0][0] === 'result') {
    const f = dataFields[0][1] as DataFieldDef
    return dataFieldTypeExpr(f.type)
  }

  // Multi-field entity — record shape
  const fields: Record<string, TypeExpr> = {}
  for (const [name, f] of dataFields) {
    fields[name] = dataFieldTypeExpr((f as DataFieldDef).type)
  }
  return { kind: 'record', fields }
}
