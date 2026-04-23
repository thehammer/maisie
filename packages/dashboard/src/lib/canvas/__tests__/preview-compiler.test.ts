import { describe, it, expect } from 'bun:test'
import { compilePreview } from '../preview-compiler'
import { emptyDocument, addPlacement, addWire } from '../document'
import type { TypeExpr, MaisieValue } from '@maisie/shared'

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
