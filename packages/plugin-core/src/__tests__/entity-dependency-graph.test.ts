import { describe, it, expect, beforeEach } from 'bun:test'
import { EntityDependencyGraph } from '../entity-dependency-graph'
import type { EntityDef } from '@maisie/shared'

function makeDerived(name: string, refs: string[]): EntityDef {
  return {
    name,
    source: 'derived',
    fields: {
      result: {
        kind: 'data',
        type: 'record',
        expression: refs.length === 0
          ? { kind: 'literal', value: null }
          : refs.length === 1
            ? { kind: 'ref', name: refs[0] }
            : {
                kind: 'let',
                bindings: refs.slice(0, -1).map((r) => ({ name: r, value: { kind: 'ref', name: r } })),
                body: { kind: 'ref', name: refs[refs.length - 1] },
              },
      },
    },
  }
}

function makeBase(name: string): EntityDef {
  return {
    name,
    source: 'plugin',
    pluginName: 'test-plugin',
    fields: {
      result: { kind: 'data', type: 'record', actionName: 'test_action' },
    },
  }
}

describe('EntityDependencyGraph', () => {
  let graph: EntityDependencyGraph

  beforeEach(() => {
    graph = new EntityDependencyGraph()
  })

  it('registers no deps for base entities', () => {
    const base = makeBase('ha.list_switches')
    const known = new Set(['ha.list_switches'])
    graph.register(base, known)
    expect(graph.dependentsOf('ha.list_switches')).toEqual([])
  })

  it('simple: derived entity references one base entity', () => {
    const base = makeBase('ha.list_switches')
    const derived = makeDerived('exterior-lights', ['ha.list_switches'])
    const known = new Set(['ha.list_switches', 'exterior-lights'])

    graph.register(base, known)
    graph.register(derived, known)

    expect(graph.dependentsOf('ha.list_switches')).toContain('exterior-lights')
    expect(graph.dependentsOf('ha.list_switches')).toHaveLength(1)
  })

  it('multiple: derived references two base entities', () => {
    const base1 = makeBase('ha.list_switches')
    const base2 = makeBase('ha.list_lights')
    const derived: EntityDef = {
      name: 'all-devices',
      source: 'derived',
      fields: {
        switches: {
          kind: 'data',
          type: 'collection',
          expression: { kind: 'ref', name: 'ha.list_switches' },
        },
        lights: {
          kind: 'data',
          type: 'collection',
          expression: { kind: 'ref', name: 'ha.list_lights' },
        },
      },
    }
    const known = new Set(['ha.list_switches', 'ha.list_lights', 'all-devices'])

    graph.register(base1, known)
    graph.register(base2, known)
    graph.register(derived, known)

    expect(graph.dependentsOf('ha.list_switches')).toContain('all-devices')
    expect(graph.dependentsOf('ha.list_lights')).toContain('all-devices')
  })

  it('transitive: A depends on B which depends on base → transitiveDependentsOf(base) includes A', () => {
    const base = makeBase('ha.list_switches')
    const b = makeDerived('exterior-switches', ['ha.list_switches'])
    const a = makeDerived('exterior-lights', ['exterior-switches'])
    const known = new Set(['ha.list_switches', 'exterior-switches', 'exterior-lights'])

    graph.register(base, known)
    graph.register(b, known)
    graph.register(a, known)

    const result = graph.transitiveDependentsOf('ha.list_switches')
    expect(result).toContain('exterior-switches')
    expect(result).toContain('exterior-lights')
  })

  it('transitive: direct dep only included once', () => {
    const base = makeBase('ha.list_switches')
    const derived = makeDerived('exterior-lights', ['ha.list_switches'])
    const known = new Set(['ha.list_switches', 'exterior-lights'])

    graph.register(base, known)
    graph.register(derived, known)

    const result = graph.transitiveDependentsOf('ha.list_switches')
    expect(result.filter((x) => x === 'exterior-lights')).toHaveLength(1)
  })

  it('unregister removes tracking from both directions', () => {
    const base = makeBase('ha.list_switches')
    const derived = makeDerived('exterior-lights', ['ha.list_switches'])
    const known = new Set(['ha.list_switches', 'exterior-lights'])

    graph.register(base, known)
    graph.register(derived, known)
    expect(graph.dependentsOf('ha.list_switches')).toContain('exterior-lights')

    graph.unregister('exterior-lights')
    expect(graph.dependentsOf('ha.list_switches')).not.toContain('exterior-lights')
  })

  it('longest-prefix match: ha.list_switches.name matches ha.list_switches not ha', () => {
    // Ref is "ha.list_switches.name" — should match "ha.list_switches" (an entity),
    // not "ha" (hypothetically also an entity, but shorter prefix).
    const base1 = makeBase('ha')
    const base2 = makeBase('ha.list_switches')
    const derived: EntityDef = {
      name: 'exterior-lights',
      source: 'derived',
      fields: {
        names: {
          kind: 'data',
          type: 'collection',
          expression: { kind: 'ref', name: 'ha.list_switches.name' },
        },
      },
    }
    const known = new Set(['ha', 'ha.list_switches', 'exterior-lights'])

    graph.register(base1, known)
    graph.register(base2, known)
    graph.register(derived, known)

    // exterior-lights depends on ha.list_switches, not ha
    expect(graph.dependentsOf('ha.list_switches')).toContain('exterior-lights')
    expect(graph.dependentsOf('ha')).not.toContain('exterior-lights')
  })

  it('expression with no entity references → empty deps', () => {
    const derived: EntityDef = {
      name: 'static-entity',
      source: 'derived',
      fields: {
        value: {
          kind: 'data',
          type: 'string',
          expression: { kind: 'literal', value: 'hello' },
        },
      },
    }
    const known = new Set(['static-entity'])
    graph.register(derived, known)
    // No base entity is tracked
    expect(graph.transitiveDependentsOf('anything')).toEqual([])
  })

  it('clear removes all tracking', () => {
    const base = makeBase('ha.list_switches')
    const derived = makeDerived('exterior-lights', ['ha.list_switches'])
    const known = new Set(['ha.list_switches', 'exterior-lights'])

    graph.register(base, known)
    graph.register(derived, known)
    graph.clear()

    expect(graph.dependentsOf('ha.list_switches')).toEqual([])
    expect(graph.transitiveDependentsOf('ha.list_switches')).toEqual([])
  })

  it('collects refs from apply node args', () => {
    const base = makeBase('ha.list_switches')
    const derived: EntityDef = {
      name: 'filtered',
      source: 'derived',
      fields: {
        result: {
          kind: 'data',
          type: 'collection',
          expression: {
            kind: 'apply',
            fn: 'filter',
            args: [
              { kind: 'ref', name: 'ha.list_switches' },
              { kind: 'lambda', params: ['x'], body: { kind: 'literal', value: true } },
            ],
          },
        },
      },
    }
    const known = new Set(['ha.list_switches', 'filtered'])

    graph.register(base, known)
    graph.register(derived, known)

    expect(graph.dependentsOf('ha.list_switches')).toContain('filtered')
  })

  it('collects refs from pipe steps', () => {
    const base = makeBase('ha.list_switches')
    const derived: EntityDef = {
      name: 'piped',
      source: 'derived',
      fields: {
        result: {
          kind: 'data',
          type: 'collection',
          expression: {
            kind: 'pipe',
            value: { kind: 'ref', name: 'ha.list_switches' },
            steps: [
              { kind: 'apply', fn: 'filter', args: [{ kind: 'literal', value: true }] },
            ],
          },
        },
      },
    }
    const known = new Set(['ha.list_switches', 'piped'])

    graph.register(base, known)
    graph.register(derived, known)

    expect(graph.dependentsOf('ha.list_switches')).toContain('piped')
  })
})
