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
  setWireTransform,
  getWireTransform,
  updatePlacementConfig,
  applyChain,
  type CanvasDocument,
} from '../document'
import type { BridgingChain } from '../chain-search'
import { getFunctionDescriptor } from '@maisie/shared'

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

// ── setWireTransform / getWireTransform ───────────────────────────────────────

describe('setWireTransform', () => {
  function makeDocWithWire() {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 100, y: 0 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    return { doc, wire: doc.wires[0] }
  }

  it('sets a transform on a wire', () => {
    const { doc, wire } = makeDocWithWire()
    const next = setWireTransform(doc, wire.id, { kind: 'pick', fields: ['title'] })
    const updated = next.wires.find((w) => w.id === wire.id)!
    expect(updated.transform).toEqual({ kind: 'pick', fields: ['title'] })
  })

  it('clears a transform when undefined is passed', () => {
    const { doc, wire } = makeDocWithWire()
    let next = setWireTransform(doc, wire.id, { kind: 'pick', fields: ['title'] })
    next = setWireTransform(next, wire.id, undefined)
    const updated = next.wires.find((w) => w.id === wire.id)!
    expect(updated.transform).toBeUndefined()
  })

  it('does not mutate the original document', () => {
    const { doc, wire } = makeDocWithWire()
    setWireTransform(doc, wire.id, { kind: 'pick', fields: ['title'] })
    expect(doc.wires[0].transform).toBeUndefined()
  })

  it('is a no-op for an unknown wire id', () => {
    const { doc } = makeDocWithWire()
    const next = setWireTransform(doc, 'nonexistent', { kind: 'pick', fields: ['x'] })
    expect(next.wires[0].transform).toBeUndefined()
  })

  it('does not affect other wires', () => {
    let { doc } = makeDocWithWire()
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id, field: 'extra' }, target: { placementId: tgt.id } })
    const [w1, w2] = doc.wires
    const next = setWireTransform(doc, w1.id, { kind: 'rename', mappings: [{ from: 'a', to: 'b' }] })
    expect(next.wires.find((w) => w.id === w2.id)!.transform).toBeUndefined()
  })
})

describe('getWireTransform', () => {
  it('returns the transform on a wire', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 100, y: 0 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    const [wire] = doc.wires
    doc = setWireTransform(doc, wire.id, { kind: 'compute', assignments: [{ name: 'x', value: 1 }] })
    expect(getWireTransform(doc, wire.id)).toEqual({
      kind: 'compute',
      assignments: [{ name: 'x', value: 1 }],
    })
  })

  it('returns undefined when no transform is set', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 100, y: 0 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    const [wire] = doc.wires
    expect(getWireTransform(doc, wire.id)).toBeUndefined()
  })

  it('returns undefined for an unknown wire id', () => {
    expect(getWireTransform(emptyDocument(), 'missing')).toBeUndefined()
  })
})

// ── Function placement tests ──────────────────────────────────────────────────

describe('function placements', () => {
  it('addPlacement accepts kind=function', () => {
    const doc = emptyDocument()
    const next = addPlacement(doc, {
      kind: 'function',
      targetName: 'std.filter',
      position: { x: 50, y: 50 },
    })
    expect(next.placements).toHaveLength(1)
    const p = next.placements[0]
    expect(p.kind).toBe('function')
    expect(p.targetName).toBe('std.filter')
  })

  it('function placements coexist with entity and component placements', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'plex.movies', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'function', targetName: 'std.filter', position: { x: 150, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'Strip', position: { x: 300, y: 0 } })
    expect(doc.placements).toHaveLength(3)
    expect(doc.placements.map((p) => p.kind)).toEqual(['entity', 'function', 'component'])
  })

  it('removePlacement removes a function placement and its wires', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'source', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'function', targetName: 'std.limit', position: { x: 150, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'Strip', position: { x: 300, y: 0 } })
    const [src, fn, tgt] = doc.placements

    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: fn.id } })
    doc = addWire(doc, { source: { placementId: fn.id }, target: { placementId: tgt.id } })

    const afterRemove = removePlacement(doc, fn.id)
    expect(afterRemove.placements).toHaveLength(2)
    // Both wires should be gone since they both reference the removed function
    expect(afterRemove.wires).toHaveLength(0)
  })
})

// ── updatePlacementConfig ─────────────────────────────────────────────────────

describe('updatePlacementConfig', () => {
  it('merges config values onto a placement', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, {
      kind: 'function',
      targetName: 'std.limit',
      position: { x: 0, y: 0 },
    })
    const [p] = doc.placements
    const next = updatePlacementConfig(doc, p.id, { n: 5 })
    expect(next.placements[0].config).toEqual({ n: 5 })
  })

  it('merges with existing config values (does not replace)', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, {
      kind: 'function',
      targetName: 'std.sort',
      position: { x: 0, y: 0 },
      config: { field: 'title' },
    })
    const [p] = doc.placements
    const next = updatePlacementConfig(doc, p.id, { direction: 'desc' })
    expect(next.placements[0].config).toEqual({ field: 'title', direction: 'desc' })
  })

  it('later values override earlier ones for the same key', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, {
      kind: 'function',
      targetName: 'std.limit',
      position: { x: 0, y: 0 },
      config: { n: 10 },
    })
    const [p] = doc.placements
    const next = updatePlacementConfig(doc, p.id, { n: 20 })
    expect(next.placements[0].config?.n).toBe(20)
  })

  it('does not mutate the original document', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'function', targetName: 'std.limit', position: { x: 0, y: 0 } })
    const [p] = doc.placements
    updatePlacementConfig(doc, p.id, { n: 99 })
    expect(doc.placements[0].config).toBeUndefined()
  })

  it('is a no-op for an unknown id', () => {
    const doc = emptyDocument()
    const next = updatePlacementConfig(doc, 'nonexistent', { x: 1 })
    expect(next.placements).toHaveLength(0)
  })

  it('does not affect other placements', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'function', targetName: 'std.limit', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'function', targetName: 'std.sort', position: { x: 150, y: 0 } })
    const [p1, p2] = doc.placements
    const next = updatePlacementConfig(doc, p1.id, { n: 5 })
    expect(next.placements.find((p) => p.id === p2.id)!.config).toBeUndefined()
  })
})

// ── applyChain ────────────────────────────────────────────────────────────────

function makeCountChain(): BridgingChain {
  const desc = getFunctionDescriptor('std.count')!
  return {
    steps: [{ functionId: 'std.count', descriptor: desc }],
    outputType: { kind: 'scalar', type: 'number' },
  }
}

function makePluckFirstChain(): BridgingChain {
  const pluck = getFunctionDescriptor('std.pluck')!
  const first = getFunctionDescriptor('std.first')!
  return {
    steps: [
      { functionId: 'std.pluck', descriptor: pluck, suggestedParams: {} },
      { functionId: 'std.first', descriptor: first },
    ],
    outputType: { kind: 'any' },
  }
}

describe('applyChain', () => {
  it('returns doc unchanged for unknown wireId', () => {
    const doc = emptyDocument()
    const result = applyChain(doc, makeCountChain(), 'nonexistent-wire')
    expect(result).toBe(doc)
  })

  it('removes the original wire', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 100 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 400, y: 100 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    const wire = doc.wires[0]

    const result = applyChain(doc, makeCountChain(), wire.id)
    expect(result.wires.find((w) => w.id === wire.id)).toBeUndefined()
  })

  it('inserts one function placement for a 1-step chain', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 100 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 400, y: 100 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    const wire = doc.wires[0]

    const result = applyChain(doc, makeCountChain(), wire.id)

    // Original 2 placements + 1 new function = 3
    expect(result.placements).toHaveLength(3)
    const fnPlacement = result.placements.find((p) => p.kind === 'function')
    expect(fnPlacement).toBeDefined()
    expect(fnPlacement!.targetName).toBe('std.count')
  })

  it('creates correct wire chain for 1-step: source → fn → target', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 100 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 400, y: 100 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    const wire = doc.wires[0]

    const result = applyChain(doc, makeCountChain(), wire.id)

    // Should have exactly 2 new wires: src→fn, fn→tgt
    expect(result.wires).toHaveLength(2)
    const fnPlacement = result.placements.find((p) => p.kind === 'function')!
    const wireA = result.wires.find((w) => w.source.placementId === src.id)
    const wireB = result.wires.find((w) => w.target.placementId === tgt.id)
    expect(wireA).toBeDefined()
    expect(wireA!.target.placementId).toBe(fnPlacement.id)
    expect(wireB).toBeDefined()
    expect(wireB!.source.placementId).toBe(fnPlacement.id)
  })

  it('inserts two function placements for a 2-step chain', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 600, y: 0 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    const wire = doc.wires[0]

    const result = applyChain(doc, makePluckFirstChain(), wire.id)

    // 2 original + 2 fn placements = 4
    expect(result.placements).toHaveLength(4)
    const fnPlacements = result.placements.filter((p) => p.kind === 'function')
    expect(fnPlacements).toHaveLength(2)
    expect(fnPlacements[0].targetName).toBe('std.pluck')
    expect(fnPlacements[1].targetName).toBe('std.first')
  })

  it('creates correct wire chain for 2-step: source → fn1 → fn2 → target', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 600, y: 0 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    const wire = doc.wires[0]

    const result = applyChain(doc, makePluckFirstChain(), wire.id)

    // 3 wires: src→fn1, fn1→fn2, fn2→tgt
    expect(result.wires).toHaveLength(3)
    const fnPlacements = result.placements.filter((p) => p.kind === 'function')
    const [fn1, fn2] = fnPlacements

    const wireA = result.wires.find((w) => w.source.placementId === src.id)
    const wireB = result.wires.find((w) => w.source.placementId === fn1.id)
    const wireC = result.wires.find((w) => w.target.placementId === tgt.id)
    expect(wireA?.target.placementId).toBe(fn1.id)
    expect(wireB?.target.placementId).toBe(fn2.id)
    expect(wireC?.source.placementId).toBe(fn2.id)
  })

  it('positions function placements between source and target', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 300, y: 0 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    const wire = doc.wires[0]

    const result = applyChain(doc, makeCountChain(), wire.id)
    const fn = result.placements.find((p) => p.kind === 'function')!

    // For a 1-step chain, the function is placed at the midpoint (t = 1/2)
    expect(fn.position.x).toBeCloseTo(150, 0)
    expect(fn.position.y).toBeCloseTo(0, 0)
  })

  it('applies suggestedParams to function placement config', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 300, y: 0 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    const wire = doc.wires[0]

    const chain: BridgingChain = {
      steps: [{
        functionId: 'std.limit',
        descriptor: getFunctionDescriptor('std.limit')!,
        suggestedParams: { n: 10 },
      }],
      outputType: { kind: 'collection', element: { kind: 'any' } },
    }

    const result = applyChain(doc, chain, wire.id)
    const fn = result.placements.find((p) => p.kind === 'function')!
    expect(fn.config).toEqual({ n: 10 })
  })

  it('does not mutate the original document', () => {
    let doc = emptyDocument()
    doc = addPlacement(doc, { kind: 'entity', targetName: 'src', position: { x: 0, y: 0 } })
    doc = addPlacement(doc, { kind: 'component', targetName: 'tgt', position: { x: 300, y: 0 } })
    const [src, tgt] = doc.placements
    doc = addWire(doc, { source: { placementId: src.id }, target: { placementId: tgt.id } })
    const wire = doc.wires[0]
    const originalPlacementCount = doc.placements.length
    const originalWireCount = doc.wires.length

    applyChain(doc, makeCountChain(), wire.id)
    expect(doc.placements).toHaveLength(originalPlacementCount)
    expect(doc.wires).toHaveLength(originalWireCount)
  })
})
