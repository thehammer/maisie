import { describe, it, expect } from 'bun:test'
import {
  findRoot,
  canEmitComponent,
  canEmitEntity,
  emitComponent,
  emitEntity,
} from '../emit'
import type { CanvasDocument, Placement } from '../document'
import type { ComponentDef } from '@maisie/shared'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeDoc(
  placements: Array<Omit<Placement, 'id'> & { id: string }>,
  wires: CanvasDocument['wires'] = [],
): CanvasDocument {
  return { version: 1, placements, wires }
}

function entityPlacement(id: string, targetName: string): Placement {
  return { id, kind: 'entity', targetName, position: { x: 0, y: 0 } }
}

function componentPlacement(id: string, targetName: string): Placement {
  return { id, kind: 'component', targetName, position: { x: 100, y: 0 } }
}

// A minimal component def resolver that knows about a few components
const knownComponents: Record<string, ComponentDef> = {
  Strip: { name: 'Strip', kind: 'layout', description: 'horizontal strip' },
  MovieTile: {
    name: 'MovieTile',
    kind: 'derived',
    description: 'renders a movie tile',
    input: { kind: 'record', fields: { title: { kind: 'scalar', type: 'string' } } },
  },
  Stack: { name: 'Stack', kind: 'layout' },
}

function resolveComponentDef(name: string): ComponentDef | undefined {
  return knownComponents[name]
}

// ── findRoot ──────────────────────────────────────────────────────────────────

describe('findRoot', () => {
  it('returns the single placement with no outgoing wires', () => {
    const p1 = entityPlacement('p1', 'plex.recently_added')
    const p2 = componentPlacement('p2', 'MovieTile')
    // p1 → p2 (p1 is the source, p2 is the target)
    // p1 has an outgoing wire → not the root; p2 has no outgoing wires → root
    const doc = makeDoc([p1, p2], [
      { id: 'w1', source: { placementId: 'p1' }, target: { placementId: 'p2' } },
    ])
    const root = findRoot(doc)
    expect(root).not.toBeNull()
    expect(root!.id).toBe('p2')
  })

  it('returns null when all placements have outgoing wires (cycle-like)', () => {
    const p1 = entityPlacement('p1', 'e1')
    const p2 = componentPlacement('p2', 'C')
    const doc = makeDoc([p1, p2], [
      { id: 'w1', source: { placementId: 'p1' }, target: { placementId: 'p2' } },
      { id: 'w2', source: { placementId: 'p2' }, target: { placementId: 'p1' } },
    ])
    expect(findRoot(doc)).toBeNull()
  })

  it('returns null when multiple placements have no outgoing wires', () => {
    // Two disconnected placements — both are roots
    const p1 = entityPlacement('p1', 'e1')
    const p2 = componentPlacement('p2', 'C')
    const doc = makeDoc([p1, p2], [])
    expect(findRoot(doc)).toBeNull()
  })

  it('returns the single placement in a single-placement canvas', () => {
    const p1 = componentPlacement('p1', 'MovieTile')
    const doc = makeDoc([p1])
    const root = findRoot(doc)
    expect(root).not.toBeNull()
    expect(root!.id).toBe('p1')
  })

  it('returns null for an empty canvas', () => {
    expect(findRoot(makeDoc([]))).toBeNull()
  })
})

// ── canEmitComponent ──────────────────────────────────────────────────────────

describe('canEmitComponent', () => {
  it('fails on an empty canvas', () => {
    const result = canEmitComponent(makeDoc([]))
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/empty/)
  })

  it('fails when root is an entity placement', () => {
    // Single entity placement — it's the root, but it's not a component
    const p = entityPlacement('p1', 'plex.recently_added')
    const result = canEmitComponent(makeDoc([p]))
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/component/)
  })

  it('fails when there is no unique root (multiple unconnected placements)', () => {
    const p1 = componentPlacement('p1', 'MovieTile')
    const p2 = componentPlacement('p2', 'Strip')
    const result = canEmitComponent(makeDoc([p1, p2]))
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/root/)
  })

  it('succeeds when root is a component placement', () => {
    const entity = entityPlacement('e1', 'plex.recently_added')
    const comp = componentPlacement('c1', 'MovieTile')
    const doc = makeDoc([entity, comp], [
      { id: 'w1', source: { placementId: 'e1' }, target: { placementId: 'c1' } },
    ])
    expect(canEmitComponent(doc)).toEqual({ ok: true })
  })

  it('succeeds with a single component placement on canvas', () => {
    const comp = componentPlacement('c1', 'MovieTile')
    expect(canEmitComponent(makeDoc([comp]))).toEqual({ ok: true })
  })
})

// ── canEmitEntity ─────────────────────────────────────────────────────────────

describe('canEmitEntity', () => {
  it('fails on an empty canvas', () => {
    const result = canEmitEntity(makeDoc([]))
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/empty/)
  })

  it('fails when there is no unique root', () => {
    const p1 = entityPlacement('p1', 'e1')
    const p2 = entityPlacement('p2', 'e2')
    const result = canEmitEntity(makeDoc([p1, p2]))
    expect(result.ok).toBe(false)
  })

  it('succeeds with an entity root', () => {
    const p = entityPlacement('p1', 'plex.recently_added')
    expect(canEmitEntity(makeDoc([p]))).toEqual({ ok: true })
  })

  it('succeeds with a component root (entity wraps the render tree as data)', () => {
    const entity = entityPlacement('e1', 'plex.recently_added')
    const comp = componentPlacement('c1', 'MovieTile')
    const doc = makeDoc([entity, comp], [
      { id: 'w1', source: { placementId: 'e1' }, target: { placementId: 'c1' } },
    ])
    expect(canEmitEntity(doc)).toEqual({ ok: true })
  })
})

// ── emitComponent ─────────────────────────────────────────────────────────────

describe('emitComponent', () => {
  it('returns an error when canvas is not emittable', () => {
    const result = emitComponent(makeDoc([]), { name: 'MyComp' }, resolveComponentDef)
    expect(result.ok).toBe(false)
  })

  it('emits a ComponentDef with a component-call render for a single component', () => {
    const comp = componentPlacement('c1', 'MovieTile')
    const doc = makeDoc([comp])
    const result = emitComponent(doc, { name: 'MyMovieTile' }, resolveComponentDef)
    expect(result.ok).toBe(true)
    const artifact = result.artifact!
    expect(artifact.name).toBe('MyMovieTile')
    expect(artifact.kind).toBe('derived')
    expect(artifact.render).toBeDefined()
    expect(artifact.render!.kind).toBe('component-call')
    if (artifact.render!.kind === 'component-call') {
      expect(artifact.render!.name).toBe('MovieTile')
    }
  })

  it('emits a layout-call render when root is a layout component', () => {
    const comp = componentPlacement('c1', 'Strip')
    const doc = makeDoc([comp])
    const result = emitComponent(doc, { name: 'MyStrip' }, resolveComponentDef)
    expect(result.ok).toBe(true)
    expect(result.artifact!.render!.kind).toBe('layout-call')
  })

  it('wires an entity source into the component call args', () => {
    const entity = entityPlacement('e1', 'plex.recently_added')
    const comp = componentPlacement('c1', 'MovieTile')
    const doc = makeDoc([entity, comp], [
      { id: 'w1', source: { placementId: 'e1' }, target: { placementId: 'c1', slot: 'input' } },
    ])
    const result = emitComponent(doc, { name: 'PlexMovieTile' }, resolveComponentDef)
    expect(result.ok).toBe(true)
    const render = result.artifact!.render!
    expect(render.kind).toBe('component-call')
    if (render.kind === 'component-call') {
      expect(render.args.input).toBeDefined()
      expect(render.args.input.kind).toBe('ref')
      if (render.args.input.kind === 'ref') {
        expect(render.args.input.name).toBe('plex.recently_added.result')
      }
    }
  })

  it('uses default slot name "input" when wire has no target slot', () => {
    const entity = entityPlacement('e1', 'home.switches')
    const comp = componentPlacement('c1', 'MovieTile')
    // wire with no slot specified
    const doc = makeDoc([entity, comp], [
      { id: 'w1', source: { placementId: 'e1' }, target: { placementId: 'c1' } },
    ])
    const result = emitComponent(doc, { name: 'SwitchView' }, resolveComponentDef)
    expect(result.ok).toBe(true)
    const render = result.artifact!.render!
    if (render.kind === 'component-call') {
      expect(render.args.input).toBeDefined()
    }
  })

  it('applies a wire transform as an apply node wrapping the source', () => {
    const entity = entityPlacement('e1', 'plex.recently_added')
    const comp = componentPlacement('c1', 'MovieTile')
    const doc = makeDoc([entity, comp], [
      {
        id: 'w1',
        source: { placementId: 'e1' },
        target: { placementId: 'c1', slot: 'input' },
        transform: { kind: 'pick', fields: ['title', 'thumbUrl'] },
      },
    ])
    const result = emitComponent(doc, { name: 'PlexMovieTilePicked' }, resolveComponentDef)
    expect(result.ok).toBe(true)
    const render = result.artifact!.render!
    if (render.kind === 'component-call') {
      const inputExpr = render.args.input
      expect(inputExpr).toBeDefined()
      // Should be an apply(call, [lambda, ref]) wrapping the source ref
      expect(inputExpr.kind).toBe('apply')
      if (inputExpr.kind === 'apply') {
        expect(inputExpr.fn).toBe('call')
        expect(inputExpr.args).toHaveLength(2)
        // First arg is the compiled lambda, second is the source ref
        expect(inputExpr.args[0].kind).toBe('lambda')
        expect(inputExpr.args[1].kind).toBe('ref')
      }
    }
  })

  it('does not apply a transform wrapper for identity transforms', () => {
    const entity = entityPlacement('e1', 'plex.recently_added')
    const comp = componentPlacement('c1', 'MovieTile')
    const doc = makeDoc([entity, comp], [
      {
        id: 'w1',
        source: { placementId: 'e1' },
        target: { placementId: 'c1', slot: 'input' },
        transform: { kind: 'identity' },
      },
    ])
    const result = emitComponent(doc, { name: 'PlexMovieTileIdentity' }, resolveComponentDef)
    expect(result.ok).toBe(true)
    const render = result.artifact!.render!
    if (render.kind === 'component-call') {
      // Identity transform → source ref is passed through directly
      expect(render.args.input.kind).toBe('ref')
    }
  })

  it('includes description in the artifact', () => {
    const comp = componentPlacement('c1', 'MovieTile')
    const result = emitComponent(
      makeDoc([comp]),
      { name: 'MyComp', description: 'a nice tile' },
      resolveComponentDef,
    )
    expect(result.artifact!.description).toBe('a nice tile')
  })

  it('errors when root component is not found in the resolver', () => {
    const comp = componentPlacement('c1', 'UnknownWidget')
    const result = emitComponent(makeDoc([comp]), { name: 'X' }, resolveComponentDef)
    // Should still succeed for emit — the resolver not finding a component
    // means we treat it as a standard (non-layout) component call.
    // The emit doesn't require the component to exist; it just checks kind.
    // This validates graceful handling when def is undefined (non-layout path).
    expect(result.ok).toBe(true)
    expect(result.artifact!.render!.kind).toBe('component-call')
  })
})

// ── emitEntity ────────────────────────────────────────────────────────────────

describe('emitEntity', () => {
  it('returns an error when canvas is not emittable', () => {
    const result = emitEntity(makeDoc([]), { name: 'MyEntity' }, resolveComponentDef)
    expect(result.ok).toBe(false)
  })

  it('emits an EntityDef with a ref to the entity primary field for an entity root', () => {
    const entity = entityPlacement('e1', 'plex.recently_added')
    const doc = makeDoc([entity])
    const result = emitEntity(doc, { name: 'plex-view' }, resolveComponentDef)
    expect(result.ok).toBe(true)
    const artifact = result.artifact!
    expect(artifact.name).toBe('plex-view')
    expect(artifact.source).toBe('derived')
    expect(artifact.fields.result).toBeDefined()
    const field = artifact.fields.result
    expect(field.kind).toBe('data')
    if (field.kind === 'data') {
      expect(field.expression).toBeDefined()
      expect(field.expression!.kind).toBe('ref')
      if (field.expression!.kind === 'ref') {
        expect(field.expression!.name).toBe('plex.recently_added.result')
      }
    }
  })

  it('emits an EntityDef with a render tree for a component root', () => {
    const entity = entityPlacement('e1', 'plex.recently_added')
    const comp = componentPlacement('c1', 'MovieTile')
    const doc = makeDoc([entity, comp], [
      { id: 'w1', source: { placementId: 'e1' }, target: { placementId: 'c1', slot: 'input' } },
    ])
    const result = emitEntity(doc, { name: 'movie-view' }, resolveComponentDef)
    expect(result.ok).toBe(true)
    const artifact = result.artifact!
    const field = artifact.fields.result
    expect(field.kind).toBe('data')
    if (field.kind === 'data') {
      // Component root → render tree as data
      expect(field.expression!.kind).toBe('component-call')
    }
  })

  it('includes description in the artifact', () => {
    const entity = entityPlacement('e1', 'plex.recently_added')
    const result = emitEntity(
      makeDoc([entity]),
      { name: 'plex-view', description: 'recently added movies' },
      resolveComponentDef,
    )
    expect(result.artifact!.description).toBe('recently added movies')
  })
})

// ── Function placement helpers ────────────────────────────────────────────────

function functionPlacement(id: string, targetName: string, config?: Record<string, unknown>): Placement {
  return { id, kind: 'function', targetName, position: { x: 80, y: 0 }, config }
}

// ── Function placement composition ───────────────────────────────────────────

describe('emitComponent — function placement in chain', () => {
  it('entity → function → component produces apply node wrapping the entity ref', () => {
    const entity = entityPlacement('e1', 'plex.recently_added')
    const fn = functionPlacement('f1', 'std.limit', { n: 5 })
    const comp = componentPlacement('c1', 'Strip')

    const doc = makeDoc([entity, fn, comp], [
      { id: 'w1', source: { placementId: 'e1' }, target: { placementId: 'f1' } },
      { id: 'w2', source: { placementId: 'f1' }, target: { placementId: 'c1', slot: 'input' } },
    ])

    const result = emitComponent(doc, { name: 'LimitedStrip' }, resolveComponentDef)
    expect(result.ok).toBe(true)
    const render = result.artifact!.render!
    expect(render.kind).toBe('layout-call')
    if (render.kind === 'layout-call') {
      const inputArg = render.args.input
      expect(inputArg).toBeDefined()
      // Should be an apply node for std.limit
      expect(inputArg.kind).toBe('apply')
      if (inputArg.kind === 'apply') {
        expect(inputArg.fn).toBe('std.limit')
        // First arg is the entity ref
        expect(inputArg.args[0].kind).toBe('ref')
        if (inputArg.args[0].kind === 'ref') {
          expect(inputArg.args[0].name).toBe('plex.recently_added.result')
        }
        // Second arg is the n literal
        expect(inputArg.args[1].kind).toBe('literal')
        if (inputArg.args[1].kind === 'literal') {
          expect(inputArg.args[1].value).toBe(5)
        }
      }
    }
  })

  it('entity → two function hops → component produces nested apply nodes', () => {
    const entity = entityPlacement('e1', 'plex.recently_added')
    const fn1 = functionPlacement('f1', 'std.limit', { n: 10 })
    const fn2 = functionPlacement('f2', 'std.limit', { n: 3 })
    const comp = componentPlacement('c1', 'MovieTile')

    const doc = makeDoc([entity, fn1, fn2, comp], [
      { id: 'w1', source: { placementId: 'e1' }, target: { placementId: 'f1' } },
      { id: 'w2', source: { placementId: 'f1' }, target: { placementId: 'f2' } },
      { id: 'w3', source: { placementId: 'f2' }, target: { placementId: 'c1', slot: 'input' } },
    ])

    const result = emitComponent(doc, { name: 'DoubleLimitedStrip' }, resolveComponentDef)
    expect(result.ok).toBe(true)
    const render = result.artifact!.render!
    expect(render.kind).toBe('component-call')
    if (render.kind === 'component-call') {
      const inputArg = render.args.input
      // Outer: apply(std.limit, inner, 3)
      expect(inputArg.kind).toBe('apply')
      if (inputArg.kind === 'apply') {
        expect(inputArg.fn).toBe('std.limit')
        // Inner: apply(std.limit, ref, 10)
        const innerArg = inputArg.args[0]
        expect(innerArg.kind).toBe('apply')
        if (innerArg.kind === 'apply') {
          expect(innerArg.fn).toBe('std.limit')
          expect(innerArg.args[0].kind).toBe('ref')
        }
      }
    }
  })
})

// ── Multi-level wire composition ──────────────────────────────────────────────

describe('emitComponent — multi-level composition', () => {
  it('wires entity → tile → layout produces nested render tree', () => {
    // entity → MovieTile → Strip
    const entity = entityPlacement('e1', 'plex.recently_added')
    const tile = componentPlacement('c1', 'MovieTile')
    const strip = componentPlacement('c2', 'Strip')
    const doc = makeDoc([entity, tile, strip], [
      // entity feeds tile's input
      { id: 'w1', source: { placementId: 'e1' }, target: { placementId: 'c1', slot: 'input' } },
      // tile feeds strip's items
      { id: 'w2', source: { placementId: 'c1' }, target: { placementId: 'c2', slot: 'items' } },
    ])
    const result = emitComponent(doc, { name: 'PlexStrip' }, resolveComponentDef)
    expect(result.ok).toBe(true)
    const render = result.artifact!.render!
    // Root is Strip (layout) → layout-call
    expect(render.kind).toBe('layout-call')
    if (render.kind === 'layout-call') {
      expect(render.name).toBe('Strip')
      // Strip's items arg should be a component-call for MovieTile
      const itemsArg = render.args.items
      expect(itemsArg).toBeDefined()
      expect(itemsArg.kind).toBe('component-call')
      if (itemsArg.kind === 'component-call') {
        expect(itemsArg.name).toBe('MovieTile')
        // MovieTile's input should be a ref to the entity
        expect(itemsArg.args.input.kind).toBe('ref')
        if (itemsArg.args.input.kind === 'ref') {
          expect(itemsArg.args.input.name).toBe('plex.recently_added.result')
        }
      }
    }
  })
})
