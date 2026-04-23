import type { MaisieFieldType } from './field'
import type { MaisieValue, ExprNode } from './ops'

// ── TypeExpr — the structural type language ────────────────────────────────

export type TypeExpr =
  | ScalarType
  | RecordType
  | CollectionType
  | FunctionType
  | ComponentType
  | AnyType
  | UnionType
  | OptionalType

export interface ScalarType {
  kind: 'scalar'
  type: MaisieFieldType
}

export interface RecordType {
  kind: 'record'
  fields: Record<string, TypeExpr>
  /** Names of fields that may be absent. */
  optional?: string[]
}

export interface CollectionType {
  kind: 'collection'
  element: TypeExpr
}

export interface FunctionType {
  kind: 'function'
  params: Array<{ name: string; type: TypeExpr }>
  returns: TypeExpr
}

export interface ComponentType {
  kind: 'component'
  /** Constraint on the component's input shape. omit = any component. */
  input?: TypeExpr
}

export interface AnyType {
  kind: 'any'
}

export interface OptionalType {
  kind: 'optional'
  inner: TypeExpr
}

export interface UnionType {
  kind: 'union'
  members: TypeExpr[]
}

// ── ComponentDef — the unified component type ──────────────────────────────

export type ComponentKind = 'base' | 'layout' | 'derived'

export interface ComponentDef {
  name: string
  kind: ComponentKind
  description?: string
  /** Data the component renders. Undefined for layout primitives (they render children, not data). */
  input?: TypeExpr
  /** Props the component accepts. */
  props?: Record<string, PropDecl>
  /** The render tree — only for kind === 'derived'. */
  render?: ExprNode
}

export interface PropDecl {
  type: TypeExpr
  /** Default value used when the prop is omitted. */
  default?: MaisieValue
  description?: string
  /** If true, this prop is required — no default, must be provided. */
  required?: boolean
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a ComponentDef for structural correctness. Returns an array of
 * error messages (empty if valid).
 */
export function validateComponentDef(component: ComponentDef): string[] {
  const errors: string[] = []

  if (!component.name) {
    errors.push('component name is required')
  } else if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(component.name)) {
    errors.push(`invalid component name: "${component.name}"`)
  }

  if (!['base', 'layout', 'derived'].includes(component.kind)) {
    errors.push(`invalid component kind: "${component.kind}"`)
  }

  if (component.kind === 'derived' && !component.render) {
    errors.push('derived components must have a render expression')
  }

  if (component.kind !== 'derived' && component.render) {
    errors.push(`only derived components have render expressions (kind: ${component.kind})`)
  }

  // Validate prop decls
  if (component.props) {
    for (const [name, prop] of Object.entries(component.props)) {
      if (prop.required && prop.default !== undefined) {
        errors.push(`prop "${name}": cannot be both required and have a default`)
      }
    }
  }

  return errors
}
