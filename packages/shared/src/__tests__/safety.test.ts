import { describe, it, expect } from 'bun:test'
import { inferTier, maxTier } from '../safety'
import type { ActionTier } from '../safety'
import type { ExprNode } from '../ops'

// ── maxTier ───────────────────────────────────────────────────────────────────

describe('maxTier', () => {
  it('inform < act', () => {
    expect(maxTier('inform', 'act')).toBe('act')
    expect(maxTier('act', 'inform')).toBe('act')
  })

  it('act < advise', () => {
    expect(maxTier('act', 'advise')).toBe('advise')
    expect(maxTier('advise', 'act')).toBe('advise')
  })

  it('inform < advise', () => {
    expect(maxTier('inform', 'advise')).toBe('advise')
    expect(maxTier('advise', 'inform')).toBe('advise')
  })

  it('same tier returns same', () => {
    expect(maxTier('inform', 'inform')).toBe('inform')
    expect(maxTier('act', 'act')).toBe('act')
    expect(maxTier('advise', 'advise')).toBe('advise')
  })
})

// ── Helper — tier lookup mock ─────────────────────────────────────────────────

function makeLookup(tiers: Record<string, ActionTier>) {
  return (ref: string): ActionTier | null => tiers[ref] ?? null
}

// ── inferTier ─────────────────────────────────────────────────────────────────

describe('inferTier — literal', () => {
  it('pure literal expression → inform', () => {
    const expr: ExprNode = { kind: 'literal', value: 42 }
    expect(inferTier(expr, makeLookup({}))).toBe('inform')
  })
})

describe('inferTier — ref', () => {
  it('unresolvable ref → inform', () => {
    const expr: ExprNode = { kind: 'ref', name: 'unknown-ref' }
    expect(inferTier(expr, makeLookup({}))).toBe('inform')
  })

  it('ref resolving to inform function → inform', () => {
    const expr: ExprNode = { kind: 'ref', name: 'ha.list_switches' }
    expect(inferTier(expr, makeLookup({ 'ha.list_switches': 'inform' }))).toBe('inform')
  })

  it('ref resolving to advise function → advise', () => {
    const expr: ExprNode = { kind: 'ref', name: 'ha.turn_off' }
    expect(inferTier(expr, makeLookup({ 'ha.turn_off': 'advise' }))).toBe('advise')
  })
})

describe('inferTier — apply', () => {
  it('single inform function call → inform', () => {
    const expr: ExprNode = {
      kind: 'apply',
      fn: 'ha.list_switches',
      args: [],
    }
    expect(inferTier(expr, makeLookup({ 'ha.list_switches': 'inform' }))).toBe('inform')
  })

  it('single advise function call → advise', () => {
    const expr: ExprNode = {
      kind: 'apply',
      fn: 'ha.turn_on',
      args: [],
    }
    expect(inferTier(expr, makeLookup({ 'ha.turn_on': 'advise' }))).toBe('advise')
  })

  it('inform + act → act', () => {
    // inform as the fn, act buried in an arg
    const expr: ExprNode = {
      kind: 'apply',
      fn: 'map',
      args: [
        { kind: 'ref', name: 'switches' },
        { kind: 'ref', name: 'ha.toggle' },  // resolves to 'act'
      ],
    }
    const lookup = makeLookup({ 'ha.toggle': 'act' })
    expect(inferTier(expr, lookup)).toBe('act')
  })

  it('inform + act + advise → advise', () => {
    const expr: ExprNode = {
      kind: 'apply',
      fn: 'map',
      args: [
        { kind: 'ref', name: 'ha.list_switches' },     // inform
        {
          kind: 'apply',
          fn: 'seq',
          args: [
            { kind: 'ref', name: 'ha.toggle' },        // act
            { kind: 'ref', name: 'ha.notify' },        // advise
          ],
        },
      ],
    }
    const lookup = makeLookup({
      'ha.list_switches': 'inform',
      'ha.toggle': 'act',
      'ha.notify': 'advise',
    })
    expect(inferTier(expr, lookup)).toBe('advise')
  })
})

describe('inferTier — lambda', () => {
  it('advise buried in lambda body is surfaced', () => {
    const expr: ExprNode = {
      kind: 'lambda',
      params: ['sw'],
      body: {
        kind: 'apply',
        fn: 'ha.turn_on',
        args: [{ kind: 'ref', name: 'sw' }],
      },
    }
    expect(inferTier(expr, makeLookup({ 'ha.turn_on': 'advise' }))).toBe('advise')
  })

  it('inform-only lambda → inform', () => {
    const expr: ExprNode = {
      kind: 'lambda',
      params: ['x'],
      body: { kind: 'literal', value: true },
    }
    expect(inferTier(expr, makeLookup({}))).toBe('inform')
  })
})

describe('inferTier — let', () => {
  it('advise in binding value is surfaced', () => {
    const expr: ExprNode = {
      kind: 'let',
      bindings: [
        {
          name: 'result',
          value: {
            kind: 'apply',
            fn: 'ha.turn_off',
            args: [],
          },
        },
      ],
      body: { kind: 'ref', name: 'result' },
    }
    expect(inferTier(expr, makeLookup({ 'ha.turn_off': 'advise' }))).toBe('advise')
  })

  it('advise in body is surfaced', () => {
    const expr: ExprNode = {
      kind: 'let',
      bindings: [{ name: 'x', value: { kind: 'literal', value: 1 } }],
      body: {
        kind: 'apply',
        fn: 'ha.delete',
        args: [],
      },
    }
    expect(inferTier(expr, makeLookup({ 'ha.delete': 'advise' }))).toBe('advise')
  })
})

describe('inferTier — pipe', () => {
  it('advise in pipe step is surfaced', () => {
    const expr: ExprNode = {
      kind: 'pipe',
      value: { kind: 'ref', name: 'switches' },
      steps: [
        {
          kind: 'apply',
          fn: 'ha.turn_on_all',
          args: [],
        },
      ],
    }
    expect(inferTier(expr, makeLookup({ 'ha.turn_on_all': 'advise' }))).toBe('advise')
  })

  it('all inform pipe → inform', () => {
    const expr: ExprNode = {
      kind: 'pipe',
      value: { kind: 'ref', name: 'data' },
      steps: [
        { kind: 'apply', fn: 'filter', args: [] },
        { kind: 'apply', fn: 'map', args: [] },
      ],
    }
    expect(inferTier(expr, makeLookup({}))).toBe('inform')
  })
})

describe('inferTier — deep nesting', () => {
  it('advise buried deep in nested lambda inside let inside pipe', () => {
    // pipe { value: ref, steps: [apply { fn: 'map', args: [lambda { body: apply { fn: advise-fn } }] }] }
    const expr: ExprNode = {
      kind: 'pipe',
      value: { kind: 'ref', name: 'items' },
      steps: [
        {
          kind: 'apply',
          fn: 'map',
          args: [
            {
              kind: 'lambda',
              params: ['item'],
              body: {
                kind: 'let',
                bindings: [{ name: 'x', value: { kind: 'literal', value: 1 } }],
                body: {
                  kind: 'apply',
                  fn: 'ha.critical_action',
                  args: [],
                },
              },
            },
          ],
        },
      ],
    }
    expect(inferTier(expr, makeLookup({ 'ha.critical_action': 'advise' }))).toBe('advise')
  })
})
