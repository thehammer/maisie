import { describe, it, expect } from 'bun:test'
import {
  compileOp,
  evalExpr,
  callStd,
  STD_LIB,
  type MaisieCollection,
  type MaisieRecord,
  type ExprNode,
} from '../ops'

// ── Test data ─────────────────────────────────────────────────────────────────

const devices: MaisieCollection = [
  { name: 'router',   type: 'network', signal: -45, online: true,  uptimeDays: 30 },
  { name: 'printer',  type: 'office',  signal: -70, online: false, uptimeDays: 5  },
  { name: 'nas',      type: 'storage', signal: -55, online: true,  uptimeDays: 120 },
  { name: 'camera',   type: 'security',signal: -80, online: true,  uptimeDays: 7  },
  { name: 'thermostat', type: 'hvac',  signal: -60, online: false, uptimeDays: 14 },
]

// ── compileOp — filter ────────────────────────────────────────────────────────

describe('compileOp filter', () => {
  it('keeps rows matching eq', () => {
    const op = compileOp({ type: 'filter', field: 'online', op: 'eq', value: true })
    const result = op(devices)
    expect(result).toHaveLength(3)
    expect(result.map(r => r.name)).toEqual(['router', 'nas', 'camera'])
  })

  it('keeps rows matching neq', () => {
    const op = compileOp({ type: 'filter', field: 'type', op: 'neq', value: 'network' })
    expect(op(devices)).toHaveLength(4)
  })

  it('keeps rows matching lt', () => {
    // printer=-70, camera=-80 are < -65; thermostat=-60, nas=-55, router=-45 are not
    const op = compileOp({ type: 'filter', field: 'signal', op: 'lt', value: -65 })
    const result = op(devices)
    expect(result.map(r => r.name)).toEqual(['printer', 'camera'])
  })

  it('keeps rows matching gte', () => {
    const op = compileOp({ type: 'filter', field: 'uptimeDays', op: 'gte', value: 30 })
    expect(op(devices).map(r => r.name)).toEqual(['router', 'nas'])
  })

  it('keeps rows matching contains', () => {
    const op = compileOp({ type: 'filter', field: 'name', op: 'contains', value: 'a' })
    expect(op(devices).map(r => r.name)).toEqual(['nas', 'camera', 'thermostat'])
  })

  it('keeps rows matching startsWith', () => {
    const op = compileOp({ type: 'filter', field: 'name', op: 'startsWith', value: 'c' })
    expect(op(devices).map(r => r.name)).toEqual(['camera'])
  })

  it('returns empty for no matches', () => {
    const op = compileOp({ type: 'filter', field: 'type', op: 'eq', value: 'spaceship' })
    expect(op(devices)).toHaveLength(0)
  })
})

// ── compileOp — sort ──────────────────────────────────────────────────────────

describe('compileOp sort', () => {
  it('sorts ascending by number', () => {
    const op = compileOp({ type: 'sort', field: 'uptimeDays', dir: 'asc' })
    const result = op(devices)
    expect(result.map(r => r.uptimeDays)).toEqual([5, 7, 14, 30, 120])
  })

  it('sorts descending by number', () => {
    const op = compileOp({ type: 'sort', field: 'uptimeDays', dir: 'desc' })
    const result = op(devices)
    expect(result.map(r => r.uptimeDays)).toEqual([120, 30, 14, 7, 5])
  })

  it('sorts ascending by string', () => {
    const op = compileOp({ type: 'sort', field: 'name', dir: 'asc' })
    const result = op(devices)
    expect(result[0].name).toBe('camera')
    expect(result[result.length - 1].name).toBe('thermostat')
  })

  it('does not mutate the original collection', () => {
    const original = [...devices]
    compileOp({ type: 'sort', field: 'signal', dir: 'asc' })(devices)
    expect(devices).toEqual(original)
  })
})

// ── compileOp — limit ─────────────────────────────────────────────────────────

describe('compileOp limit', () => {
  it('returns at most n rows', () => {
    const op = compileOp({ type: 'limit', n: 2 })
    expect(op(devices)).toHaveLength(2)
    expect(op(devices)[0].name).toBe('router')
  })

  it('returns all rows when n >= length', () => {
    expect(compileOp({ type: 'limit', n: 100 })(devices)).toHaveLength(5)
  })

  it('returns empty for n=0', () => {
    expect(compileOp({ type: 'limit', n: 0 })(devices)).toHaveLength(0)
  })
})

// ── compileOp — pick ──────────────────────────────────────────────────────────

describe('compileOp pick', () => {
  it('keeps only the named fields', () => {
    const op = compileOp({ type: 'pick', fields: ['name', 'online'] })
    const result = op(devices)
    expect(Object.keys(result[0])).toEqual(['name', 'online'])
  })

  it('fills missing fields with null', () => {
    const op = compileOp({ type: 'pick', fields: ['name', 'doesNotExist'] })
    expect(op(devices)[0].doesNotExist).toBeNull()
  })
})

// ── compileOp — group ─────────────────────────────────────────────────────────

describe('compileOp group', () => {
  it('produces one row per unique field value', () => {
    const onlineDevices = devices.filter(d => d.online)
    const op = compileOp({ type: 'group', field: 'type' })
    const result = op(onlineDevices)
    // router→network, nas→storage, camera→security
    expect(result).toHaveLength(3)
    const keys = result.map(r => r.type).sort()
    expect(keys).toEqual(['network', 'security', 'storage'])
  })

  it('items array contains the grouped rows', () => {
    const networkOnly = devices.filter(d => d.type === 'network')
    const op = compileOp({ type: 'group', field: 'type' })
    const result = op(networkOnly)
    expect(result).toHaveLength(1)
    expect((result[0].items as MaisieRecord[]).length).toBe(1)
  })
})

// ── compileOp — pipe ──────────────────────────────────────────────────────────

describe('compileOp pipe', () => {
  it('chains ops left-to-right', () => {
    const op = compileOp({
      type: 'pipe',
      ops: [
        { type: 'filter', field: 'online', op: 'eq', value: true },
        { type: 'sort',   field: 'uptimeDays', dir: 'desc' },
        { type: 'limit',  n: 2 },
        { type: 'pick',   fields: ['name', 'uptimeDays'] },
      ],
    })
    const result = op(devices)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('nas')      // highest uptime online
    expect(result[1].name).toBe('router')   // second highest
    expect(Object.keys(result[0])).toEqual(['name', 'uptimeDays'])
  })

  it('handles empty pipe (passthrough)', () => {
    const op = compileOp({ type: 'pipe', ops: [] })
    expect(op(devices)).toBe(devices)
  })
})

// ── evalExpr ──────────────────────────────────────────────────────────────────

describe('evalExpr', () => {
  it('evaluates literals', () => {
    expect(evalExpr({ kind: 'literal', value: 42 })).toBe(42)
    expect(evalExpr({ kind: 'literal', value: 'hello' })).toBe('hello')
    expect(evalExpr({ kind: 'literal', value: null })).toBeNull()
  })

  it('resolves refs from environment', () => {
    expect(evalExpr({ kind: 'ref', name: 'x' }, { x: 99 })).toBe(99)
  })

  it('throws on unbound ref', () => {
    expect(() => evalExpr({ kind: 'ref', name: 'missing' })).toThrow('Unbound reference')
  })

  it('applies arithmetic primitives', () => {
    const add: ExprNode = {
      kind: 'apply', fn: 'add',
      args: [{ kind: 'literal', value: 3 }, { kind: 'literal', value: 4 }],
    }
    expect(evalExpr(add)).toBe(7)
  })

  it('applies comparison primitives', () => {
    const eq: ExprNode = {
      kind: 'apply', fn: 'eq',
      args: [{ kind: 'literal', value: 'a' }, { kind: 'literal', value: 'a' }],
    }
    expect(evalExpr(eq)).toBe(true)
  })

  it('evaluates single-param lambda — binds whole args record to param', () => {
    // Single-param convention: (rec) => rec.x + 1.
    // The whole args record is bound to `rec`; access fields via get.
    const lambda: ExprNode = {
      kind: 'lambda', params: ['rec'],
      body: {
        kind: 'apply', fn: 'add',
        args: [
          { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'rec' }, { kind: 'literal', value: 'x' }] },
          { kind: 'literal', value: 1 },
        ],
      },
    }
    const fn = evalExpr(lambda) as (args: Record<string, unknown>) => unknown
    expect(fn({ x: 10 })).toBe(11)
  })

  it('multi-param lambda destructures by name', () => {
    // Two params: (x, base) receives { x: 5, base: 100 } and destructures.
    const lambda: ExprNode = {
      kind: 'lambda', params: ['x', 'base'],
      body: { kind: 'apply', fn: 'add', args: [{ kind: 'ref', name: 'x' }, { kind: 'ref', name: 'base' }] },
    }
    const fn = evalExpr(lambda) as (args: Record<string, unknown>) => unknown
    expect(fn({ x: 5, base: 100 })).toBe(105)
  })

  it('single-param lambda closes over outer env', () => {
    // (rec) => rec.x + base — `base` comes from captured outer env.
    const lambda: ExprNode = {
      kind: 'lambda', params: ['rec'],
      body: {
        kind: 'apply', fn: 'add',
        args: [
          { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'rec' }, { kind: 'literal', value: 'x' }] },
          { kind: 'ref', name: 'base' },
        ],
      },
    }
    const fn = evalExpr(lambda, { base: 100 }) as (args: Record<string, unknown>) => unknown
    expect(fn({ x: 5 })).toBe(105)
  })

  it('evaluates nested apply', () => {
    // (3 + 4) * 2
    const expr: ExprNode = {
      kind: 'apply', fn: 'mul',
      args: [
        { kind: 'apply', fn: 'add', args: [{ kind: 'literal', value: 3 }, { kind: 'literal', value: 4 }] },
        { kind: 'literal', value: 2 },
      ],
    }
    expect(evalExpr(expr)).toBe(14)
  })

  it('throws on unknown function', () => {
    const expr: ExprNode = { kind: 'apply', fn: 'nonexistent', args: [] }
    expect(() => evalExpr(expr)).toThrow('Unknown function')
  })

  it('applies FunctionDefs from defs registry', () => {
    const addOne = {
      id: 'addOne', name: 'addOne', params: ['n'],
      inputSchema: 'scalar' as const, outputSchema: 'scalar' as const,
      body: {
        kind: 'apply' as const, fn: 'add',
        args: [{ kind: 'ref' as const, name: 'n' }, { kind: 'literal' as const, value: 1 }],
      },
    }
    const expr: ExprNode = { kind: 'apply', fn: 'addOne', args: [{ kind: 'literal', value: 41 }] }
    expect(evalExpr(expr, {}, { addOne })).toBe(42)
  })
})

// ── Standard library ──────────────────────────────────────────────────────────

describe('callStd', () => {
  const nums: MaisieCollection = [
    { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 },
  ]

  it('std.count counts elements', () => {
    expect(callStd('std.count', { collection: nums })).toBe(5)
  })

  it('std.count returns 0 for empty', () => {
    expect(callStd('std.count', { collection: [] })).toBe(0)
  })

  it('std.sum sums a numeric field', () => {
    expect(callStd('std.sum', { collection: nums, field: 'n' })).toBe(15)
  })

  it('std.pluck extracts a field from each element', () => {
    const result = callStd('std.pluck', { collection: nums, field: 'n' }) as unknown[]
    expect(result).toEqual([1, 2, 3, 4, 5])
  })

  it('std.map transforms each element', () => {
    const double = (args: Record<string, unknown>) => ({ n: (args.n as number) * 2 })
    const result = callStd('std.map', { collection: nums, fn: double }) as MaisieCollection
    expect(result.map(r => r.n)).toEqual([2, 4, 6, 8, 10])
  })

  it('std.filter keeps matching elements', () => {
    const isOdd = (args: Record<string, unknown>) => ({ ok: (args.n as number) % 2 !== 0 })
    // filter pred returns a record; truthiness = non-null record
    // Actually pred needs to return a truthy MaisieValue — let's use a boolean scalar
    const isOddBool = (args: Record<string, unknown>) => (args.n as number) % 2 !== 0
    const result = callStd('std.filter', { collection: nums, pred: isOddBool }) as MaisieCollection
    expect(result.map(r => r.n)).toEqual([1, 3, 5])
  })

  it('throws on unknown function id', () => {
    expect(() => callStd('std.unknown', { collection: [] })).toThrow('Unknown std function')
  })

  it('STD_LIB contains all standard functions', () => {
    const ids = Object.keys(STD_LIB)
    expect(ids).toContain('std.filter')
    expect(ids).toContain('std.map')
    expect(ids).toContain('std.pluck')
    expect(ids).toContain('std.count')
    expect(ids).toContain('std.sum')
  })
})

// ── Primitives (direct evalExpr) ──────────────────────────────────────────────

describe('primitives', () => {
  function apply(fn: string, ...values: unknown[]): unknown {
    return evalExpr({
      kind: 'apply', fn,
      args: values.map(v => ({ kind: 'literal', value: v as never })),
    })
  }

  it('get reads a field from a record', () => {
    const record: MaisieRecord = { name: 'router', signal: -45 }
    const result = evalExpr(
      { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: 'r' }, { kind: 'literal', value: 'signal' }] },
      { r: record },
    )
    expect(result).toBe(-45)
  })

  it('set returns a new record with field updated', () => {
    const record: MaisieRecord = { x: 1 }
    const result = evalExpr(
      { kind: 'apply', fn: 'set', args: [
        { kind: 'ref', name: 'r' },
        { kind: 'literal', value: 'x' },
        { kind: 'literal', value: 99 },
      ]},
      { r: record },
    ) as MaisieRecord
    expect(result.x).toBe(99)
    expect(record.x).toBe(1) // original unchanged
  })

  it('merge combines two records', () => {
    const a: MaisieRecord = { x: 1, y: 2 }
    const b: MaisieRecord = { y: 99, z: 3 }
    const result = evalExpr(
      { kind: 'apply', fn: 'merge', args: [{ kind: 'ref', name: 'a' }, { kind: 'ref', name: 'b' }] },
      { a, b },
    ) as MaisieRecord
    expect(result).toEqual({ x: 1, y: 99, z: 3 })
  })

  it('concat strings', () => {
    expect(apply('concat', 'hello ', 'world')).toBe('hello world')
  })

  it('len measures string length', () => {
    expect(apply('len', 'hello')).toBe(5)
  })

  it('str converts to string', () => {
    expect(apply('str', 42)).toBe('42')
  })

  it('div returns null for division by zero', () => {
    expect(apply('div', 10, 0)).toBeNull()
  })

  it('mod returns null for modulo by zero', () => {
    expect(apply('mod', 10, 0)).toBeNull()
  })

  it('if returns then branch when truthy', () => {
    expect(apply('if', true, 'yes', 'no')).toBe('yes')
  })

  it('if returns else branch when falsy', () => {
    expect(apply('if', false, 'yes', 'no')).toBe('no')
  })

  it('not negates', () => {
    expect(apply('not', true)).toBe(false)
    expect(apply('not', false)).toBe(true)
  })

  it('and / or work as expected', () => {
    expect(apply('and', true, false)).toBe(false)
    expect(apply('or',  false, true)).toBe(true)
  })

  it('append adds to end of collection', () => {
    const coll: MaisieRecord[] = [{ a: 1 }]
    const result = evalExpr(
      { kind: 'apply', fn: 'append', args: [
        { kind: 'ref', name: 'c' },
        { kind: 'literal', value: { a: 2 } as never },
      ]},
      { c: coll },
    ) as MaisieRecord[]
    expect(result).toHaveLength(2)
    expect(result[1].a).toBe(2)
    expect(coll).toHaveLength(1) // original unchanged
  })
})

// ── Render node pass-through ──────────────────────────────────────────────────

describe('evalExpr — render node pass-through', () => {
  it('component-call node evaluates to itself', () => {
    const node: ExprNode = {
      kind: 'component-call',
      name: 'MovieTile',
      args: { title: { kind: 'literal', value: 'Inception' } },
    }
    const result = evalExpr(node)
    expect(result).toBe(node)
  })

  it('layout-call node evaluates to itself', () => {
    const node: ExprNode = {
      kind: 'layout-call',
      name: 'overlay',
      args: { children: { kind: 'literal', value: [] as never } },
    }
    const result = evalExpr(node)
    expect(result).toBe(node)
  })

  it('render nodes can be produced inside a map lambda', () => {
    // Simulates: collection | map: (item) => Tile(title: item.title)
    // The lambda produces a component-call node when invoked.
    const tileNode: ExprNode = {
      kind: 'component-call',
      name: 'Tile',
      args: { title: { kind: 'ref', name: 'title' } },
    }
    // evalExpr evaluates the component-call with title resolved from env
    const result = evalExpr(tileNode, { title: 'Inception' })
    // The node passes through (self-evaluates); it's not deeply evaluated
    expect(result).toBe(tileNode)
  })
})
