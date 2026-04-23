/**
 * FunctionDescriptor data for the standard library functions exposed on the canvas.
 *
 * Each descriptor describes one std lib op in terms the canvas UI can use:
 *   - The TypeExpr for the primary input and output
 *   - Inline parameters the user configures in the inspector (not wired from other placements)
 *
 * Polymorphic collection functions use collection<any> for both input and output.
 * The structural matcher treats collection<any> as compatible with any collection.
 */

import type { TypeExpr } from './component'

export interface FunctionParamDecl {
  /** Parameter name (matches the FunctionDef param position). */
  name: string
  /** Type shown in the inspector UI. */
  type: TypeExpr
  /**
   * If true, this param is filled via the inspector panel, not wired in from
   * another placement. Inline params appear as input controls in the inspector.
   */
  inline?: boolean
  /** Default value shown in the inspector when the param is not yet set. */
  default?: unknown
  /** Description shown as a hint in the inspector. */
  description?: string
}

export interface FunctionDescriptor {
  /** Standard library id (e.g. 'std.filter'). Must match FunctionDef.id. */
  id: string
  /** Short display name (e.g. 'filter'). */
  name: string
  /** Explanation shown in the inspector and palette tooltip. */
  description: string
  /** TypeExpr for the primary collection or scalar input port. */
  input: TypeExpr
  /** TypeExpr for the output port. */
  output: TypeExpr
  /** Additional parameters the user configures in the inspector (not wired). */
  params?: FunctionParamDecl[]
}

// ── Shared type aliases ────────────────────────────────────────────────────────

const ANY_COLLECTION: TypeExpr = { kind: 'collection', element: { kind: 'any' } }
const ANY: TypeExpr = { kind: 'any' }
const SCALAR_STRING: TypeExpr = { kind: 'scalar', type: 'string' }
const SCALAR_NUMBER: TypeExpr = { kind: 'scalar', type: 'number' }
const SCALAR_BOOLEAN: TypeExpr = { kind: 'scalar', type: 'boolean' }

// A function type used for lambda params (item → boolean, item → any)
const PREDICATE_TYPE: TypeExpr = {
  kind: 'function',
  params: [{ name: 'item', type: ANY }],
  returns: SCALAR_BOOLEAN,
}

const MAPPER_TYPE: TypeExpr = {
  kind: 'function',
  params: [{ name: 'item', type: ANY }],
  returns: ANY,
}

// ── Descriptors ────────────────────────────────────────────────────────────────

export const STD_FUNCTION_DESCRIPTORS: FunctionDescriptor[] = [
  {
    id: 'std.filter',
    name: 'filter',
    description: 'Keep elements where the predicate is true',
    input: ANY_COLLECTION,
    output: ANY_COLLECTION,
    params: [
      {
        name: 'predicate',
        type: PREDICATE_TYPE,
        inline: true,
        description: 'Lambda expression, e.g. (x) => x.state == "on"',
      },
    ],
  },
  {
    id: 'std.sort',
    name: 'sort',
    description: 'Sort elements by a field value',
    input: ANY_COLLECTION,
    output: ANY_COLLECTION,
    params: [
      {
        name: 'field',
        type: SCALAR_STRING,
        inline: true,
        description: 'Field name to sort by',
      },
      {
        name: 'direction',
        type: SCALAR_STRING,
        inline: true,
        default: 'asc',
        description: '"asc" or "desc"',
      },
    ],
  },
  {
    id: 'std.limit',
    name: 'limit',
    description: 'Keep only the first N elements',
    input: ANY_COLLECTION,
    output: ANY_COLLECTION,
    params: [
      {
        name: 'n',
        type: SCALAR_NUMBER,
        inline: true,
        default: 10,
        description: 'Maximum number of elements to keep',
      },
    ],
  },
  {
    id: 'std.map',
    name: 'map',
    description: 'Transform each element with a function',
    input: ANY_COLLECTION,
    output: ANY_COLLECTION,
    params: [
      {
        name: 'fn',
        type: MAPPER_TYPE,
        inline: true,
        description: 'Lambda expression, e.g. (x) => { title: x.name }',
      },
    ],
  },
  {
    id: 'std.pluck',
    name: 'pluck',
    description: 'Extract one field from each element',
    input: ANY_COLLECTION,
    output: ANY_COLLECTION,
    params: [
      {
        name: 'field',
        type: SCALAR_STRING,
        inline: true,
        description: 'Field name to extract from each element',
      },
    ],
  },
  {
    id: 'std.group',
    name: 'group',
    description: 'Group elements by a field value',
    input: ANY_COLLECTION,
    output: ANY_COLLECTION,
    params: [
      {
        name: 'field',
        type: SCALAR_STRING,
        inline: true,
        description: 'Field name to group by',
      },
    ],
  },
  {
    id: 'std.count',
    name: 'count',
    description: 'Count the number of elements',
    input: ANY_COLLECTION,
    output: SCALAR_NUMBER,
  },
  {
    id: 'std.sum',
    name: 'sum',
    description: 'Sum a numeric field across all elements',
    input: ANY_COLLECTION,
    output: SCALAR_NUMBER,
    params: [
      {
        name: 'field',
        type: SCALAR_STRING,
        inline: true,
        description: 'Field name to sum',
      },
    ],
  },
  {
    id: 'std.any',
    name: 'any',
    description: 'True if any element satisfies the predicate',
    input: ANY_COLLECTION,
    output: SCALAR_BOOLEAN,
    params: [
      {
        name: 'predicate',
        type: PREDICATE_TYPE,
        inline: true,
        description: 'Lambda expression, e.g. (x) => x.active == true',
      },
    ],
  },
  {
    id: 'std.all',
    name: 'all',
    description: 'True if all elements satisfy the predicate',
    input: ANY_COLLECTION,
    output: SCALAR_BOOLEAN,
    params: [
      {
        name: 'predicate',
        type: PREDICATE_TYPE,
        inline: true,
        description: 'Lambda expression, e.g. (x) => x.active == true',
      },
    ],
  },
  {
    id: 'std.first',
    name: 'first',
    description: 'Return the first element or null',
    input: ANY_COLLECTION,
    output: ANY,
  },
  {
    id: 'std.last',
    name: 'last',
    description: 'Return the last element or null',
    input: ANY_COLLECTION,
    output: ANY,
  },
  {
    id: 'std.unique',
    name: 'unique',
    description: 'Deduplicate elements by a field value',
    input: ANY_COLLECTION,
    output: ANY_COLLECTION,
    params: [
      {
        name: 'field',
        type: SCALAR_STRING,
        inline: true,
        description: 'Field name to deduplicate by',
      },
    ],
  },
]

/** Look up a FunctionDescriptor by its std lib id. Returns undefined if not found. */
export function getFunctionDescriptor(id: string): FunctionDescriptor | undefined {
  return STD_FUNCTION_DESCRIPTORS.find((d) => d.id === id)
}
