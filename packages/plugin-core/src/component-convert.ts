/**
 * Convert ParsedComponent (parser output) to ComponentDef (runtime type).
 *
 * Used when accepting MEL `define` blocks (with a render field) via the CRUD API.
 */

import type { ParsedComponent, ComponentDef, MaisieValue } from '@maisie/shared'

export function parsedToComponentDef(parsed: ParsedComponent): ComponentDef {
  const props: ComponentDef['props'] = {}

  if (parsed.props) {
    for (const [name, decl] of Object.entries(parsed.props)) {
      props[name] = {
        type: decl.type,
        // If the default is a LiteralNode, extract the value directly.
        // Non-literal defaults are deferred to render time (stored as undefined here).
        default: extractLiteralValue(decl.default),
      }
    }
  }

  return {
    name: parsed.name,
    kind: 'derived',
    description: parsed.description,
    input: parsed.input,
    props: Object.keys(props).length > 0 ? props : undefined,
    render: parsed.render,
  }
}

function extractLiteralValue(node?: unknown): MaisieValue | undefined {
  if (!node) return undefined
  if (
    typeof node === 'object' &&
    node !== null &&
    'kind' in node &&
    (node as { kind: string }).kind === 'literal'
  ) {
    return (node as { kind: string; value: MaisieValue }).value
  }
  // Non-literal defaults (expressions) are deferred to render time
  return undefined
}
