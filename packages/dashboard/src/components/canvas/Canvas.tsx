import { useRef } from 'react'
import { DndContext, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { Palette } from './Palette'
import { Placement } from './Placement'
import { Inspector } from './Inspector'
import { useCanvasDocument } from '../../hooks/useCanvasDocument'
import { getPlacement } from '../../lib/canvas/document'

export function Canvas() {
  const canvas = useCanvasDocument()
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event
    const data = active.data.current as {
      source?: string
      kind?: 'entity' | 'component'
      targetName?: string
      placementId?: string
    } | undefined

    if (data?.source === 'palette') {
      // Dropped from palette onto the canvas
      if (over?.id === 'canvas-surface' && data.kind && data.targetName) {
        // Compute drop position relative to canvas
        const rect = canvasRef.current?.getBoundingClientRect()
        const activatorEvent = event.activatorEvent as MouseEvent | TouchEvent
        const clientX = 'clientX' in activatorEvent
          ? (activatorEvent as MouseEvent).clientX
          : (activatorEvent as TouchEvent).touches[0]?.clientX ?? 0
        const clientY = 'clientY' in activatorEvent
          ? (activatorEvent as MouseEvent).clientY
          : (activatorEvent as TouchEvent).touches[0]?.clientY ?? 0
        const x = rect ? clientX - rect.left + delta.x : 40
        const y = rect ? clientY - rect.top + delta.y : 40
        canvas.addPlacement({
          kind: data.kind,
          targetName: data.targetName,
          position: { x: Math.max(0, x - 60), y: Math.max(0, y - 20) },
        })
      }
    } else if (data?.source === 'canvas' && data.placementId) {
      // Moving a placement within the canvas
      const existing = canvas.doc.placements.find(p => p.id === data.placementId)
      if (existing) {
        canvas.movePlacement(data.placementId, {
          x: Math.max(0, existing.position.x + delta.x),
          y: Math.max(0, existing.position.y + delta.y),
        })
      }
    }
  }

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="canvas-layout">
        <Palette />
        <CanvasSurface canvasRef={canvasRef} canvas={canvas} />
        <Inspector
          placement={canvas.selectedId ? getPlacement(canvas.doc, canvas.selectedId) ?? null : null}
          onDelete={() => { if (canvas.selectedId) canvas.removePlacement(canvas.selectedId) }}
        />
      </div>
    </DndContext>
  )
}

interface SurfaceProps {
  canvasRef: React.RefObject<HTMLDivElement | null>
  canvas: ReturnType<typeof useCanvasDocument>
}

function CanvasSurface({ canvasRef, canvas }: SurfaceProps) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas-surface' })

  const combinedRef = (node: HTMLDivElement | null) => {
    setNodeRef(node)
    ;(canvasRef as React.MutableRefObject<HTMLDivElement | null>).current = node
  }

  return (
    <div
      ref={combinedRef}
      className={`canvas-surface ${isOver ? 'drop-active' : ''}`}
      onClick={() => canvas.setSelectedId(null)}
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && canvas.selectedId) {
          canvas.removePlacement(canvas.selectedId)
        }
      }}
      tabIndex={0}
    >
      {canvas.doc.placements.length === 0 && (
        <div className="canvas-surface-empty">Drag items from the palette onto the canvas</div>
      )}
      {canvas.doc.placements.map((p) => (
        <Placement
          key={p.id}
          placement={p}
          selected={canvas.selectedId === p.id}
          onSelect={() => canvas.setSelectedId(p.id)}
        />
      ))}
    </div>
  )
}
