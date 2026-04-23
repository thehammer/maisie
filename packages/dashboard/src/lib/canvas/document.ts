/**
 * The canvas document model. A composition is a set of placements
 * (entities or components dragged onto the canvas) and wires
 * (connections between them, added in Phase 3b). This module owns
 * the document shape and pure helpers for manipulating it.
 */

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
  // transform?: LinkExpr — reserved for Phase 3d
}

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

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
