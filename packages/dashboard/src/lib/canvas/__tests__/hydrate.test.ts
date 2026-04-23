import { describe, it, expect } from 'bun:test'
import { hydrateView, hydrateEntity, hydrateComponent } from '../hydrate'
import type { ViewDef, EntityDef, ComponentDef } from '@maisie/shared'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeView(overrides: Partial<ViewDef> = {}): ViewDef {
  return {
    name: 'recent-movies-strip',
    source: { entity: 'plex.list_recently_added', field: 'result' },
    chain: [],
    component: 'Strip',
    ...overrides,
  }
}

// ── hydrateView ───────────────────────────────────────────────────────────────

describe('hydrateView', () => {
  it('direct view (no chain): produces entity + component placements with one wire', () => {
    const doc = hydrateView(makeView())
    expect(doc.version).toBe(1)
    expect(doc.placements).toHaveLength(2)
    expect(doc.wires).toHaveLength(1)

    const entity = doc.placements.find((p) => p.kind === 'entity')
    const comp = doc.placements.find((p) => p.kind === 'component')
    expect(entity?.targetName).toBe('plex.list_recently_added')
    expect(comp?.targetName).toBe('Strip')

    // wire connects entity → component
    const wire = doc.wires[0]
    expect(wire.source.placementId).toBe(entity!.id)
    expect(wire.target.placementId).toBe(comp!.id)
  })

  it('view with one chain step: produces entity + function + component', () => {
    const doc = hydrateView(makeView({
      chain: [{ functionId: 'std.limit', params: { n: 5 } }],
    }))
    expect(doc.placements).toHaveLength(3)
    expect(doc.wires).toHaveLength(2)

    const [entity, fn, comp] = doc.placements
    expect(entity.kind).toBe('entity')
    expect(fn.kind).toBe('function')
    expect(fn.targetName).toBe('std.limit')
    expect(fn.config).toEqual({ n: 5 })
    expect(comp.kind).toBe('component')
  })

  it('view with two chain steps: produces entity + fn + fn + component', () => {
    const doc = hydrateView(makeView({
      chain: [
        { functionId: 'std.filter' },
        { functionId: 'std.limit', params: { n: 10 } },
      ],
    }))
    expect(doc.placements).toHaveLength(4)
    expect(doc.wires).toHaveLength(3)

    const kinds = doc.placements.map((p) => p.kind)
    expect(kinds).toEqual(['entity', 'function', 'function', 'component'])
  })

  it('wires form a linear chain in order', () => {
    const doc = hydrateView(makeView({
      chain: [{ functionId: 'std.sort' }],
    }))
    const [p0, p1, p2] = doc.placements
    const [w0, w1] = doc.wires
    expect(w0.source.placementId).toBe(p0.id)
    expect(w0.target.placementId).toBe(p1.id)
    expect(w1.source.placementId).toBe(p1.id)
    expect(w1.target.placementId).toBe(p2.id)
  })

  it('component placement carries componentProps as config', () => {
    const doc = hydrateView(makeView({ componentProps: { gap: 8 } }))
    const comp = doc.placements.find((p) => p.kind === 'component')!
    expect(comp.config).toEqual({ gap: 8 })
  })

  it('produces no hydrateNote (clean case)', () => {
    const doc = hydrateView(makeView())
    expect(doc.hydrateNote).toBeUndefined()
  })
})

// ── hydrateEntity ─────────────────────────────────────────────────────────────

describe('hydrateEntity', () => {
  it('entity with no expression fields: returns bare entity node with note', () => {
    const entity: EntityDef = {
      name: 'my-entity',
      source: 'plugin',
      fields: {},
    }
    const doc = hydrateEntity(entity)
    expect(doc.placements).toHaveLength(1)
    expect(doc.placements[0].kind).toBe('entity')
    expect(doc.hydrateNote).toBeTruthy()
  })

  it('entity with ref expression: produces entity → entity placements', () => {
    const entity: EntityDef = {
      name: 'derived-entity',
      source: 'derived',
      fields: {
        result: {
          kind: 'data',
          type: 'record',
          expression: { kind: 'ref', name: 'plex.list_recently_added.result' },
        },
      },
    }
    const doc = hydrateEntity(entity)
    expect(doc.placements).toHaveLength(2)
    // first placement is the source ref entity
    expect(doc.placements[0].kind).toBe('entity')
    expect(doc.placements[0].targetName).toBe('plex.list_recently_added')
    // second is the derived entity itself
    expect(doc.placements[1].kind).toBe('entity')
    expect(doc.placements[1].targetName).toBe('derived-entity')
    expect(doc.wires).toHaveLength(1)
    expect(doc.hydrateNote).toBeUndefined()
  })

  it('entity with apply-chain expression: produces entity + fn + entity placements', () => {
    const entity: EntityDef = {
      name: 'limited-entity',
      source: 'derived',
      fields: {
        result: {
          kind: 'data',
          type: 'collection',
          expression: {
            kind: 'apply',
            fn: 'std.limit',
            args: [
              { kind: 'ref', name: 'plex.list_recently_added.result' },
              { kind: 'literal', value: 5 },
            ],
          },
        },
      },
    }
    const doc = hydrateEntity(entity)
    expect(doc.placements).toHaveLength(3)
    const [src, fn, target] = doc.placements
    expect(src.kind).toBe('entity')
    expect(src.targetName).toBe('plex.list_recently_added')
    expect(fn.kind).toBe('function')
    expect(fn.targetName).toBe('std.limit')
    expect(target.kind).toBe('entity')
    expect(target.targetName).toBe('limited-entity')
    expect(doc.wires).toHaveLength(2)
  })

  it('entity with complex expression: falls back with note', () => {
    const entity: EntityDef = {
      name: 'complex-entity',
      source: 'derived',
      fields: {
        result: {
          kind: 'data',
          type: 'record',
          expression: { kind: 'literal', value: 42 },
        },
      },
    }
    const doc = hydrateEntity(entity)
    expect(doc.placements).toHaveLength(1)
    expect(doc.hydrateNote).toBeTruthy()
  })
})

// ── hydrateComponent ──────────────────────────────────────────────────────────

describe('hydrateComponent', () => {
  it('component with no render: returns bare component node with note', () => {
    const component: ComponentDef = {
      name: 'MyComponent',
      kind: 'derived',
    }
    const doc = hydrateComponent(component)
    expect(doc.placements).toHaveLength(1)
    expect(doc.placements[0].kind).toBe('component')
    expect(doc.hydrateNote).toBeTruthy()
  })

  it('component with component-call render: returns root component placement', () => {
    const component: ComponentDef = {
      name: 'MovieCard',
      kind: 'derived',
      render: {
        kind: 'component-call',
        name: 'Strip',
        args: {},
      } as any,
    }
    const doc = hydrateComponent(component)
    // At minimum, the root component placement exists
    const root = doc.placements.find((p) => p.kind === 'component' && p.targetName === 'Strip')
    expect(root).toBeTruthy()
  })

  it('component with layout-call render: produces layout component placement', () => {
    const component: ComponentDef = {
      name: 'MyLayout',
      kind: 'layout',
      render: {
        kind: 'layout-call',
        name: 'Grid',
        args: {},
      } as any,
    }
    const doc = hydrateComponent(component)
    const root = doc.placements.find((p) => p.kind === 'component' && p.targetName === 'Grid')
    expect(root).toBeTruthy()
  })

  it('component-call render with ref arg produces entity → component placements', () => {
    const component: ComponentDef = {
      name: 'MovieStrip',
      kind: 'derived',
      render: {
        kind: 'component-call',
        name: 'Strip',
        args: {
          input: { kind: 'ref', name: 'plex.list_recently_added.result' },
        },
      } as any,
    }
    const doc = hydrateComponent(component)
    const entity = doc.placements.find((p) => p.kind === 'entity')
    const comp = doc.placements.find((p) => p.kind === 'component')
    expect(entity).toBeTruthy()
    expect(entity?.targetName).toBe('plex.list_recently_added')
    expect(comp).toBeTruthy()
    expect(comp?.targetName).toBe('Strip')
    // wire connects entity → component
    expect(doc.wires.length).toBeGreaterThan(0)
  })

  it('component with unrecognized render kind: falls back with note', () => {
    const component: ComponentDef = {
      name: 'Weird',
      kind: 'derived',
      render: { kind: 'literal', value: 42 } as any,
    }
    const doc = hydrateComponent(component)
    expect(doc.placements).toHaveLength(1)
    expect(doc.hydrateNote).toBeTruthy()
  })

  it('produces no hydrateNote for clean component-call case', () => {
    const component: ComponentDef = {
      name: 'Clean',
      kind: 'derived',
      render: { kind: 'component-call', name: 'Strip', args: {} } as any,
    }
    const doc = hydrateComponent(component)
    expect(doc.hydrateNote).toBeUndefined()
  })
})
