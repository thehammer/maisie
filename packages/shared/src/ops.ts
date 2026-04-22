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
 *
 * Standard library (STD_LIB, STD_LIB_ENTRIES, callStd, DEF_*) lives in std-lib.ts
 * and is re-exported here for backward compatibility.
 */

import type { MaisieSchemaType } from './field'
import { STD_LIB } from './std-lib'
// Note: std-lib.ts imports evalExpr from this file; the circular reference is safe
// because evalExpr is only used inside callStd's function body (runtime, not init time).

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

/**
 * A let-binding form. Evaluates each binding in order (each binding's value
 * is available to subsequent bindings and the body). Produces the body value.
 */
export type LetNode = {
  kind: 'let'
  bindings: { name: string; value: ExprNode }[]
  body: ExprNode
}

/**
 * A pipe form. Evaluates value, then threads the result through each step.
 * Each step is an ExprNode representing an operation without the piped value —
 * the PipeNode evaluator prepends the current value as the first argument.
 *
 * Steps are typically ApplyNodes (e.g. std.filter with just the predicate arg).
 * If a step evaluates to a function, that function is called with the piped value.
 */
export type PipeNode = {
  kind: 'pipe'
  value: ExprNode
  steps: ExprNode[]
}

export type ExprNode = LiteralNode | RefNode | ApplyNode | LambdaNode | LetNode | PipeNode

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
 *
 * Exported so the async evaluator (eval.ts) can reuse the same primitive set.
 */
export const PRIMITIVES: Record<string, Primitive> = {
  // ── Collection ──────────────────────────────────────────────────────────────
  /**
   * reduce(collection, lambda, initial)
   * The universal collection combinator. lambda receives {acc, item}.
   * Treats null as empty collection (same convention as append).
   */
  reduce: (coll, reducer, init) => {
    const rows = (coll as MaisieCollection) ?? []
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

  /** take(collection, n) — keep only the first n elements. */
  take: (coll, n) => ((coll as MaisieCollection) ?? []).slice(0, Number(n)),

  /** sortBy(collection, field, dir) — sort by field value. dir is 'asc' | 'desc'. */
  sortBy: (coll, field, dir) => {
    const rows = (coll as MaisieCollection) ?? []
    const f = field as string
    const direction = (dir as string) ?? 'asc'
    return [...rows].sort((a, b) => {
      const av = a[f], bv = b[f]
      if (av === bv) return 0
      const cmp = (av == null || bv == null) ? (av == null ? 1 : -1)
        : av < bv ? -1 : 1
      return direction === 'desc' ? -cmp : cmp
    })
  },

  /** groupBy(collection, field) — group by field value. Returns a collection of
   *  { [field]: key, items: collection } records. */
  groupBy: (coll, field) => {
    const rows = (coll as MaisieCollection) ?? []
    const f = field as string
    const groups = new Map<string, MaisieCollection>()
    for (const row of rows) {
      const key = String(row[f] ?? '')
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(row)
    }
    return Array.from(groups.entries()).map(([key, items]) => ({
      [f]: key,
      items: items as unknown as MaisieValue,
    }))
  },

  // ── Record ───────────────────────────────────────────────────────────────────
  /** get(record, field) — field access. Returns null if record is null. */
  get: (record, field) => record == null ? null : (record as MaisieRecord)[field as string] ?? null,

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
      if (node.name in env) return env[node.name]
      // Dotted ref: if the root segment is in env, drill into it. Same rule
      // as evalExprAsync — enables `e.section` where `e` is a lambda param.
      const dot = node.name.indexOf('.')
      if (dot > 0) {
        const root = node.name.slice(0, dot)
        if (root in env) {
          let val: MaisieValue = env[root]
          const parts = node.name.slice(dot + 1).split('.')
          for (const part of parts) {
            if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
              val = (val as MaisieRecord)[part] ?? null
            } else {
              val = null
              break
            }
          }
          return val
        }
      }
      throw new Error(`Unbound reference: "${node.name}"`)
    }

    case 'lambda':
      // Capture the current env (closure).
      return (args: MaisieRecord): MaisieValue => {
        const newEnv: Record<string, MaisieValue> = { ...env }
        if (node.params.length === 1) {
          // Single-param convention: bind the whole args record to the param.
          // This allows `(sw) => sw.state == "on"` to receive an item record
          // and access it as `sw`, rather than looking up args["sw"].
          newEnv[node.params[0]] = args as MaisieValue
          // Row-scope: also expose the record's own fields as env vars
          // so `(__row) => name contains "x"` can resolve `name` from the row.
          if (args && typeof args === 'object' && !Array.isArray(args)) {
            for (const [k, v] of Object.entries(args)) {
              if (!(k in newEnv)) newEnv[k] = v
            }
          }
        } else {
          for (const param of node.params) {
            newEnv[param] = args[param] ?? null
          }
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

    case 'let': {
      // Evaluate bindings in order, each extending the env for subsequent ones.
      let letEnv = { ...env }
      for (const binding of node.bindings) {
        letEnv = { ...letEnv, [binding.name]: evalExpr(binding.value, letEnv, defs) }
      }
      return evalExpr(node.body, letEnv, defs)
    }

    case 'pipe': {
      // Evaluate the initial value, then thread through each step.
      let current = evalExpr(node.value, env, defs)
      for (const step of node.steps) {
        if (step.kind === 'apply') {
          // Prepend the piped value as the first argument.
          const pipeEnv = { ...env, __pipe_value: current }
          const injectedStep: ApplyNode = {
            kind: 'apply',
            fn: step.fn,
            args: [{ kind: 'ref', name: '__pipe_value' }, ...step.args],
          }
          current = evalExpr(injectedStep, pipeEnv, defs)
        } else {
          // Evaluate the step to get a function, then call it with the value.
          const fn = evalExpr(step, env, defs) as MaisieFunction
          current = fn({ __value: current })
        }
      }
      return current
    }
  }
}

// ── Standard library ─────────────────────────────────────────────────────────
//
// Re-exported from std-lib.ts for backward compatibility.
// The canonical definitions and new functions (any, all, first, last, unique)
// live in std-lib.ts.

export {
  DEF_FILTER,
  DEF_MAP,
  DEF_PLUCK,
  DEF_COUNT,
  DEF_SUM,
  DEF_ANY,
  DEF_ALL,
  DEF_FIRST,
  DEF_LAST,
  DEF_UNIQUE,
  STD_LIB,
  STD_LIB_ENTRIES,
  callStd,
} from './std-lib'
