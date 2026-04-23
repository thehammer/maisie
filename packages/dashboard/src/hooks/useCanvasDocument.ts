import { useState, useCallback } from 'react'
import {
  type CanvasDocument,
  type Placement,
  emptyDocument,
  addPlacement,
  removePlacement,
  movePlacement,
} from '../lib/canvas/document'

export interface UseCanvasDocument {
  doc: CanvasDocument
  addPlacement: (placement: Omit<Placement, 'id'>) => void
  removePlacement: (id: string) => void
  movePlacement: (id: string, position: { x: number; y: number }) => void
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
    selectedId,
    setSelectedId,
  }
}
