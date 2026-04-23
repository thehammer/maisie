import { describe, it, expect } from 'bun:test'
import {
  emptyDocument,
  addPlacement,
  removePlacement,
  movePlacement,
  getPlacement,
  addWire,
  removeWire,
  getWire,
  hasWire,
  type CanvasDocument,
} from '../document'

describe('emptyDocument', () => {
  it('produces a valid document with no placements or wires', () => {
    const doc = emptyDocument()
    expect(doc.version).toBe(1)
    expect(doc.placements).toEqual([])
    expect(doc.wires).toEqual([])
  })
})

describe('addPlacement', () => {
  it('adds a placement with a generated id', () => {
    const doc = emptyDocument()
    const next = addPlacement(doc, {
      kind: 'entity',
      targetName: 'home-assistant.list_switches',
      position: { x: 100, y: 200 },
    })
    expect(next.placements).toHaveLength(1)
    const p = next.placements[0]
    expect(p.id).toBeTruthy()
    expect(p.kind).toBe('entity')
    expect(p.targetName).toBe('home-assistant.list_switches')
    expect(p.position).toEqual({ x: 100, y: 200 })
  })

  it('generates unique ids for successive placements', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'a', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'b', position: { x: 10, y: 10 } })
    const [a, b] = doc.placements
    expect(a.id).not.toBe(b.id)
  })

  it('does not mutate the original document', () => {
    const original = emptyDocument()
    const next = addPlacement(original, {
      kind: 'entity',
      targetName: 'test',
      position: { x: 0, y: 0 },
    })
    expect(original.placements).toHaveLength(0)
    expect(next.placements).toHaveLength(1)
  })
})

describe('removePlacement', () => {
  it('removes the placement by id', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'keep', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'remove-me', position: { x: 10, y: 10 } })
    const [, toRemove] = doc.placements
    const next = removePlacement(doc, toRemove.id)
    expect(next.placements).toHaveLength(1)
    expect(next.placements[0].targetName).toBe('keep')
  })

  it('cleans up wires that reference the removed placement', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'source', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'target', position: { x: 100, y: 0 } })
    const [source, target] = doc.placements

    // Manually inject a wire into the document
    const docWithWire: CanvasDocument = {
      ...doc,
      wires: [
        {
          id: 'w-1',
          source: { placementId: source.id, field: 'items' },
          target: { placementId: target.id, slot: 'input' },
        },
        {
          id: 'w-2',
          source: { placementId: 'other-id' },
          target: { placementId: target.id },
        },
      ],
    }

    // Remove the source — should drop w-1 but keep w-2... except w-2 references target
    // Remove target — should drop both wires
    const afterRemoveTarget = removePlacement(docWithWire, target.id)
    expect(afterRemoveTarget.wires).toHaveLength(0)

    // Remove source only — should drop w-1 but keep w-2
    const afterRemoveSource = removePlacement(docWithWire, source.id)
    expect(afterRemoveSource.wires).toHaveLength(1)
    expect(afterRemoveSource.wires[0].id).toBe('w-2')
  })

  it('is a no-op for an unknown id', () => {
    const doc = emptyDocument()
    const next = removePlacement(doc, 'nonexistent')
    expect(next.placements).toHaveLength(0)
    expect(next.wires).toHaveLength(0)
  })
})

describe('movePlacement', () => {
  it('updates the position of the matching placement', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'a', position: { x: 0, y: 0 } })
    const [p] = doc.placements
    const next = movePlacement(doc, p.id, { x: 150, y: 250 })
    expect(next.placements[0].position).toEqual({ x: 150, y: 250 })
  })

  it('does not affect other placements', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'a', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'entity', targetName: 'b', position: { x: 50, y: 50 } })
    const [a, b] = doc.placements
    const next = movePlacement(doc, a.id, { x: 200, y: 300 })
    expect(next.placements.find(p => p.id === b.id)!.position).toEqual({ x: 50, y: 50 })
  })

  it('does not mutate the original document', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'a', position: { x: 0, y: 0 } })
    const [p] = doc.placements
    movePlacement(doc, p.id, { x: 999, y: 999 })
    expect(doc.placements[0].position).toEqual({ x: 0, y: 0 })
  })
})

describe('getPlacement', () => {
  it('returns the placement with the matching id', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'found', position: { x: 5, y: 5 } })
    const [p] = doc.placements
    const result = getPlacement(doc, p.id)
    expect(result).toBeDefined()
    expect(result!.targetName).toBe('found')
  })

  it('returns undefined for an unknown id', () => {
    const doc = emptyDocument()
    expect(getPlacement(doc, 'missing')).toBeUndefined()
  })
})

// ── Wire helpers ──────────────────────────────────────────────────────────────

describe('addWire', () => {
  it('adds a wire with a generated id', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 100, y: 0 } })
    const [src, tgt] = doc.placements
    const next = addWire(doc, {
      source: { placementId: src.id },
      target: { placementId: tgt.id },
    })
    expect(next.wires).toHaveLength(1)
    const w = next.wires[0]
    expect(w.id).toBeTruthy()
    expect(w.source.placementId).toBe(src.id)
    expect(w.target.placementId).toBe(tgt.id)
  })

  it('generates unique ids for successive wires', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 100, y: 0 } })
    const [src, tgt] = doc.placements
    const wireSpec = { source: { placementId: src.id }, target: { placementId: tgt.id } }
    doc = addWire(doc, wireSpec)
    doc = addWire(doc, { source: { placementId: src.id, field: 'other' }, target: { placementId: tgt.id } })
    expect(doc.wires[0].id).not.toBe(doc.wires[1].id)
  })

  it('does not mutate the original document', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 100, y: 0 } })
    const [src, tgt] = doc.placements
    const next = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    expect(doc.wires).toHaveLength(0)
    expect(next.wires).toHaveLength(1)
  })
})

describe('removeWire', () => {
  it('removes a wire by id', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 100, y: 0 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    doc = addWire(doc, { source: { placementId: src.id, field: 'extra' }, target: { placementId: tgt.id } })
    const [w1, w2] = doc.wires
    const next = removeWire(doc, w1.id)
    expect(next.wires).toHaveLength(1)
    expect(next.wires[0].id).toBe(w2.id)
  })

  it('is a no-op for an unknown wire id', () => {
    const doc = emptyDocument()
    const next = removeWire(doc, 'nonexistent')
    expect(next.wires).toHaveLength(0)
  })
})

describe('getWire', () => {
  it('returns the wire with the matching id', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 100, y: 0 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    const [w] = doc.wires
    expect(getWire(doc, w.id)).toBeDefined()
    expect(getWire(doc, w.id)!.id).toBe(w.id)
  })

  it('returns undefined for an unknown wire id', () => {
    expect(getWire(emptyDocument(), 'missing')).toBeUndefined()
  })
})

describe('hasWire', () => {
  it('returns true when a matching wire exists', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 100, y: 0 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    expect(hasWire(doc, { placementId: src.id }, { placementId: tgt.id })).toBe(true)
  })

  it('returns false when no matching wire exists', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 100, y: 0 } })
    const [src, tgt] = doc.placements
    expect(hasWire(doc, { placementId: src.id }, { placementId: tgt.id })).toBe(false)
  })

  it('distinguishes wires by field and slot', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 100, y: 0 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id, field: 'items' }, target: { placementId: tgt.id, slot: 'input' } })
    // Same placements, different field — should be false
    expect(hasWire(doc, { placementId: src.id, field: 'other' }, { placementId: tgt.id, slot: 'input' })).toBe(false)
    // Exact match — should be true
    expect(hasWire(doc, { placementId: src.id, field: 'items' }, { placementId: tgt.id, slot: 'input' })).toBe(true)
  })
})
