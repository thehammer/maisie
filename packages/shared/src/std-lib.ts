/**
 * Maisie standard library — named FunctionDef entries built from primitives.
 *
 * Extracted from ops.ts so the async evaluator and other modules can import
 * the library without a circular dependency on the sync evalExpr.
 */

import type { MaisieSchemaType } from './field'
import type { ExprNode, FunctionDef, MaisieRecord, MaisieValue } from './ops'
import { evalExpr } from './ops'

// ── Filter ────────────────────────────────────────────────────────────────────

/** filter(collection, pred) — keep elements where pred(item) is truthy. */
export const DEF_FILTER: FunctionDef = {
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
      { kind: 'literal', value: null },
    ],
  },
}

// ── Map ───────────────────────────────────────────────────────────────────────

/** map(collection, fn) — transform each element. */
export const DEF_MAP: FunctionDef = {
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

// ── Pluck ─────────────────────────────────────────────────────────────────────

/** pluck(collection, field) — extract a single field from each element. */
export const DEF_PLUCK: FunctionDef = {
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

// ── Count ─────────────────────────────────────────────────────────────────────

/** count(collection) — number of elements. */
export const DEF_COUNT: FunctionDef = {
  id: 'std.count', name: 'count',
  description: 'Count elements',
  params: ['collection'],
  inputSchema: 'collection', outputSchema: 'scalar' as MaisieSchemaType,
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

// ── Sum ───────────────────────────────────────────────────────────────────────

/** sum(collection, field) — sum a numeric field across all elements. */
export const DEF_SUM: FunctionDef = {
  id: 'std.sum', name: 'sum',
  description: 'Sum a numeric field',
  params: ['collection', 'field'],
  inputSchema: 'collection', outputSchema: 'scalar' as MaisieSchemaType,
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

// ── Any ───────────────────────────────────────────────────────────────────────

/**
 * any(collection, pred) — true if any element satisfies the predicate.
 * Implemented as reduce starting from false, short-circuit via or.
 */
export const DEF_ANY: FunctionDef = {
  id: 'std.any', name: 'any',
  description: 'True if any element satisfies the predicate',
  params: ['collection', 'pred'],
  inputSchema: 'collection', outputSchema: 'scalar' as MaisieSchemaType,
  body: {
    kind: 'apply', fn: 'reduce', args: [
      { kind: 'ref', name: 'collection' },
      {
        kind: 'lambda', params: ['acc', 'item'],
        body: {
          kind: 'apply', fn: 'or', args: [
            { kind: 'ref', name: 'acc' },
            { kind: 'apply', fn: 'call', args: [{ kind: 'ref', name: 'pred' }, { kind: 'ref', name: 'item' }] },
          ],
        },
      },
      { kind: 'literal', value: false },
    ],
  },
}

// ── All ───────────────────────────────────────────────────────────────────────

/**
 * all(collection, pred) — true if all elements satisfy the predicate.
 * Implemented as reduce starting from true, short-circuit via and.
 */
export const DEF_ALL: FunctionDef = {
  id: 'std.all', name: 'all',
  description: 'True if all elements satisfy the predicate',
  params: ['collection', 'pred'],
  inputSchema: 'collection', outputSchema: 'scalar' as MaisieSchemaType,
  body: {
    kind: 'apply', fn: 'reduce', args: [
      { kind: 'ref', name: 'collection' },
      {
        kind: 'lambda', params: ['acc', 'item'],
        body: {
          kind: 'apply', fn: 'and', args: [
            { kind: 'ref', name: 'acc' },
            { kind: 'apply', fn: 'call', args: [{ kind: 'ref', name: 'pred' }, { kind: 'ref', name: 'item' }] },
          ],
        },
      },
      { kind: 'literal', value: true },
    ],
  },
}

// ── First ─────────────────────────────────────────────────────────────────────

/**
 * first(collection) — return the first element or null.
 * Implemented as reduce where acc is null initially; if acc is null, take item.
 */
export const DEF_FIRST: FunctionDef = {
  id: 'std.first', name: 'first',
  description: 'Return the first element or null',
  params: ['collection'],
  inputSchema: 'collection', outputSchema: 'record' as MaisieSchemaType,
  body: {
    kind: 'apply', fn: 'reduce', args: [
      { kind: 'ref', name: 'collection' },
      {
        kind: 'lambda', params: ['acc', 'item'],
        body: {
          // if acc is null (no element seen), take item; otherwise keep acc
          kind: 'apply', fn: 'if', args: [
            { kind: 'apply', fn: 'eq', args: [{ kind: 'ref', name: 'acc' }, { kind: 'literal', value: null }] },
            { kind: 'ref', name: 'item' },
            { kind: 'ref', name: 'acc' },
          ],
        },
      },
      { kind: 'literal', value: null },
    ],
  },
}

// ── Last ──────────────────────────────────────────────────────────────────────

/**
 * last(collection) — return the last element or null.
 * Implemented as reduce that overwrites acc with each item.
 */
export const DEF_LAST: FunctionDef = {
  id: 'std.last', name: 'last',
  description: 'Return the last element or null',
  params: ['collection'],
  inputSchema: 'collection', outputSchema: 'record' as MaisieSchemaType,
  body: {
    kind: 'apply', fn: 'reduce', args: [
      { kind: 'ref', name: 'collection' },
      {
        // Always overwrite acc with the current item — last item wins.
        kind: 'lambda', params: ['acc', 'item'],
        body: { kind: 'ref', name: 'item' },
      },
      { kind: 'literal', value: null },
    ],
  },
}

// ── Unique ────────────────────────────────────────────────────────────────────

/**
 * unique(collection, field) — deduplicate by field value.
 *
 * Uses a record as a "seen" set: each unique key is stored as a record key.
 * `get(seenRecord, key)` returns null if not seen, non-null if seen.
 * Accumulator: { seen: record, result: collection }.
 *
 * For each item:
 *   key = str(get(item, field))            -- string form of the field value
 *   alreadySeen = get(acc.seen, key) != null
 *   if not alreadySeen:
 *     { seen: set(acc.seen, key, true), result: append(acc.result, item) }
 *   else acc
 */
export const DEF_UNIQUE: FunctionDef = {
  id: 'std.unique', name: 'unique',
  description: 'Deduplicate elements by a field value',
  params: ['collection', 'field'],
  inputSchema: 'collection', outputSchema: 'collection',
  body: {
    kind: 'apply', fn: 'get', args: [
      {
        kind: 'apply', fn: 'reduce', args: [
          { kind: 'ref', name: 'collection' },
          {
            kind: 'lambda', params: ['acc', 'item'],
            body: {
              // alreadySeen = neq(get(get(acc, 'seen'), str(get(item, field))), null)
              // if not alreadySeen → update acc, else return acc unchanged
              kind: 'apply', fn: 'if', args: [
                // condition: NOT already seen = eq(get(seenRecord, key), null)
                {
                  kind: 'apply', fn: 'eq', args: [
                    {
                      kind: 'apply', fn: 'get', args: [
                        { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'acc' }, { kind: 'literal', value: 'seen' }] },
                        { kind: 'apply', fn: 'str', args: [
                          { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'item' }, { kind: 'ref', name: 'field' }] },
                        ]},
                      ],
                    },
                    { kind: 'literal', value: null },
                  ],
                },
                // then: mark as seen and append to result
                {
                  kind: 'apply', fn: 'set', args: [
                    {
                      kind: 'apply', fn: 'set', args: [
                        { kind: 'ref', name: 'acc' },
                        { kind: 'literal', value: 'seen' },
                        {
                          kind: 'apply', fn: 'set', args: [
                            { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'acc' }, { kind: 'literal', value: 'seen' }] },
                            { kind: 'apply', fn: 'str', args: [
                              { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'item' }, { kind: 'ref', name: 'field' }] },
                            ]},
                            { kind: 'literal', value: true },
                          ],
                        },
                      ],
                    },
                    { kind: 'literal', value: 'result' },
                    {
                      kind: 'apply', fn: 'append', args: [
                        { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'acc' }, { kind: 'literal', value: 'result' }] },
                        { kind: 'ref', name: 'item' },
                      ],
                    },
                  ],
                },
                // else: return acc unchanged
                { kind: 'ref', name: 'acc' },
              ],
            },
          },
          // initial accumulator: { seen: {}, result: null }
          { kind: 'literal', value: { seen: {}, result: null } as never },
        ],
      },
      { kind: 'literal', value: 'result' },
    ],
  },
}

/** limit(collection, n) — keep only the first N elements. */
export const DEF_LIMIT: FunctionDef = {
  id: 'std.limit', name: 'limit',
  description: 'Keep only the first N elements',
  params: ['collection', 'n'],
  inputSchema: 'collection', outputSchema: 'collection',
  body: {
    kind: 'apply', fn: 'take', args: [
      { kind: 'ref', name: 'collection' },
      { kind: 'ref', name: 'n' },
    ],
  },
}

/** sort(collection, field, dir) — sort by field value, dir is 'asc' or 'desc'. */
export const DEF_SORT: FunctionDef = {
  id: 'std.sort', name: 'sort',
  description: 'Sort elements by a field value',
  params: ['collection', 'field', 'dir'],
  inputSchema: 'collection', outputSchema: 'collection',
  body: {
    kind: 'apply', fn: 'sortBy', args: [
      { kind: 'ref', name: 'collection' },
      { kind: 'ref', name: 'field' },
      { kind: 'ref', name: 'dir' },
    ],
  },
}

/** group(collection, field) — group by field value. */
export const DEF_GROUP: FunctionDef = {
  id: 'std.group', name: 'group',
  description: 'Group elements by a field value',
  params: ['collection', 'field'],
  inputSchema: 'collection', outputSchema: 'collection',
  body: {
    kind: 'apply', fn: 'groupBy', args: [
      { kind: 'ref', name: 'collection' },
      { kind: 'ref', name: 'field' },
    ],
  },
}

// ── Get ───────────────────────────────────────────────────────────────────────

/** get(record, field) — extract one field from a record. */
export const DEF_GET: FunctionDef = {
  id: 'std.get', name: 'get',
  description: 'Extract one field from a record',
  params: ['record', 'field'],
  inputSchema: 'record' as MaisieSchemaType,
  outputSchema: 'any' as MaisieSchemaType,
  body: {
    kind: 'apply', fn: 'get', args: [
      { kind: 'ref', name: 'record' },
      { kind: 'ref', name: 'field' },
    ],
  },
}

// ── Registry ──────────────────────────────────────────────────────────────────

/**
 * The standard library registry.
 * Keys are FunctionDef ids.
 */
export const STD_LIB: Record<string, FunctionDef> = {
  [DEF_FILTER.id]: DEF_FILTER,
  [DEF_MAP.id]:    DEF_MAP,
  [DEF_LIMIT.id]:  DEF_LIMIT,
  [DEF_SORT.id]:   DEF_SORT,
  [DEF_GROUP.id]:  DEF_GROUP,
  [DEF_PLUCK.id]:  DEF_PLUCK,
  [DEF_COUNT.id]:  DEF_COUNT,
  [DEF_SUM.id]:    DEF_SUM,
  [DEF_ANY.id]:    DEF_ANY,
  [DEF_ALL.id]:    DEF_ALL,
  [DEF_FIRST.id]:  DEF_FIRST,
  [DEF_LAST.id]:   DEF_LAST,
  [DEF_UNIQUE.id]: DEF_UNIQUE,
  [DEF_GET.id]:    DEF_GET,
}

/** All standard library FunctionDefs as an array (for catalog/UI listing). */
export const STD_LIB_ENTRIES: FunctionDef[] = Object.values(STD_LIB)

// ── callStd ───────────────────────────────────────────────────────────────────

/**
 * Call a standard library function by id with named args.
 * Useful from TypeScript without constructing ExprNodes manually.
 *
 * @example
 * const filtered = callStd('std.filter', { collection: rows, pred: (args) => args.n > 2 })
 */
export function callStd(id: string, args: MaisieRecord): MaisieValue {
  const def = STD_LIB[id]
  if (!def) throw new Error(`Unknown std function: "${id}"`)
  const env: Record<string, MaisieValue> = {}
  for (const param of def.params) env[param] = args[param] ?? null
  return evalExpr(def.body, env, STD_LIB)
}
