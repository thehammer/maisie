/**
 * ViewDef — a named, addressable composition of entity + function chain + component.
 *
 * A View captures the full rendering pipeline: where the data comes from (source
 * entity + field), how it is transformed (chain of function calls), and how it is
 * presented (component + props). Views live in the catalog alongside entities and
 * components, are persistable, queryable, and bindable from cards.
 */

export interface ViewDef {
  name: string
  description?: string
  /** Source entity and which field to read from. */
  source: {
    /** Entity name, e.g., 'plex.list_recently_added' */
    entity: string
    /** Field on the entity, e.g., 'result'. Defaults to 'result' for plugin entities. */
    field?: string
  }
  /** Optional function chain applied between the source and the component. */
  chain: ChainStep[]
  /** The component that renders the final data. */
  component: string
  /** Props passed to the component. */
  componentProps?: Record<string, unknown>
}

export interface ChainStep {
  /** Function id, e.g., 'std.filter', 'std.map'. */
  functionId: string
  /** Inline params supplied via the inspector — field names, directions, etc. */
  params?: Record<string, unknown>
}

/**
 * Validate a ViewDef for structural correctness. Returns an array of error
 * messages (empty if valid).
 */
export function validateViewDef(view: ViewDef): string[] {
  const errors: string[] = []

  if (!view.name) {
    errors.push('view name is required')
  } else if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(view.name)) {
    errors.push(`invalid view name: "${view.name}"`)
  }

  if (!view.source?.entity) {
    errors.push('source.entity is required')
  }

  if (!view.component) {
    errors.push('component is required')
  }

  return errors
}
