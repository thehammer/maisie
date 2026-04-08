/**
 * Maisie function library — ops, expression language, and standard library.
 *
 * Architecture (two layers):
 *
 *   OpConfig    — serializable card-configurator API; stored in the layout DB.
 *                 Simple named ops with typed parameters. Compiled to CollectionOp
 *                 at render time via compileOp().
 *
 *   ExprNode    — full expression DAG used by the standard library and user-defined
 *                 functions. Evaluated by evalExpr(). Primitives are runtime TypeScript;
 *                 derived ops (filter, map, group…) are defined as FunctionDef entries
 *                 that reference primitives by name.
 *
 * The two layers share the same MaisieValue type system, so a function produced by
 * compileOp() and one produced by evalExpr() are interchangeable at runtime.
 */

import type { MaisieSchemaType } from './field'

// ── Runtime value types ───────────────────────────────────────────────────────

export type MaisieScalar = string | number | boolean | null

/** A record whose values are recursively MaisieValues. Uses interface to allow
 *  the circular reference that TypeScript requires for recursive types. */
export interface MaisieRecord { [key: string]: MaisieValue }

export type MaisieCollection = MaisieRecord[]

/** A function value in the system. Takes a record of named arguments. */
export type MaisieFunction = (args: MaisieRecord) => MaisieValue

export type MaisieValue = MaisieScalar | MaisieRecord | MaisieCollection | MaisieFunction

// ── Expression nodes (the DAG) ────────────────────────────────────────────────

/** A literal constant. */
export type LiteralNode = { kind: 'literal'; value: MaisieScalar }

/** A named variable reference — resolved from the evaluation environment. */
export type RefNode = { kind: 'ref'; name: string }

/**
 * A function application. fn names either a primitive or a FunctionDef id.
 * Args are positional; each arg is itself an ExprNode (DAG edges).
 */
export type ApplyNode = { kind: 'apply'; fn: string; args: ExprNode[] }

/**
 * An anonymous function (lambda). When evaluated, produces a MaisieFunction
 * that binds params from a record argument and evaluates body in that scope.
 */
export type LambdaNode = { kind: 'lambda'; params: string[]; body: ExprNode }

export type ExprNode = LiteralNode | RefNode | ApplyNode | LambdaNode

// ── Function definition (serialized, storable) ────────────────────────────────

/**
 * A named, serializable function. Standard library entries and user-defined
 * transforms are both FunctionDefs. body is an ExprNode tree that may
 * reference primitives or other FunctionDef ids.
 */
export interface FunctionDef {
  id: string
  name: string
  description?: string
  params: string[]
  inputSchema: MaisieSchemaType
  outputSchema: MaisieSchemaType
  body: ExprNode
}

// ── OpConfig — card configurator API ─────────────────────────────────────────
//
// A restricted, user-facing subset of the expression language.
// These are what the card builder exposes as operations.

export type ComparisonOp = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'startsWith'
export type SortDir = 'asc' | 'desc'

/** Keep rows where field satisfies the comparison. */
export type FilterConfig  = { type: 'filter'; field: string; op: ComparisonOp; value: MaisieScalar }
/** Reorder rows by field. */
export type SortConfig    = { type: 'sort'; field: string; dir: SortDir }
/** Collapse rows into groups keyed by field; each group has a key + items array. */
export type GroupConfig   = { type: 'group'; field: string }
/** Keep only the first n rows. */
export type LimitConfig   = { type: 'limit'; n: number }
/** Keep only the named fields in each row (column selection). */
export type PickConfig    = { type: 'pick'; fields: string[] }
/** Apply a named standard-library or user-defined function by id. */
export type ApplyConfig   = { type: 'apply'; fn: string; args?: Record<string, MaisieScalar> }
/** Chain ops left-to-right; output of each is input to the next. */
export type PipeConfig    = { type: 'pipe'; ops: OpConfig[] }

export type OpConfig =
  | FilterConfig
  | SortConfig
  | GroupConfig
  | LimitConfig
  | PickConfig
  | ApplyConfig
  | PipeConfig

/** A compiled op: a pure function from collection to collection. */
export type CollectionOp = (rows: MaisieCollection) => MaisieCollection

// ── compileOp ─────────────────────────────────────────────────────────────────

function evalComparison(op: ComparisonOp, a: MaisieValue, b: MaisieScalar): boolean {
  switch (op) {
    case 'eq':         return a === b
    case 'neq':        return a !== b
    case 'lt':         return (a as number) < (b as number)
    case 'lte':        return (a as number) <= (b as number)
    case 'gt':         return (a as number) > (b as number)
    case 'gte':        return (a as number) >= (b as number)
    case 'contains':   return String(a ?? '').includes(String(b ?? ''))
    case 'startsWith': return String(a ?? '').startsWith(String(b ?? ''))
  }
}

/**
 * Compile an OpConfig into a CollectionOp — a pure function that transforms
 * a collection. Safe to call multiple times; each call produces a fresh function.
 */
export function compileOp(config: OpConfig): CollectionOp {
  switch (config.type) {
    case 'filter':
      return (rows) => rows.filter((row) =>
        evalComparison(config.op, row[config.field] ?? null, config.value)
      )

    case 'sort':
      return (rows) => [...rows].sort((a, b) => {
        const av = a[config.field], bv = b[config.field]
        if (av === bv) return 0
        const cmp = (av == null || bv == null) ? (av == null ? 1 : -1)
          : av < bv ? -1 : 1
        return config.dir === 'asc' ? cmp : -cmp
      })

    case 'group':
      return (rows) => {
        const groups = new Map<string, MaisieCollection>()
        for (const row of rows) {
          const key = String(row[config.field] ?? '')
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key)!.push(row)
        }
        return Array.from(groups.entries()).map(([key, items]) => ({
          [config.field]: key,
          items: items as unknown as MaisieValue,
        }))
      }

    case 'limit':
      return (rows) => rows.slice(0, config.n)

    case 'pick':
      return (rows) => rows.map((row) =>
        Object.fromEntries(config.fields.map((f) => [f, row[f] ?? null]))
      )

    case 'apply': {
      const def = STD_LIB[config.fn]
      if (!def) throw new Error(`Unknown function: ${config.fn}`)
      const fnArgs: MaisieRecord = config.args
        ? Object.fromEntries(Object.entries(config.args)) as MaisieRecord
        : {}
      return (rows) => {
        const result = evalExpr(def.body, { collection: rows, ...fnArgs }, STD_LIB)
        return result as MaisieCollection
      }
    }

    case 'pipe': {
      const compiled = config.ops.map(compileOp)
      return (rows) => compiled.reduce((r, op) => op(r), rows)
    }
  }
}

// ── Primitives registry ───────────────────────────────────────────────────────
//
// These are the irreducible runtime operations. All standard library functions
// are defined as FunctionDef trees that reference these by name.

type Primitive = (...args: MaisieValue[]) => MaisieValue

/**
 * The primitive set:
 *   Collection: reduce, sort, append
 *   Record:     get, set, merge
 *   Scalar:     eq, neq, lt, lte, gt, gte, contains, startsWith
 *               add, sub, mul, div, mod
 *               and, or, not
 *               concat, len, str
 *   Control:    if, identity, call
 *   Binding:    literal, ref  (handled directly in evalExpr, listed here for docs)
 */
const PRIMITIVES: Record<string, Primitive> = {
  // ── Collection ──────────────────────────────────────────────────────────────
  /**
   * reduce(collection, lambda, initial)
   * The universal collection combinator. lambda receives {acc, item}.
   */
  reduce: (coll, reducer, init) => {
    const rows = coll as MaisieCollection
    const fn = reducer as MaisieFunction
    return rows.reduce<MaisieValue>((acc, item) => fn({ acc, item }), init)
  },

  /**
   * sort(collection, comparator)
   * comparator receives {a, b} and returns negative / zero / positive number.
   */
  sort: (coll, comparator) => {
    const fn = comparator as MaisieFunction
    return [...(coll as MaisieCollection)].sort((a, b) =>
      fn({ a, b }) as number
    )
  },

  /** append(collection, item) — add item to end; returns new collection.
   *  Treats null as empty collection — used as initial accumulator in reduce-derived fns. */
  append: (coll, item) => [...((coll as MaisieCollection) ?? []), item as MaisieRecord],

  // ── Record ───────────────────────────────────────────────────────────────────
  /** get(record, field) — field access. */
  get: (record, field) => (record as MaisieRecord)[field as string] ?? null,

  /** set(record, field, value) — returns new record with field set. */
  set: (record, field, value) => ({
    ...(record as MaisieRecord),
    [field as string]: value,
  }),

  /** merge(a, b) — shallow merge, b wins on conflicts. */
  merge: (a, b) => ({ ...(a as MaisieRecord), ...(b as MaisieRecord) }),

  // ── Comparison ───────────────────────────────────────────────────────────────
  eq:         (a, b) => a === b,
  neq:        (a, b) => a !== b,
  lt:         (a, b) => (a as number) < (b as number),
  lte:        (a, b) => (a as number) <= (b as number),
  gt:         (a, b) => (a as number) > (b as number),
  gte:        (a, b) => (a as number) >= (b as number),
  contains:   (a, b) => String(a ?? '').includes(String(b ?? '')),
  startsWith: (a, b) => String(a ?? '').startsWith(String(b ?? '')),

  // ── Arithmetic ───────────────────────────────────────────────────────────────
  add: (a, b) => (a as number) + (b as number),
  sub: (a, b) => (a as number) - (b as number),
  mul: (a, b) => (a as number) * (b as number),
  div: (a, b) => (b as number) !== 0 ? (a as number) / (b as number) : null,
  mod: (a, b) => (b as number) !== 0 ? (a as number) % (b as number) : null,

  // ── Boolean ──────────────────────────────────────────────────────────────────
  and: (a, b) => Boolean(a) && Boolean(b),
  or:  (a, b) => Boolean(a) || Boolean(b),
  not: (a)    => !Boolean(a),

  // ── String ───────────────────────────────────────────────────────────────────
  concat: (a, b) => String(a ?? '') + String(b ?? ''),
  len:    (a)    => (typeof a === 'string' ? a.length : (a as MaisieCollection)?.length ?? 0),
  str:    (a)    => String(a ?? ''),

  // ── Control ──────────────────────────────────────────────────────────────────
  /** if(condition, then, else) */
  if:       (cond, then_, else_) => Boolean(cond) ? then_ : else_,
  /** identity(a) → a */
  identity: (a) => a,
  /** call(fn, argRecord) — invoke a MaisieFunction with a record of args. */
  call:     (fn, args) => (fn as MaisieFunction)(args as MaisieRecord),
}

// ── evalExpr ─────────────────────────────────────────────────────────────────

/**
 * Evaluate an ExprNode against an environment and a registry of FunctionDefs.
 * The environment binds named values (function params, let bindings).
 * defs provides the FunctionDef library for named function lookup.
 */
export function evalExpr(
  node: ExprNode,
  env: Record<string, MaisieValue> = {},
  defs: Record<string, FunctionDef> = {},
): MaisieValue {
  switch (node.kind) {
    case 'literal':
      return node.value

    case 'ref': {
      if (!(node.name in env)) throw new Error(`Unbound reference: "${node.name}"`)
      return env[node.name]
    }

    case 'lambda':
      // Capture the current env (closure).
      return (args: MaisieRecord): MaisieValue => {
        const newEnv: Record<string, MaisieValue> = { ...env }
        for (const param of node.params) {
          newEnv[param] = args[param] ?? null
        }
        return evalExpr(node.body, newEnv, defs)
      }

    case 'apply': {
      // Primitive?
      if (node.fn in PRIMITIVES) {
        const args = node.args.map((a) => evalExpr(a, env, defs))
        return PRIMITIVES[node.fn](...args)
      }
      // User / standard library FunctionDef?
      if (node.fn in defs) {
        const def = defs[node.fn]
        const args = node.args.map((a) => evalExpr(a, env, defs))
        const newEnv: Record<string, MaisieValue> = {}
        for (let i = 0; i < def.params.length; i++) {
          newEnv[def.params[i]] = args[i] ?? null
        }
        return evalExpr(def.body, newEnv, defs)
      }
      throw new Error(`Unknown function: "${node.fn}"`)
    }
  }
}

// ── Standard library ─────────────────────────────────────────────────────────
//
// Derived ops defined as FunctionDefs referencing the primitives above.
// These are the named operations the card configurator and users work with.

/** filter(collection, pred) — keep elements where pred(item) is truthy. */
const DEF_FILTER: FunctionDef = {
  id: 'std.filter', name: 'filter',
  description: 'Keep elements where the predicate is true',
  params: ['collection', 'pred'],
  inputSchema: 'collection', outputSchema: 'collection',
  body: {
    kind: 'apply', fn: 'reduce', args: [
      { kind: 'ref', name: 'collection' },
      {
        kind: 'lambda', params: ['acc', 'item'],
        body: {
          kind: 'apply', fn: 'if', args: [
            { kind: 'apply', fn: 'call', args: [{ kind: 'ref', name: 'pred' }, { kind: 'ref', name: 'item' }] },
            { kind: 'apply', fn: 'append', args: [{ kind: 'ref', name: 'acc' }, { kind: 'ref', name: 'item' }] },
            { kind: 'ref', name: 'acc' },
          ],
        },
      },
      { kind: 'literal', value: null },  // init: [] handled as null → cast in reduce
    ],
  },
}

/** map(collection, fn) — transform each element. */
const DEF_MAP: FunctionDef = {
  id: 'std.map', name: 'map',
  description: 'Transform each element with a function',
  params: ['collection', 'fn'],
  inputSchema: 'collection', outputSchema: 'collection',
  body: {
    kind: 'apply', fn: 'reduce', args: [
      { kind: 'ref', name: 'collection' },
      {
        kind: 'lambda', params: ['acc', 'item'],
        body: {
          kind: 'apply', fn: 'append', args: [
            { kind: 'ref', name: 'acc' },
            { kind: 'apply', fn: 'call', args: [{ kind: 'ref', name: 'fn' }, { kind: 'ref', name: 'item' }] },
          ],
        },
      },
      { kind: 'literal', value: null },
    ],
  },
}

/** pluck(collection, field) — extract a single field from each element. */
const DEF_PLUCK: FunctionDef = {
  id: 'std.pluck', name: 'pluck',
  description: 'Extract one field from each element',
  params: ['collection', 'field'],
  inputSchema: 'collection', outputSchema: 'collection',
  body: {
    kind: 'apply', fn: 'reduce', args: [
      { kind: 'ref', name: 'collection' },
      {
        kind: 'lambda', params: ['acc', 'item'],
        body: {
          kind: 'apply', fn: 'append', args: [
            { kind: 'ref', name: 'acc' },
            { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'item' }, { kind: 'ref', name: 'field' }] },
          ],
        },
      },
      { kind: 'literal', value: null },
    ],
  },
}

/** count(collection) — number of elements. */
const DEF_COUNT: FunctionDef = {
  id: 'std.count', name: 'count',
  description: 'Count elements',
  params: ['collection'],
  inputSchema: 'collection', outputSchema: 'scalar',
  body: {
    kind: 'apply', fn: 'reduce', args: [
      { kind: 'ref', name: 'collection' },
      {
        kind: 'lambda', params: ['acc', 'item'],
        body: { kind: 'apply', fn: 'add', args: [{ kind: 'ref', name: 'acc' }, { kind: 'literal', value: 1 }] },
      },
      { kind: 'literal', value: 0 },
    ],
  },
}

/** sum(collection, field) — sum a numeric field across all elements. */
const DEF_SUM: FunctionDef = {
  id: 'std.sum', name: 'sum',
  description: 'Sum a numeric field',
  params: ['collection', 'field'],
  inputSchema: 'collection', outputSchema: 'scalar',
  body: {
    kind: 'apply', fn: 'reduce', args: [
      { kind: 'ref', name: 'collection' },
      {
        kind: 'lambda', params: ['acc', 'item'],
        body: {
          kind: 'apply', fn: 'add', args: [
            { kind: 'ref', name: 'acc' },
            { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'item' }, { kind: 'ref', name: 'field' }] },
          ],
        },
      },
      { kind: 'literal', value: 0 },
    ],
  },
}

/**
 * The standard library registry.
 * Keys are FunctionDef ids. evalExpr resolves apply nodes against this map
 * after exhausting the primitives registry.
 */
export const STD_LIB: Record<string, FunctionDef> = {
  [DEF_FILTER.id]: DEF_FILTER,
  [DEF_MAP.id]:    DEF_MAP,
  [DEF_PLUCK.id]:  DEF_PLUCK,
  [DEF_COUNT.id]:  DEF_COUNT,
  [DEF_SUM.id]:    DEF_SUM,
}

/** All standard library FunctionDefs as an array (for catalog/UI listing). */
export const STD_LIB_ENTRIES: FunctionDef[] = Object.values(STD_LIB)

// ── Convenience: call a named std function directly ───────────────────────────

/**
 * Call a standard library function by id with named args.
 * Useful from TypeScript without constructing ExprNodes manually.
 *
 * @example
 * const filtered = callStd('std.filter', { collection: rows, pred: (args) => (args as MaisieRecord).levelPercent < 20 })
 */
export function callStd(id: string, args: MaisieRecord): MaisieValue {
  const def = STD_LIB[id]
  if (!def) throw new Error(`Unknown std function: "${id}"`)
  const env: Record<string, MaisieValue> = {}
  for (const param of def.params) env[param] = args[param] ?? null
  return evalExpr(def.body, env, STD_LIB)
}
