/**
 * The canvas document model. A composition is a set of placements
 * (entities or components dragged onto the canvas) and wires
 * (connections between them, added in Phase 3b). This module owns
 * the document shape and pure helpers for manipulating it.
 */

import type { LinkExpr } from './link-expr'
import type { BridgingChain } from './chain-search'

export interface CanvasDocument {
  version: 1
  placements: Placement[]
  wires: Wire[]
}

export interface Placement {
  id: string
  kind: 'entity' | 'component' | 'function'
  targetName: string           // entity.name, component.name, or FunctionDescriptor.id
  position: { x: number; y: number }
  /** Inline parameter values for function placements; optional component props. */
  config?: Record<string, unknown>
}

export interface Wire {
  id: string
  source: { placementId: string; field?: string }
  target: { placementId: string; slot?: string }
  /** Optional transform applied to the source value before it reaches the target. */
  transform?: LinkExpr
}

export type { LinkExpr } from './link-expr'

export function emptyDocument(): CanvasDocument {
  return { version: 1, placements: [], wires: [] }
}

export function addPlacement(doc: CanvasDocument, placement: Omit<Placement, 'id'>): CanvasDocument {
  return {
    ...doc,
    placements: [...doc.placements, { ...placement, id: generateId('p') }],
  }
}

export function removePlacement(doc: CanvasDocument, id: string): CanvasDocument {
  return {
    ...doc,
    placements: doc.placements.filter(p => p.id !== id),
    // Remove any wires that reference the deleted placement
    wires: doc.wires.filter(w => w.source.placementId !== id && w.target.placementId !== id),
  }
}

export function movePlacement(doc: CanvasDocument, id: string, position: { x: number; y: number }): CanvasDocument {
  return {
    ...doc,
    placements: doc.placements.map(p => p.id === id ? { ...p, position } : p),
  }
}

export function getPlacement(doc: CanvasDocument, id: string): Placement | undefined {
  return doc.placements.find(p => p.id === id)
}

export function addWire(doc: CanvasDocument, wire: Omit<Wire, 'id'>): CanvasDocument {
  return {
    ...doc,
    wires: [...doc.wires, { ...wire, id: generateId('w') }],
  }
}

export function removeWire(doc: CanvasDocument, id: string): CanvasDocument {
  return {
    ...doc,
    wires: doc.wires.filter((w) => w.id !== id),
  }
}

export function getWire(doc: CanvasDocument, id: string): Wire | undefined {
  return doc.wires.find((w) => w.id === id)
}

/**
 * Check if a wire connecting the given endpoints would be a duplicate.
 */
export function hasWire(
  doc: CanvasDocument,
  source: Wire['source'],
  target: Wire['target'],
): boolean {
  return doc.wires.some(
    (w) =>
      w.source.placementId === source.placementId &&
      w.source.field === source.field &&
      w.target.placementId === target.placementId &&
      w.target.slot === target.slot,
  )
}

/**
 * Set (or clear) the transform on a wire. Returns a new document.
 */
export function setWireTransform(
  doc: CanvasDocument,
  wireId: string,
  transform: LinkExpr | undefined,
): CanvasDocument {
  return {
    ...doc,
    wires: doc.wires.map((w) =>
      w.id === wireId ? { ...w, transform } : w,
    ),
  }
}

/**
 * Get the transform for a wire, or undefined if none is set.
 */
export function getWireTransform(
  doc: CanvasDocument,
  wireId: string,
): LinkExpr | undefined {
  return doc.wires.find((w) => w.id === wireId)?.transform
}

/**
 * Update (merge) the config on a placement. Useful for saving inline
 * parameter values on function placements from the inspector.
 */
export function updatePlacementConfig(
  doc: CanvasDocument,
  id: string,
  config: Record<string, unknown>,
): CanvasDocument {
  return {
    ...doc,
    placements: doc.placements.map((p) =>
      p.id === id ? { ...p, config: { ...p.config, ...config } } : p,
    ),
  }
}

/**
 * Apply a bridging chain to a canvas document.
 *
 * Finds the wire identified by wireId, removes it, inserts a function
 * placement for each step in the chain between the original source and
 * target, and adds new wires connecting them:
 *
 *   source → fn1 → fn2 → ... → target
 *
 * Function placements are positioned evenly along the segment between
 * the source and target placements, staggered vertically so they don't
 * overlap. Returns the updated document.
 *
 * If the wire is not found, the document is returned unchanged.
 */
export function applyChain(
  doc: CanvasDocument,
  chain: BridgingChain,
  wireId: string,
): CanvasDocument {
  const wire = doc.wires.find((w) => w.id === wireId)
  if (!wire) return doc

  const sourcePlacement = doc.placements.find((p) => p.id === wire.source.placementId)
  const targetPlacement = doc.placements.find((p) => p.id === wire.target.placementId)
  if (!sourcePlacement || !targetPlacement) return doc

  // Remove the original incompatible wire
  let next: CanvasDocument = {
    ...doc,
    wires: doc.wires.filter((w) => w.id !== wireId),
  }

  // Compute positions for the new function nodes, spread evenly between source and target
  const n = chain.steps.length
  const sx = sourcePlacement.position.x
  const sy = sourcePlacement.position.y
  const tx = targetPlacement.position.x
  const ty = targetPlacement.position.y

  const fnPlacementIds: string[] = []

  for (let i = 0; i < n; i++) {
    const step = chain.steps[i]
    // Linear interpolation: place functions at 1/(n+1), 2/(n+1), ... n/(n+1) along the segment
    const t = (i + 1) / (n + 1)
    const x = sx + (tx - sx) * t
    const y = sy + (ty - sy) * t

    const id = generateId('p')
    const placement: Placement = {
      id,
      kind: 'function',
      targetName: step.functionId,
      position: { x, y },
      config: step.suggestedParams,
    }
    next = {
      ...next,
      placements: [...next.placements, placement],
    }
    fnPlacementIds.push(id)
  }

  // Wire up: source → fn[0] → fn[1] → ... → target
  const allNodes = [wire.source.placementId, ...fnPlacementIds, wire.target.placementId]
  for (let i = 0; i < allNodes.length - 1; i++) {
    const wId = generateId('w')
    const newWire: Wire = {
      id: wId,
      source: { placementId: allNodes[i] },
      target: { placementId: allNodes[i + 1] },
    }
    next = {
      ...next,
      wires: [...next.wires, newWire],
    }
  }

  return next
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
