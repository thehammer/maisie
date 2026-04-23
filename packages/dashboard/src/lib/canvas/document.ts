/**
 * The canvas document model. A composition is a set of placements
 * (entities or components dragged onto the canvas) and wires
 * (connections between them, added in Phase 3b). This module owns
 * the document shape and pure helpers for manipulating it.
 */

import type { LinkExpr } from './link-expr'

export interface CanvasDocument {
  version: 1
  placements: Placement[]
  wires: Wire[]
}

export interface Placement {
  id: string
  kind: 'entity' | 'component'
  targetName: string           // entity.name or component.name
  position: { x: number; y: number }
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

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
