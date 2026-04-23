import { useRef, useState, useEffect, useCallback } from 'react'
import { DndContext, useDroppable, type DragEndEvent, type DragStartEvent, type DragMoveEvent } from '@dnd-kit/core'
import { Palette } from './Palette'
import { Placement } from './Placement'
import { Inspector } from './Inspector'
import { Wire } from './Wire'
import { useCanvasDocument } from '../../hooks/useCanvasDocument'
import { hasWire } from '../../lib/canvas/document'
import { validateWire, type WireStatus } from '../../lib/canvas/wire-validator'
import { resolveEntityPorts, resolveComponentPorts, type PlacementPorts } from '../../lib/canvas/type-resolver'
import type { Placement as PlacementType } from '../../lib/canvas/document'

// Pending wire during drag
interface PendingWire {
  sourcePlacementId: string
  fromPos: { x: number; y: number }
  toPos: { x: number; y: number }
}

// Port DOM positions keyed by `port:<placementId>:<role>`
type PortPositions = Map<string, { x: number; y: number }>

export function Canvas() {
  const canvas = useCanvasDocument()
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [pendingWire, setPendingWire] = useState<PendingWire | null>(null)
  const portRefs = useRef<Map<string, HTMLElement>>(new Map())
  const [portPositions, setPortPositions] = useState<PortPositions>(new Map())
  const [placementPorts, setPlacementPorts] = useState<Map<string, PlacementPorts>>(new Map())

  // Cache of resolved ports per placement — avoid re-fetching on every render
  const portsCache = useRef<Map<string, PlacementPorts>>(new Map())

  // Fetch types for all placements
  useEffect(() => {
    const toFetch = canvas.doc.placements.filter((p) => !portsCache.current.has(p.id))
    if (toFetch.length === 0) return

    const fetches = toFetch.map(async (p) => {
      const ports =
        p.kind === 'entity'
          ? await resolveEntityPorts(p.targetName)
          : await resolveComponentPorts(p.targetName)
      if (ports) portsCache.current.set(p.id, ports)
    })

    Promise.all(fetches).then(() => {
      setPlacementPorts(new Map(portsCache.current))
    })
  }, [canvas.doc.placements])

  // Recompute port positions after each render
  const updatePortPositions = useCallback(() => {
    const canvasRect = canvasRef.current?.getBoundingClientRect()
    if (!canvasRect) return
    const next = new Map<string, { x: number; y: number }>()
    portRefs.current.forEach((el, key) => {
      const rect = el.getBoundingClientRect()
      next.set(key, {
        x: rect.left + rect.width / 2 - canvasRect.left,
        y: rect.top + rect.height / 2 - canvasRect.top,
      })
    })
    setPortPositions(next)
  }, [])

  // Register/unregister port DOM elements
  const registerPort = useCallback((key: string, el: HTMLElement | null) => {
    if (el) {
      portRefs.current.set(key, el)
    } else {
      portRefs.current.delete(key)
    }
  }, [])

  useEffect(() => {
    updatePortPositions()
  }, [canvas.doc.placements, updatePortPositions])

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { source?: string; placementId?: string; role?: string } | undefined
    if (data?.source === 'port' && data.role === 'output' && data.placementId) {
      const portKey = `port:${data.placementId}:output`
      const fromPos = portPositions.get(portKey)
      if (fromPos) {
        setPendingWire({
          sourcePlacementId: data.placementId,
          fromPos,
          toPos: fromPos,
        })
      }
    }
  }

  const handleDragMove = (event: DragMoveEvent) => {
    if (!pendingWire) return
    const canvasRect = canvasRef.current?.getBoundingClientRect()
    if (!canvasRect) return

    // @dnd-kit provides current pointer coords via activatorEvent + delta
    const activatorEvent = event.activatorEvent as MouseEvent | TouchEvent
    const startX = 'clientX' in activatorEvent ? (activatorEvent as MouseEvent).clientX : 0
    const startY = 'clientY' in activatorEvent ? (activatorEvent as MouseEvent).clientY : 0

    const toPos = {
      x: startX + event.delta.x - canvasRect.left,
      y: startY + event.delta.y - canvasRect.top,
    }
    setPendingWire((prev) => prev ? { ...prev, toPos } : null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event
    const data = active.data.current as {
      source?: string
      kind?: 'entity' | 'component'
      targetName?: string
      placementId?: string
      role?: string
    } | undefined

    if (data?.source === 'port' && data.role === 'output' && data.placementId) {
      // Wire drop
      const overData = over?.data.current as { target?: string; placementId?: string; role?: string } | undefined
      if (overData?.target === 'port' && overData.role === 'input' && overData.placementId) {
        const sourcePlacementId = data.placementId
        const targetPlacementId = overData.placementId
        if (
          sourcePlacementId !== targetPlacementId &&
          !hasWire(
            canvas.doc,
            { placementId: sourcePlacementId },
            { placementId: targetPlacementId },
          )
        ) {
          canvas.addWire({
            source: { placementId: sourcePlacementId },
            target: { placementId: targetPlacementId },
          })
        }
      }
      setPendingWire(null)
      return
    }

    if (data?.source === 'palette') {
      if (over?.id === 'canvas-surface' && data.kind && data.targetName) {
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
      const existing = canvas.doc.placements.find((p) => p.id === data.placementId)
      if (existing) {
        canvas.movePlacement(data.placementId, {
          x: Math.max(0, existing.position.x + delta.x),
          y: Math.max(0, existing.position.y + delta.y),
        })
      }
    }
  }

  // Determine what is selected — placement or wire
  const selectedPlacement = canvas.selectedId
    ? canvas.doc.placements.find((p) => p.id === canvas.selectedId) ?? null
    : null
  const selectedWire = canvas.selectedId
    ? canvas.doc.wires.find((w) => w.id === canvas.selectedId) ?? null
    : null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!canvas.selectedId) return
      if (selectedPlacement) {
        canvas.removePlacement(canvas.selectedId)
      } else if (selectedWire) {
        canvas.removeWire(canvas.selectedId)
      }
    }
  }

  return (
    <DndContext onDragStart={handleDragStart} onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
      <div className="canvas-layout">
        <Palette />
        <CanvasSurface
          canvasRef={canvasRef}
          canvas={canvas}
          pendingWire={pendingWire}
          portPositions={portPositions}
          placementPorts={placementPorts}
          registerPort={registerPort}
          updatePortPositions={updatePortPositions}
          onKeyDown={handleKeyDown}
        />
        <Inspector
          placement={selectedPlacement}
          wire={selectedWire}
          placementPorts={placementPorts}
          placements={canvas.doc.placements}
          onDeletePlacement={() => { if (canvas.selectedId) canvas.removePlacement(canvas.selectedId) }}
          onDeleteWire={() => { if (canvas.selectedId) canvas.removeWire(canvas.selectedId) }}
        />
      </div>
    </DndContext>
  )
}

interface SurfaceProps {
  canvasRef: React.RefObject<HTMLDivElement | null>
  canvas: ReturnType<typeof useCanvasDocument>
  pendingWire: PendingWire | null
  portPositions: PortPositions
  placementPorts: Map<string, PlacementPorts>
  registerPort: (key: string, el: HTMLElement | null) => void
  updatePortPositions: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

function CanvasSurface({
  canvasRef,
  canvas,
  pendingWire,
  portPositions,
  placementPorts,
  registerPort,
  updatePortPositions,
  onKeyDown,
}: SurfaceProps) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas-surface' })

  const combinedRef = (node: HTMLDivElement | null) => {
    setNodeRef(node)
    ;(canvasRef as React.MutableRefObject<HTMLDivElement | null>).current = node
  }

  // Compute wire validations
  const wireValidations = new Map<string, ReturnType<typeof validateWire>>()
  for (const wire of canvas.doc.wires) {
    const srcPorts = placementPorts.get(wire.source.placementId)
    const tgtPorts = placementPorts.get(wire.target.placementId)
    wireValidations.set(wire.id, validateWire(srcPorts?.output, tgtPorts?.input))
  }

  return (
    <div
      ref={combinedRef}
      className={`canvas-surface ${isOver ? 'drop-active' : ''}`}
      onClick={() => canvas.setSelectedId(null)}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      {/* SVG layer for wires — sits behind placements but above background */}
      <svg className="canvas-surface-svg">
        {canvas.doc.wires.map((wire) => {
          const fromKey = `port:${wire.source.placementId}:output`
          const toKey = `port:${wire.target.placementId}:input`
          const from = portPositions.get(fromKey)
          const to = portPositions.get(toKey)
          if (!from || !to) return null
          const validation = wireValidations.get(wire.id) ?? { status: 'unknown' as WireStatus }
          return (
            <Wire
              key={wire.id}
              from={from}
              to={to}
              status={validation.status}
              selected={canvas.selectedId === wire.id}
              message={validation.message}
              onClick={() => canvas.setSelectedId(wire.id)}
            />
          )
        })}
        {/* Pending wire while dragging from a port */}
        {pendingWire && (
          <Wire
            from={pendingWire.fromPos}
            to={pendingWire.toPos}
            status="unknown"
          />
        )}
      </svg>

      {canvas.doc.placements.length === 0 && (
        <div className="canvas-surface-empty">Drag items from the palette onto the canvas</div>
      )}
      {canvas.doc.placements.map((p) => (
        <PlacementWithPorts
          key={p.id}
          placement={p}
          selected={canvas.selectedId === p.id}
          onSelect={() => canvas.setSelectedId(p.id)}
          registerPort={registerPort}
        />
      ))}
    </div>
  )
}

interface PlacementWithPortsProps {
  placement: PlacementType
  selected: boolean
  onSelect: () => void
  registerPort: (key: string, el: HTMLElement | null) => void
}

function PlacementWithPorts({ placement, selected, onSelect, registerPort }: PlacementWithPortsProps) {
  const outputRef = useCallback(
    (el: HTMLElement | null) => registerPort(`port:${placement.id}:output`, el),
    [placement.id, registerPort],
  )
  const inputRef = useCallback(
    (el: HTMLElement | null) => registerPort(`port:${placement.id}:input`, el),
    [placement.id, registerPort],
  )

  return (
    <Placement
      placement={placement}
      selected={selected}
      onSelect={onSelect}
      outputPortRef={outputRef}
      inputPortRef={inputRef}
    />
  )
}

