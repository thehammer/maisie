import { describe, it, expect, mock } from 'bun:test'
import { placementMenu, wireMenu, surfaceMenu, paletteItemMenu } from '../context-actions'
import type { CanvasContextHandlers } from '../context-actions'
import type { Placement, Wire } from '../document'

// Minimal no-op handlers for tests
function makeHandlers(overrides: Partial<CanvasContextHandlers> = {}): CanvasContextHandlers {
  return {
    removePlacement: mock(() => {}),
    removeWire: mock(() => {}),
    duplicatePlacement: mock(() => {}),
    resetPlacementConfig: mock(() => {}),
    openTransformEditor: mock(() => {}),
    suggestChains: mock(() => {}),
    addFromPalette: mock(() => {}),
    openInStudio: mock(() => {}),
    copyToClipboard: mock(() => {}),
    clearCanvas: mock(() => {}),
    openSaveAs: mock(() => {}),
    ...overrides,
  }
}

function makePlacement(overrides: Partial<Placement> = {}): Placement {
  return {
    id: 'p-1',
    kind: 'entity',
    targetName: 'test.entity',
    position: { x: 0, y: 0 },
    ...overrides,
  }
}

function makeWire(overrides: Partial<Wire> = {}): Wire {
  return {
    id: 'w-1',
    source: { placementId: 'p-1' },
    target: { placementId: 'p-2' },
    ...overrides,
  }
}

// ── placementMenu ─────────────────────────────────────────────────────────────

describe('placementMenu — entity', () => {
  it('includes duplicate, copy-name, open-studio, delete', () => {
    const placement = makePlacement({ kind: 'entity' })
    const items = placementMenu(placement, makeHandlers())
    const ids = items.map((i) => i.id)
    expect(ids).toContain('duplicate')
    expect(ids).toContain('copy-name')
    expect(ids).toContain('open-studio')
    expect(ids).toContain('delete')
  })

  it('does not include reset-params for entity', () => {
    const placement = makePlacement({ kind: 'entity' })
    const items = placementMenu(placement, makeHandlers())
    expect(items.find((i) => i.id === 'reset-params')).toBeUndefined()
  })

  it('delete item calls removePlacement with placement id', () => {
    const handlers = makeHandlers()
    const placement = makePlacement({ kind: 'entity', id: 'p-abc' })
    const items = placementMenu(placement, handlers)
    items.find((i) => i.id === 'delete')!.onSelect()
    expect(handlers.removePlacement).toHaveBeenCalledWith('p-abc')
  })

  it('duplicate item calls duplicatePlacement', () => {
    const handlers = makeHandlers()
    const placement = makePlacement({ kind: 'entity', id: 'p-abc' })
    const items = placementMenu(placement, handlers)
    items.find((i) => i.id === 'duplicate')!.onSelect()
    expect(handlers.duplicatePlacement).toHaveBeenCalledWith('p-abc')
  })

  it('delete is marked danger', () => {
    const placement = makePlacement({ kind: 'entity' })
    const items = placementMenu(placement, makeHandlers())
    expect(items.find((i) => i.id === 'delete')?.danger).toBe(true)
  })
})

describe('placementMenu — component', () => {
  it('includes open-studio', () => {
    const placement = makePlacement({ kind: 'component', targetName: 'Strip' })
    const items = placementMenu(placement, makeHandlers())
    expect(items.find((i) => i.id === 'open-studio')).toBeDefined()
  })

  it('does not include reset-params for component', () => {
    const placement = makePlacement({ kind: 'component' })
    const items = placementMenu(placement, makeHandlers())
    expect(items.find((i) => i.id === 'reset-params')).toBeUndefined()
  })
})

describe('placementMenu — function', () => {
  it('includes reset-params', () => {
    const placement = makePlacement({ kind: 'function', targetName: 'std.filter' })
    const items = placementMenu(placement, makeHandlers())
    expect(items.find((i) => i.id === 'reset-params')).toBeDefined()
  })

  it('reset-params is disabled when config is empty', () => {
    const placement = makePlacement({ kind: 'function', config: {} })
    const items = placementMenu(placement, makeHandlers())
    expect(items.find((i) => i.id === 'reset-params')?.disabled).toBe(true)
  })

  it('reset-params is enabled when config has keys', () => {
    const placement = makePlacement({ kind: 'function', config: { limit: 10 } })
    const items = placementMenu(placement, makeHandlers())
    expect(items.find((i) => i.id === 'reset-params')?.disabled).toBeFalsy()
  })

  it('reset-params is disabled when config is undefined', () => {
    const placement = makePlacement({ kind: 'function', config: undefined })
    const items = placementMenu(placement, makeHandlers())
    expect(items.find((i) => i.id === 'reset-params')?.disabled).toBe(true)
  })

  it('does not include open-studio for function', () => {
    const placement = makePlacement({ kind: 'function' })
    const items = placementMenu(placement, makeHandlers())
    expect(items.find((i) => i.id === 'open-studio')).toBeUndefined()
  })
})

// ── wireMenu ──────────────────────────────────────────────────────────────────

describe('wireMenu', () => {
  it('includes transform, suggest, delete', () => {
    const wire = makeWire()
    const items = wireMenu(wire, makeHandlers(), false)
    const ids = items.map((i) => i.id)
    expect(ids).toContain('transform')
    expect(ids).toContain('suggest')
    expect(ids).toContain('delete')
  })

  it('shows "Add transform" when wire has no transform', () => {
    const wire = makeWire()
    const items = wireMenu(wire, makeHandlers(), false)
    expect(items.find((i) => i.id === 'transform')?.label).toBe('Add transform')
  })

  it('shows "Edit transform" when wire has a transform', () => {
    const wire = makeWire({ transform: { kind: 'identity' } })
    const items = wireMenu(wire, makeHandlers(), false)
    expect(items.find((i) => i.id === 'transform')?.label).toBe('Edit transform')
  })

  it('suggest is disabled when hasChainSuggestions is false', () => {
    const wire = makeWire()
    const items = wireMenu(wire, makeHandlers(), false)
    expect(items.find((i) => i.id === 'suggest')?.disabled).toBe(true)
  })

  it('suggest is enabled when hasChainSuggestions is true', () => {
    const wire = makeWire()
    const items = wireMenu(wire, makeHandlers(), true)
    expect(items.find((i) => i.id === 'suggest')?.disabled).toBeFalsy()
  })

  it('delete is marked danger', () => {
    const wire = makeWire()
    const items = wireMenu(wire, makeHandlers(), false)
    expect(items.find((i) => i.id === 'delete')?.danger).toBe(true)
  })

  it('delete calls removeWire with wire id', () => {
    const handlers = makeHandlers()
    const wire = makeWire({ id: 'w-xyz' })
    const items = wireMenu(wire, handlers, false)
    items.find((i) => i.id === 'delete')!.onSelect()
    expect(handlers.removeWire).toHaveBeenCalledWith('w-xyz')
  })
})

// ── surfaceMenu ───────────────────────────────────────────────────────────────

describe('surfaceMenu', () => {
  it('has exactly 4 items', () => {
    const items = surfaceMenu(makeHandlers())
    expect(items).toHaveLength(4)
  })

  it('includes save-component, save-entity, save-view, clear', () => {
    const items = surfaceMenu(makeHandlers())
    const ids = items.map((i) => i.id)
    expect(ids).toContain('save-component')
    expect(ids).toContain('save-entity')
    expect(ids).toContain('save-view')
    expect(ids).toContain('clear')
  })

  it('clear is marked danger', () => {
    const items = surfaceMenu(makeHandlers())
    expect(items.find((i) => i.id === 'clear')?.danger).toBe(true)
  })

  it('save-component calls openSaveAs with component', () => {
    const handlers = makeHandlers()
    const items = surfaceMenu(handlers)
    items.find((i) => i.id === 'save-component')!.onSelect()
    expect(handlers.openSaveAs).toHaveBeenCalledWith('component')
  })
})

// ── paletteItemMenu ───────────────────────────────────────────────────────────

describe('paletteItemMenu — entity', () => {
  it('includes add, copy-address, open-studio', () => {
    const items = paletteItemMenu('entity', 'plex.list_recently_added', makeHandlers())
    const ids = items.map((i) => i.id)
    expect(ids).toContain('add')
    expect(ids).toContain('copy-address')
    expect(ids).toContain('open-studio')
  })

  it('add calls addFromPalette with entity kind and name', () => {
    const handlers = makeHandlers()
    const items = paletteItemMenu('entity', 'plex.list_recently_added', handlers)
    items.find((i) => i.id === 'add')!.onSelect()
    expect(handlers.addFromPalette).toHaveBeenCalledWith('entity', 'plex.list_recently_added')
  })
})

describe('paletteItemMenu — component', () => {
  it('includes open-studio', () => {
    const items = paletteItemMenu('component', 'Strip', makeHandlers())
    expect(items.find((i) => i.id === 'open-studio')).toBeDefined()
  })
})

describe('paletteItemMenu — function', () => {
  it('does not include open-studio', () => {
    const items = paletteItemMenu('function', 'std.filter', makeHandlers())
    expect(items.find((i) => i.id === 'open-studio')).toBeUndefined()
  })

  it('has only add and copy-address', () => {
    const items = paletteItemMenu('function', 'std.filter', makeHandlers())
    const ids = items.map((i) => i.id)
    expect(ids).toEqual(['add', 'copy-address'])
  })

  it('copy-address calls copyToClipboard with function name', () => {
    const handlers = makeHandlers()
    const items = paletteItemMenu('function', 'std.filter', handlers)
    items.find((i) => i.id === 'copy-address')!.onSelect()
    expect(handlers.copyToClipboard).toHaveBeenCalledWith('std.filter')
  })
})
