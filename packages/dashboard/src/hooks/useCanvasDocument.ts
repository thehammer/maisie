import { useState, useCallback } from 'react'
import {
  type CanvasDocument,
  type Placement,
  type Wire,
  type LinkExpr,
  emptyDocument,
  addPlacement,
  removePlacement,
  movePlacement,
  addWire,
  removeWire,
  setWireTransform,
  updatePlacementConfig,
} from '../lib/canvas/document'

export interface UseCanvasDocument {
  doc: CanvasDocument
  addPlacement: (placement: Omit<Placement, 'id'>) => void
  removePlacement: (id: string) => void
  movePlacement: (id: string, position: { x: number; y: number }) => void
  updatePlacementConfig: (id: string, config: Record<string, unknown>) => void
  addWire: (wire: Omit<Wire, 'id'>) => void
  removeWire: (id: string) => void
  setWireTransform: (wireId: string, transform: LinkExpr | undefined) => void
  selectedId: string | null
  setSelectedId: (id: string | null) => void
}

export function useCanvasDocument(): UseCanvasDocument {
  const [doc, setDoc] = useState<CanvasDocument>(emptyDocument)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return {
    doc,
    addPlacement: useCallback((p) => setDoc((d) => addPlacement(d, p)), []),
    removePlacement: useCallback((id) => {
      setDoc((d) => removePlacement(d, id))
      setSelectedId((curr) => (curr === id ? null : curr))
    }, []),
    movePlacement: useCallback((id, pos) => setDoc((d) => movePlacement(d, id, pos)), []),
    updatePlacementConfig: useCallback(
      (id, config) => setDoc((d) => updatePlacementConfig(d, id, config)),
      [],
    ),
    addWire: useCallback((wire) => setDoc((d) => addWire(d, wire)), []),
    removeWire: useCallback((id) => {
      setDoc((d) => removeWire(d, id))
      setSelectedId((curr) => (curr === id ? null : curr))
    }, []),
    setWireTransform: useCallback(
      (wireId, transform) => setDoc((d) => setWireTransform(d, wireId, transform)),
      [],
    ),
    selectedId,
    setSelectedId,
  }
}
