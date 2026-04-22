import { describe, it, expect } from 'bun:test'
import { evalExprAsync, type AddressResolver } from '../eval'
import { STD_LIB } from '../std-lib'
import type {
  ExprNode,
  MaisieValue,
  MaisieRecord,
  MaisieCollection,
} from '../ops'

// ── Mock resolver ─────────────────────────────────────────────────────────────

const MOCK_DATA: Record<string, MaisieValue> = {
  'home-assistant.list_switches': [
    { name: 'front exterior lights', state: 'on' },
    { name: 'back exterior lights', state: 'off' },
    { name: 'living room', state: 'on' },
  ] as MaisieCollection,
  'home-assistant.switch.front.state': 'on',
  'sensor.temperature': 22,
}

function makeMockResolver(data: Record<string, MaisieValue> = MOCK_DATA): AddressResolver {
  return {
    async resolve(address: string): Promise<MaisieValue> {
      if (address in data) return data[address]
      throw new Error(`Unresolvable address: "${address}"`)
    },
    async invoke(address: string, args: MaisieRecord): Promise<MaisieValue> {
      throw new Error(`Cannot invoke: "${address}"`)
    },
  }
}

const resolver = makeMockResolver()

// ── Literal resolution ────────────────────────────────────────────────────────

describe('evalExprAsync — literals', () => {
  it('resolves integer literal', async () => {
    const result = await evalExprAsync({ kind: 'literal', value: 42 }, resolver)
    expect(result).toBe(42)
  })

  it('resolves string literal', async () => {
    const result = await evalExprAsync({ kind: 'literal', value: 'hello' }, resolver)
    expect(result).toBe('hello')
  })

  it('resolves boolean literal', async () => {
    expect(await evalExprAsync({ kind: 'literal', value: true }, resolver)).toBe(true)
    expect(await evalExprAsync({ kind: 'literal', value: false }, resolver)).toBe(false)
  })

  it('resolves null literal', async () => {
    expect(await evalExprAsync({ kind: 'literal', value: null }, resolver)).toBeNull()
  })
})

// ── Ref resolution ────────────────────────────────────────────────────────────

describe('evalExprAsync — refs', () => {
  it('resolves ref from env (env takes priority)', async () => {
    const result = await evalExprAsync(
      { kind: 'ref', name: 'x' },
      resolver,
      { x: 99 },
    )
    expect(result).toBe(99)
  })

  it('resolves ref via resolver when not in env', async () => {
    const result = await evalExprAsync(
      { kind: 'ref', name: 'sensor.temperature' },
      resolver,
    )
    expect(result).toBe(22)
  })

  it('resolves compound address via resolver', async () => {
    const result = await evalExprAsync(
      { kind: 'ref', name: 'home-assistant.switch.front.state' },
      resolver,
    )
    expect(result).toBe('on')
  })

  it('throws when ref unresolvable', async () => {
    expect(
      evalExprAsync({ kind: 'ref', name: 'nonexistent.address' }, resolver)
    ).rejects.toThrow('Unresolvable address')
  })
})

// ── Lambda creation and invocation ───────────────────────────────────────────

describe('evalExprAsync — lambda', () => {
  it('returns a callable function', async () => {
    const lambdaNode: ExprNode = {
      kind: 'lambda',
      params: ['x'],
      body: { kind: 'apply', fn: 'add', args: [{ kind: 'ref', name: 'x' }, { kind: 'literal', value: 1 }] },
    }
    const fn = await evalExprAsync(lambdaNode, resolver)
    expect(typeof fn).toBe('function')
  })

  it('invokes lambda with params correctly', async () => {
    const lambdaNode: ExprNode = {
      kind: 'lambda',
      params: ['x'],
      body: { kind: 'apply', fn: 'add', args: [{ kind: 'ref', name: 'x' }, { kind: 'literal', value: 10 }] },
    }
    const fn = await evalExprAsync(lambdaNode, resolver) as (args: MaisieRecord) => Promise<MaisieValue>
    const result = await fn({ x: 5 })
    expect(result).toBe(15)
  })

  it('lambda closes over outer env', async () => {
    const lambdaNode: ExprNode = {
      kind: 'lambda',
      params: ['x'],
      body: { kind: 'apply', fn: 'add', args: [{ kind: 'ref', name: 'x' }, { kind: 'ref', name: 'base' }] },
    }
    const fn = await evalExprAsync(lambdaNode, resolver, { base: 100 }) as (args: MaisieRecord) => Promise<MaisieValue>
    const result = await fn({ x: 5 })
    expect(result).toBe(105)
  })

  it('lambda can capture async-resolved values', async () => {
    // A lambda that references a resolver address in its body
    const lambdaNode: ExprNode = {
      kind: 'lambda',
      params: ['offset'],
      body: { kind: 'apply', fn: 'add', args: [{ kind: 'ref', name: 'sensor.temperature' }, { kind: 'ref', name: 'offset' }] },
    }
    const fn = await evalExprAsync(lambdaNode, resolver) as (args: MaisieRecord) => Promise<MaisieValue>
    const result = await fn({ offset: 3 })
    expect(result).toBe(25) // 22 + 3
  })
})

// ── Primitive calls ───────────────────────────────────────────────────────────

describe('evalExprAsync — primitives', () => {
  it('evaluates add', async () => {
    const result = await evalExprAsync(
      { kind: 'apply', fn: 'add', args: [{ kind: 'literal', value: 3 }, { kind: 'literal', value: 4 }] },
      resolver,
    )
    expect(result).toBe(7)
  })

  it('evaluates eq', async () => {
    expect(await evalExprAsync(
      { kind: 'apply', fn: 'eq', args: [{ kind: 'literal', value: 'a' }, { kind: 'literal', value: 'a' }] },
      resolver,
    )).toBe(true)
  })

  it('evaluates contains', async () => {
    expect(await evalExprAsync(
      { kind: 'apply', fn: 'contains', args: [{ kind: 'literal', value: 'hello world' }, { kind: 'literal', value: 'world' }] },
      resolver,
    )).toBe(true)
  })

  it('evaluates nested apply', async () => {
    // (3 + 4) * 2 = 14
    const result = await evalExprAsync({
      kind: 'apply', fn: 'mul',
      args: [
        { kind: 'apply', fn: 'add', args: [{ kind: 'literal', value: 3 }, { kind: 'literal', value: 4 }] },
        { kind: 'literal', value: 2 },
      ],
    }, resolver)
    expect(result).toBe(14)
  })

  it('throws on unknown function', async () => {
    expect(
      evalExprAsync({ kind: 'apply', fn: 'nonexistent', args: [] }, resolver)
    ).rejects.toThrow('Unknown function')
  })
})

// ── FunctionDef calls ────────────────────────────────────────────────────────

describe('evalExprAsync — FunctionDef (std library)', () => {
  const nums: MaisieCollection = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }]

  it('std.count via apply', async () => {
    const result = await evalExprAsync(
      { kind: 'apply', fn: 'std.count', args: [{ kind: 'literal', value: nums as never }] },
      resolver,
      {},
      STD_LIB,
    )
    expect(result).toBe(5)
  })

  it('std.filter via apply with native predicate', async () => {
    // The std.filter FunctionDef calls call(pred, item) where item is the record directly.
    // Native JS functions receive the record as args and access fields directly.
    const pred = (args: MaisieRecord) => (args.n as number) > 3
    const result = await evalExprAsync(
      { kind: 'apply', fn: 'std.filter', args: [{ kind: 'literal', value: nums as never }, { kind: 'literal', value: pred as never }] },
      resolver,
      {},
      STD_LIB,
    ) as MaisieCollection
    expect(result.map(r => r.n)).toEqual([4, 5])
  })

  it('std.map via apply with native function', async () => {
    // Native JS function receives record directly as args.
    const fn = (args: MaisieRecord) => ({ ...args, n2: (args.n as number) * 2 })
    const result = await evalExprAsync(
      { kind: 'apply', fn: 'std.map', args: [{ kind: 'literal', value: nums as never }, { kind: 'literal', value: fn as never }] },
      resolver,
      {},
      STD_LIB,
    ) as MaisieCollection
    expect(result.map(r => r.n2)).toEqual([2, 4, 6, 8, 10])
  })

  it('std.pluck via apply', async () => {
    const result = await evalExprAsync(
      {
        kind: 'apply', fn: 'std.pluck',
        args: [{ kind: 'literal', value: nums as never }, { kind: 'literal', value: 'n' }],
      },
      resolver,
      {},
      STD_LIB,
    )
    expect(result).toEqual([1, 2, 3, 4, 5])
  })

  it('std.any — true when match exists', async () => {
    const pred = (args: MaisieRecord) => args.n === 3
    const result = await evalExprAsync(
      { kind: 'apply', fn: 'std.any', args: [{ kind: 'literal', value: nums as never }, { kind: 'literal', value: pred as never }] },
      resolver, {}, STD_LIB,
    )
    expect(result).toBe(true)
  })

  it('std.any — false when no match', async () => {
    const pred = (args: MaisieRecord) => args.n === 99
    const result = await evalExprAsync(
      { kind: 'apply', fn: 'std.any', args: [{ kind: 'literal', value: nums as never }, { kind: 'literal', value: pred as never }] },
      resolver, {}, STD_LIB,
    )
    expect(result).toBe(false)
  })

  it('std.all — true when all match', async () => {
    const pred = (args: MaisieRecord) => (args.n as number) > 0
    const result = await evalExprAsync(
      { kind: 'apply', fn: 'std.all', args: [{ kind: 'literal', value: nums as never }, { kind: 'literal', value: pred as never }] },
      resolver, {}, STD_LIB,
    )
    expect(result).toBe(true)
  })

  it('std.first returns first element', async () => {
    const result = await evalExprAsync(
      { kind: 'apply', fn: 'std.first', args: [{ kind: 'literal', value: nums as never }] },
      resolver, {}, STD_LIB,
    ) as MaisieRecord
    expect(result.n).toBe(1)
  })

  it('std.last returns last element', async () => {
    const result = await evalExprAsync(
      { kind: 'apply', fn: 'std.last', args: [{ kind: 'literal', value: nums as never }] },
      resolver, {}, STD_LIB,
    ) as MaisieRecord
    expect(result.n).toBe(5)
  })

  it('std.first returns null for empty collection', async () => {
    const result = await evalExprAsync(
      { kind: 'apply', fn: 'std.first', args: [{ kind: 'literal', value: [] as never }] },
      resolver, {}, STD_LIB,
    )
    expect(result).toBeNull()
  })
})

// ── Let bindings ──────────────────────────────────────────────────────────────

describe('evalExprAsync — let bindings', () => {
  it('evaluates a simple let binding', async () => {
    const node: ExprNode = {
      kind: 'let',
      bindings: [{ name: 'x', value: { kind: 'literal', value: 10 } }],
      body: { kind: 'apply', fn: 'add', args: [{ kind: 'ref', name: 'x' }, { kind: 'literal', value: 5 }] },
    }
    expect(await evalExprAsync(node, resolver)).toBe(15)
  })

  it('each binding is available to subsequent bindings', async () => {
    const node: ExprNode = {
      kind: 'let',
      bindings: [
        { name: 'x', value: { kind: 'literal', value: 10 } },
        { name: 'y', value: { kind: 'apply', fn: 'mul', args: [{ kind: 'ref', name: 'x' }, { kind: 'literal', value: 2 }] } },
      ],
      body: { kind: 'ref', name: 'y' },
    }
    expect(await evalExprAsync(node, resolver)).toBe(20)
  })

  it('let binding can use async resolver', async () => {
    // x = sensor.temperature (resolved via resolver)
    const node: ExprNode = {
      kind: 'let',
      bindings: [
        { name: 'temp', value: { kind: 'ref', name: 'sensor.temperature' } },
      ],
      body: { kind: 'apply', fn: 'add', args: [{ kind: 'ref', name: 'temp' }, { kind: 'literal', value: 0 }] },
    }
    expect(await evalExprAsync(node, resolver)).toBe(22)
  })

  it('let binding does not leak to outer scope', async () => {
    const node: ExprNode = {
      kind: 'let',
      bindings: [{ name: 'inner', value: { kind: 'literal', value: 42 } }],
      body: { kind: 'literal', value: 0 },
    }
    await evalExprAsync(node, resolver)
    // inner should not be in outer env — this is tested by the fact that
    // a ref to 'inner' at top level would throw
    expect(
      evalExprAsync({ kind: 'ref', name: 'inner' }, resolver)
    ).rejects.toThrow()
  })
})

// ── Pipe chains ───────────────────────────────────────────────────────────────

describe('evalExprAsync — pipe chains', () => {
  const switches: MaisieCollection = [
    { name: 'front exterior lights', state: 'on' },
    { name: 'back exterior lights', state: 'off' },
    { name: 'living room', state: 'on' },
  ]

  it('threads value through filter step', async () => {
    // Native predicate: the filter FunctionDef calls pred(item) directly where item is the record.
    const filterPred = (args: MaisieRecord) => String(args.name ?? '').includes('exterior')
    const filterStep: ExprNode = {
      kind: 'apply', fn: 'std.filter',
      args: [{ kind: 'literal', value: filterPred as never }],
    }
    const node: ExprNode = {
      kind: 'pipe',
      value: { kind: 'literal', value: switches as never },
      steps: [filterStep],
    }
    const result = await evalExprAsync(node, resolver, {}, STD_LIB) as MaisieCollection
    expect(result).toHaveLength(2)
    expect(result.map(r => r.name)).toEqual(['front exterior lights', 'back exterior lights'])
  })

  it('chains multiple steps: filter → pluck', async () => {
    const filterPred = (args: MaisieRecord) => args.state === 'on'
    const node: ExprNode = {
      kind: 'pipe',
      value: { kind: 'literal', value: switches as never },
      steps: [
        {
          kind: 'apply', fn: 'std.filter',
          args: [{ kind: 'literal', value: filterPred as never }],
        },
        { kind: 'apply', fn: 'std.pluck', args: [{ kind: 'literal', value: 'name' }] },
      ],
    }
    const result = await evalExprAsync(node, resolver, {}, STD_LIB) as MaisieCollection
    expect(result).toEqual(['front exterior lights', 'living room'])
  })

  it('pipe with async resolver: resolves collection then filters', async () => {
    // home-assistant.list_switches | filter: name contains "exterior"
    const filterPred = (args: MaisieRecord) => String(args.name ?? '').includes('exterior')
    const node: ExprNode = {
      kind: 'pipe',
      value: { kind: 'ref', name: 'home-assistant.list_switches' },
      steps: [{
        kind: 'apply', fn: 'std.filter',
        args: [{ kind: 'literal', value: filterPred as never }],
      }],
    }
    const result = await evalExprAsync(node, resolver, {}, STD_LIB) as MaisieCollection
    expect(result).toHaveLength(2)
    expect(result.every(r => String(r.name).includes('exterior'))).toBe(true)
  })

  it('count step produces scalar', async () => {
    const node: ExprNode = {
      kind: 'pipe',
      value: { kind: 'literal', value: switches as never },
      steps: [{ kind: 'apply', fn: 'std.count', args: [] }],
    }
    const result = await evalExprAsync(node, resolver, {}, STD_LIB)
    expect(result).toBe(3)
  })
})

// ── Combined let + pipe ───────────────────────────────────────────────────────

describe('evalExprAsync — let + pipe combined', () => {
  it('filters and plucks with let binding', async () => {
    const switchList: MaisieCollection = [
      { name: 'front exterior', state: 'on' },
      { name: 'back exterior', state: 'off' },
      { name: 'living room', state: 'on' },
    ]
    const filterPred = (args: MaisieRecord) => String(args.name ?? '').includes('exterior')
    const node: ExprNode = {
      kind: 'let',
      bindings: [{
        name: 'ext',
        value: {
          kind: 'pipe',
          value: { kind: 'literal', value: switchList as never },
          steps: [{
            kind: 'apply', fn: 'std.filter',
            args: [{ kind: 'literal', value: filterPred as never }],
          }],
        },
      }],
      body: {
        kind: 'pipe',
        value: { kind: 'ref', name: 'ext' },
        steps: [{ kind: 'apply', fn: 'std.count', args: [] }],
      },
    }
    const result = await evalExprAsync(node, resolver, {}, STD_LIB)
    expect(result).toBe(2)
  })
})

// ── Error propagation ────────────────────────────────────────────────────────

describe('evalExprAsync — errors', () => {
  it('propagates unknown function error', async () => {
    expect(
      evalExprAsync({ kind: 'apply', fn: 'doesNotExist', args: [] }, resolver)
    ).rejects.toThrow('Unknown function')
  })

  it('propagates resolver failure', async () => {
    const badResolver: AddressResolver = {
      async resolve(): Promise<MaisieValue> { throw new Error('Service unavailable') },
      async invoke(): Promise<MaisieValue> { throw new Error('Service unavailable') },
    }
    expect(
      evalExprAsync({ kind: 'ref', name: 'some.address' }, badResolver)
    ).rejects.toThrow('Service unavailable')
  })

  it('propagates error from nested apply', async () => {
    const node: ExprNode = {
      kind: 'apply', fn: 'add',
      args: [
        { kind: 'ref', name: 'nonexistent' },
        { kind: 'literal', value: 1 },
      ],
    }
    expect(evalExprAsync(node, resolver)).rejects.toThrow()
  })
})
