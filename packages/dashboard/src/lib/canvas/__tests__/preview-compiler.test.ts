import { describe, it, expect } from 'bun:test'
import { compilePreview } from '../preview-compiler'
import { emptyDocument, addPlacement, addWire } from '../document'
import { setWireTransform } from '../document'
import type { TypeExpr, MaisieValue, MaisieRecord } from '@maisie/shared'

// ── Function placement chain tests ────────────────────────────────────────────

// Build a minimal canvas document for testing
function makeDoc() {
  let doc = emptyDocument()

  // Add an entity placement (data source)
  doc = addPlacement(doc, {
    kind: 'entity',
    targetName: 'plex.recently_added',
    position: { x: 0, y: 0 },
  })

  // Add a component placement (renderer)
  doc = addPlacement(doc, {
    kind: 'component',
    targetName: 'MovieStrip',
    position: { x: 200, y: 0 },
  })

  return doc
}

const movieInputType: TypeExpr = {
  kind: 'collection',
  element: {
    kind: 'record',
    fields: {
      title: { kind: 'scalar', type: 'string' },
      thumb: { kind: 'scalar', type: 'image' },
    },
  },
}

describe('compilePreview', () => {
  it('component placement without a wire gets fixture data', async () => {
    const doc = makeDoc()
    const [, component] = doc.placements

    const targets = await compilePreview(
      doc,
      async () => undefined,  // resolveInput: nothing wired
      (placementId) => placementId === component.id ? movieInputType : undefined,
    )

    expect(targets).toHaveLength(1)
    const target = targets[0]
    expect(target.placementId).toBe(component.id)
    expect(target.componentName).toBe('MovieStrip')
    expect(target.source).toBe('fixture')
    expect(target.error).toBeUndefined()
    // Fixture for a collection type should be an array
    expect(Array.isArray(target.input)).toBe(true)
  })

  it('component placement with a resolved wire gets wired data', async () => {
    let doc = makeDoc()
    const [entity, component] = doc.placements

    // Wire the entity to the component
    doc = addWire(doc, {
      source: { placementId: entity.id },
      target: { placementId: component.id },
    })

    const liveData: MaisieValue = [{ title: 'The Matrix', thumb: 'https://example.com/img.jpg' }]

    const targets = await compilePreview(
      doc,
      async (placementId) => placementId === entity.id ? liveData : undefined,
      () => movieInputType,
    )

    expect(targets).toHaveLength(1)
    const target = targets[0]
    expect(target.source).toBe('wired')
    expect(target.input).toEqual(liveData)
    expect(target.error).toBeUndefined()
  })

  it('component with a wire that resolves to undefined falls back to fixture with error', async () => {
    let doc = makeDoc()
    const [entity, component] = doc.placements

    doc = addWire(doc, {
      source: { placementId: entity.id },
      target: { placementId: component.id },
    })

    const targets = await compilePreview(
      doc,
      async () => undefined,  // wire source not resolvable
      (placementId) => placementId === component.id ? movieInputType : undefined,
    )

    expect(targets).toHaveLength(1)
    const target = targets[0]
    expect(target.source).toBe('fixture')
    expect(target.error).toBeTruthy()
    expect(Array.isArray(target.input)).toBe(true)
  })

  it('entity placements are not included in targets', async () => {
    const doc = makeDoc()

    const targets = await compilePreview(
      doc,
      async () => undefined,
      () => undefined,
    )

    // Only component placements should appear
    for (const target of targets) {
      const placement = doc.placements.find((p) => p.id === target.placementId)
      expect(placement?.kind).toBe('component')
    }
  })

  it('component with no input type and no wire produces source=none', async () => {
    const doc = makeDoc()
    const [, component] = doc.placements

    const targets = await compilePreview(
      doc,
      async () => undefined,
      () => undefined,  // no type info available
    )

    expect(targets).toHaveLength(1)
    const target = targets[0]
    expect(target.placementId).toBe(component.id)
    expect(target.source).toBe('none')
    expect(target.input).toBeNull()
  })

  it('handles an empty document with no placements', async () => {
    const doc = emptyDocument()
    const targets = await compilePreview(doc, async () => undefined, () => undefined)
    expect(targets).toHaveLength(0)
  })

  it('handles multiple component placements independently', async () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'component', targetName: 'Alpha', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'Beta', position: { x: 200, y: 0 } })
    const [alpha, beta] = doc.placements

    const alphaType: TypeExpr = { kind: 'scalar', type: 'string' }
    const betaType: TypeExpr = { kind: 'scalar', type: 'number' }

    const targets = await compilePreview(
      doc,
      async () => undefined,
      (placementId) => {
        if (placementId === alpha.id) return alphaType
        if (placementId === beta.id) return betaType
        return undefined
      },
    )

    expect(targets).toHaveLength(2)
    const alphaTarget = targets.find((t) => t.placementId === alpha.id)!
    const betaTarget = targets.find((t) => t.placementId === beta.id)!

    expect(alphaTarget.componentName).toBe('Alpha')
    expect(typeof alphaTarget.input).toBe('string')
    expect(betaTarget.componentName).toBe('Beta')
    expect(typeof betaTarget.input).toBe('number')
  })
})

// ── Transform-on-wire integration ─────────────────────────────────────────────

describe('compilePreview — transform on wire', () => {
  it('applies a rename transform to a wired record', async () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'source', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'Target', position: { x: 200, y: 0 } })
    const [entity, component] = doc.placements

    doc = addWire(doc, {
      source: { placementId: entity.id },
      target: { placementId: component.id },
    })
    const [wire] = doc.wires
    doc = setWireTransform(doc, wire.id, {
      kind: 'rename',
      mappings: [{ from: 'thumbUrl', to: 'coverUrl' }],
      keepRest: true,
    })

    const liveData: MaisieValue = { title: 'Test Movie', thumbUrl: 'https://example.com/img.jpg', rating: 9 }

    const targets = await compilePreview(
      doc,
      async (placementId) => placementId === entity.id ? liveData : undefined,
      () => undefined,
    )

    expect(targets).toHaveLength(1)
    const target = targets[0]
    expect(target.source).toBe('wired')
    const result = target.input as MaisieRecord
    expect(result.coverUrl).toBe('https://example.com/img.jpg')
    expect(result.title).toBe('Test Movie')
    expect(result.rating).toBe(9)
    expect(result.thumbUrl).toBe('https://example.com/img.jpg')  // keepRest: true keeps original too
  })

  it('applies a pick transform to a wired collection', async () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'source', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'Target', position: { x: 200, y: 0 } })
    const [entity, component] = doc.placements

    doc = addWire(doc, {
      source: { placementId: entity.id },
      target: { placementId: component.id },
    })
    const [wire] = doc.wires
    doc = setWireTransform(doc, wire.id, {
      kind: 'pick',
      fields: ['title'],
    })

    const liveData: MaisieValue = [
      { title: 'The Matrix', thumbUrl: 'https://example.com/1.jpg', rating: 8.7 },
      { title: 'Inception', thumbUrl: 'https://example.com/2.jpg', rating: 9.1 },
    ]

    const targets = await compilePreview(
      doc,
      async (placementId) => placementId === entity.id ? liveData : undefined,
      () => undefined,
    )

    expect(targets).toHaveLength(1)
    const result = targets[0].input as MaisieRecord[]
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ title: 'The Matrix' })
    expect(result[1]).toEqual({ title: 'Inception' })
  })

  it('applies a compute transform to add literal fields', async () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'source', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'Target', position: { x: 200, y: 0 } })
    const [entity, component] = doc.placements

    doc = addWire(doc, {
      source: { placementId: entity.id },
      target: { placementId: component.id },
    })
    const [wire] = doc.wires
    doc = setWireTransform(doc, wire.id, {
      kind: 'compute',
      assignments: [{ name: 'rating', value: 'unrated' }],
      keepRest: true,
    })

    const liveData: MaisieValue = { title: 'The Matrix', thumbUrl: 'https://example.com/img.jpg' }

    const targets = await compilePreview(
      doc,
      async (placementId) => placementId === entity.id ? liveData : undefined,
      () => undefined,
    )

    expect(targets).toHaveLength(1)
    const result = targets[0].input as MaisieRecord
    expect(result.title).toBe('The Matrix')
    expect(result.rating).toBe('unrated')
  })

  it('identity transform passes data through unchanged', async () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'source', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'Target', position: { x: 200, y: 0 } })
    const [entity, component] = doc.placements

    doc = addWire(doc, {
      source: { placementId: entity.id },
      target: { placementId: component.id },
    })
    const [wire] = doc.wires
    doc = setWireTransform(doc, wire.id, { kind: 'identity' })

    const liveData: MaisieValue = { title: 'Test', value: 42 }

    const targets = await compilePreview(
      doc,
      async (placementId) => placementId === entity.id ? liveData : undefined,
      () => undefined,
    )

    expect(targets).toHaveLength(1)
    expect(targets[0].input).toEqual(liveData)
  })

  it('scalar values pass through a transform unchanged', async () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'source', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'Target', position: { x: 200, y: 0 } })
    const [entity, component] = doc.placements

    doc = addWire(doc, {
      source: { placementId: entity.id },
      target: { placementId: component.id },
    })
    const [wire] = doc.wires
    doc = setWireTransform(doc, wire.id, {
      kind: 'pick',
      fields: ['name'],
    })

    const liveData: MaisieValue = 'just a string'

    const targets = await compilePreview(
      doc,
      async (placementId) => placementId === entity.id ? liveData : undefined,
      () => undefined,
    )

    // Scalars pass through unchanged
    expect(targets[0].input).toBe('just a string')
  })
})

// ── Function placement chain tests ─────────────────────────────────────────────

describe('compilePreview — function placement chains', () => {
  it('entity → limit(n=2) → component resolves filtered collection to component', async () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'plex.movies', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'function', targetName: 'std.limit', position: { x: 150, y: 0 }, config: { n: 2 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'Strip', position: { x: 300, y: 0 } })
    const [entity, fn, component] = doc.placements

    // Wire entity → fn → component
    doc = addWire(doc, { source: { placementId: entity.id }, target: { placementId: fn.id } })
    doc = addWire(doc, { source: { placementId: fn.id }, target: { placementId: component.id } })

    const movies: MaisieValue = [
      { title: 'Movie A' },
      { title: 'Movie B' },
      { title: 'Movie C' },
      { title: 'Movie D' },
    ]

    const targets = await compilePreview(
      doc,
      async (placementId) => placementId === entity.id ? movies : undefined,
      () => undefined,
    )

    expect(targets).toHaveLength(1)
    const target = targets[0]
    expect(target.placementId).toBe(component.id)
    expect(target.source).toBe('wired')
    expect(Array.isArray(target.input)).toBe(true)
    expect((target.input as MaisieRecord[]).length).toBe(2)
    expect((target.input as MaisieRecord[])[0]).toEqual({ title: 'Movie A' })
    expect((target.input as MaisieRecord[])[1]).toEqual({ title: 'Movie B' })
  })

  it('entity → two function hops → component applies functions in order', async () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'function', targetName: 'std.limit', position: { x: 150, y: 0 }, config: { n: 3 } })
    doc = addPlacement(doc, { kind: 'function', targetName: 'std.limit', position: { x: 300, y: 0 }, config: { n: 1 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'Strip', position: { x: 450, y: 0 } })
    const [entity, fn1, fn2, component] = doc.placements

    doc = addWire(doc, { source: { placementId: entity.id }, target: { placementId: fn1.id } })
    doc = addWire(doc, { source: { placementId: fn1.id }, target: { placementId: fn2.id } })
    doc = addWire(doc, { source: { placementId: fn2.id }, target: { placementId: component.id } })

    const items: MaisieValue = [
      { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 },
    ]

    const targets = await compilePreview(
      doc,
      async (placementId) => placementId === entity.id ? items : undefined,
      () => undefined,
    )

    expect(targets).toHaveLength(1)
    // limit(3) then limit(1) → 1 item
    const result = targets[0].input as MaisieRecord[]
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(1)
    expect(result[0]).toEqual({ id: 1 })
  })

  it('function placement without upstream wire falls back to fixture for component', async () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'function', targetName: 'std.limit', position: { x: 0, y: 0 }, config: { n: 5 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'Strip', position: { x: 150, y: 0 } })
    const [fn, component] = doc.placements

    doc = addWire(doc, { source: { placementId: fn.id }, target: { placementId: component.id } })

    const collectionType: TypeExpr = { kind: 'collection', element: { kind: 'any' } }

    const targets = await compilePreview(
      doc,
      async () => undefined,
      (placementId) => placementId === component.id ? collectionType : undefined,
    )

    expect(targets).toHaveLength(1)
    // The function has no upstream source → falls back to fixture
    expect(targets[0].source).toBe('fixture')
    expect(Array.isArray(targets[0].input)).toBe(true)
  })

  it('function placements are not included as preview targets themselves', async () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'e', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'function', targetName: 'std.limit', position: { x: 150, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'Strip', position: { x: 300, y: 0 } })
    const [entity, fn, comp] = doc.placements

    doc = addWire(doc, { source: { placementId: entity.id }, target: { placementId: fn.id } })
    doc = addWire(doc, { source: { placementId: fn.id }, target: { placementId: comp.id } })

    const targets = await compilePreview(
      doc,
      async (pid) => pid === entity.id ? [{ x: 1 }] : undefined,
      () => undefined,
    )

    // Only the component appears — not the entity or function
    expect(targets).toHaveLength(1)
    expect(targets[0].placementId).toBe(comp.id)
    expect(targets[0].componentName).toBe('Strip')
  })
})
