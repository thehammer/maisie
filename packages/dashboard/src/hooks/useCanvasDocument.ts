import { useState, useCallback, useEffect, useRef } from 'react'
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
  duplicatePlacement,
  resetPlacementConfig,
} from '../lib/canvas/document'

const CANVAS_ID = 'default'
const AUTOSAVE_DELAY_MS = 1500

export interface UseCanvasDocument {
  doc: CanvasDocument
  setDoc: (doc: CanvasDocument) => void
  addPlacement: (placement: Omit<Placement, 'id'>) => void
  removePlacement: (id: string) => void
  movePlacement: (id: string, position: { x: number; y: number }) => void
  updatePlacementConfig: (id: string, config: Record<string, unknown>) => void
  duplicatePlacement: (id: string) => void
  resetPlacementConfig: (id: string) => void
  addWire: (wire: Omit<Wire, 'id'>) => void
  removeWire: (id: string) => void
  setWireTransform: (wireId: string, transform: LinkExpr | undefined) => void
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  /** Clear the canvas locally and on the server. Requires confirmation. */
  clear: () => Promise<void>
  /** True while initial restore from server is in progress. */
  restoring: boolean
}

export function useCanvasDocument(): UseCanvasDocument {
  const [doc, setDocState] = useState<CanvasDocument>(emptyDocument)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(true)

  // Track whether the initial restore has completed — prevents autosave loop.
  const loadedRef = useRef(false)
  // Debounce timer ref for autosave.
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Restore on mount ────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function restore() {
      try {
        const res = await fetch(`/api/canvas/${CANVAS_ID}`)
        if (!cancelled && res.ok) {
          const body = await res.json() as { document?: unknown }
          if (body.document && typeof body.document === 'object') {
            const restored = body.document as CanvasDocument
            // Basic version guard — only restore if we recognise it
            if (restored.version === 1 && Array.isArray(restored.placements)) {
              setDocState(restored)
            }
          }
        }
      } catch {
        // Server unreachable at restore time — start fresh, autosave will sync later
      } finally {
        if (!cancelled) {
          loadedRef.current = true
          setRestoring(false)
        }
      }
    }
    restore()
    return () => { cancelled = true }
  }, [])

  // ── Autosave on doc changes (after restore) ─────────────────────────────────

  useEffect(() => {
    // Don't autosave until the initial restore has completed.
    if (!loadedRef.current) return

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
    }
    autosaveTimerRef.current = setTimeout(() => {
      fetch(`/api/canvas/${CANVAS_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: doc }),
      }).catch(() => {
        // Autosave failures are silent — user data lives in local state
      })
    }, AUTOSAVE_DELAY_MS)

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
      }
    }
  }, [doc])

  // ── setDoc wrapper (for bulk operations like applyChain) ────────────────────

  const setDoc = useCallback((next: CanvasDocument) => {
    setDocState(next)
  }, [])

  // ── Clear ────────────────────────────────────────────────────────────────────

  const clear = useCallback(async () => {
    setDocState(emptyDocument())
    setSelectedId(null)
    try {
      await fetch(`/api/canvas/${CANVAS_ID}`, { method: 'DELETE' })
    } catch {
      // Silent — local state is already cleared
    }
  }, [])

  // ── Document operation wrappers ─────────────────────────────────────────────

  return {
    doc,
    setDoc,
    addPlacement: useCallback((p) => setDocState((d) => addPlacement(d, p)), []),
    removePlacement: useCallback((id) => {
      setDocState((d) => removePlacement(d, id))
      setSelectedId((curr) => (curr === id ? null : curr))
    }, []),
    movePlacement: useCallback((id, pos) => setDocState((d) => movePlacement(d, id, pos)), []),
    updatePlacementConfig: useCallback(
      (id, config) => setDocState((d) => updatePlacementConfig(d, id, config)),
      [],
    ),
    duplicatePlacement: useCallback((id) => setDocState((d) => duplicatePlacement(d, id)), []),
    resetPlacementConfig: useCallback((id) => setDocState((d) => resetPlacementConfig(d, id)), []),
    addWire: useCallback((wire) => setDocState((d) => addWire(d, wire)), []),
    removeWire: useCallback((id) => {
      setDocState((d) => removeWire(d, id))
      setSelectedId((curr) => (curr === id ? null : curr))
    }, []),
    setWireTransform: useCallback(
      (wireId, transform) => setDocState((d) => setWireTransform(d, wireId, transform)),
      [],
    ),
    selectedId,
    setSelectedId,
    clear,
    restoring,
  }
}
