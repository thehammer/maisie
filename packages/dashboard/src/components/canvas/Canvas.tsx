import { useRef, useState, useEffect, useCallback } from 'react'
import { DndContext, useDroppable, type DragEndEvent, type DragStartEvent, type DragMoveEvent } from '@dnd-kit/core'
import { EntityPalette } from './EntityPalette'
import { ComponentPalette } from './ComponentPalette'
import { FunctionPalette } from './FunctionPalette'
import { Placement } from './Placement'
import { Inspector } from './Inspector'
import { Wire } from './Wire'
import { Preview } from './Preview'
import { ChainSuggestionPopover } from './ChainSuggestionPopover'
import { useCanvasDocument } from '../../hooks/useCanvasDocument'
import { hasWire, applyChain } from '../../lib/canvas/document'
import { validateWire, type WireStatus } from '../../lib/canvas/wire-validator'
import { resolveEntityPorts, resolveComponentPorts, resolveFunctionPorts, type PlacementPorts } from '../../lib/canvas/type-resolver'
import { canEmitComponent, canEmitEntity, canEmitView, emitComponent, emitEntity, emitView } from '../../lib/canvas/emit'
import { resolveComponent, refreshComponents } from '../../lib/components/resolver'
import { refreshCompletionCatalog } from '../../lib/editor/mel-completion'
import type { Placement as PlacementType } from '../../lib/canvas/document'
import type { BridgingChain } from '../../lib/canvas/chain-search'
import type { MaisieValue, TypeExpr, ComponentDef } from '@maisie/shared'

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
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  // Chain suggestion popover state
  const [chainSuggestion, setChainSuggestion] = useState<{
    wireId: string
    chains: BridgingChain[]
    anchorPos: { x: number; y: number }
  } | null>(null)

  // Compute emit availability from the current doc
  const componentCheck = canEmitComponent(canvas.doc)
  const entityCheck = canEmitEntity(canvas.doc)
  const viewCheck = canEmitView(canvas.doc)
  const canEmitComponentError = componentCheck.ok ? null : componentCheck.error
  const canEmitEntityError = entityCheck.ok ? null : entityCheck.error
  const canEmitViewError = viewCheck.ok ? null : viewCheck.error

  // Save as component: emit → POST → refresh catalog
  const handleSaveComponent = useCallback(async (name: string, description: string) => {
    const result = emitComponent(canvas.doc, { name, description: description || undefined }, resolveComponent as (n: string) => ComponentDef | undefined)
    if (!result.ok || !result.artifact) {
      setSaveStatus(`Error: ${result.error}`)
      return
    }
    try {
      const res = await fetch('/api/components', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component: result.artifact }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        setSaveStatus(`Save failed: ${body.error ?? res.statusText}`)
        return
      }
      await refreshComponents()
      refreshCompletionCatalog()
      setSaveStatus(`Saved component "${name}"`)
      setTimeout(() => setSaveStatus(null), 3000)
    } catch (err) {
      setSaveStatus(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [canvas.doc])

  // Clear canvas — confirm first, then clear local state + server
  const handleClearCanvas = useCallback(async () => {
    if (canvas.doc.placements.length === 0) return
    if (!window.confirm('Clear the canvas? This cannot be undone.')) return
    await canvas.clear()
    setSaveStatus(null)
  }, [canvas])

  // Save as view: emit → POST → refresh catalog
  const handleSaveView = useCallback(async (name: string, description: string) => {
    const result = emitView(canvas.doc, { name, description: description || undefined })
    if (!result.ok || !result.artifact) {
      setSaveStatus(`Error: ${result.error}`)
      return
    }
    try {
      const res = await fetch('/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: result.artifact }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        setSaveStatus(`Save failed: ${body.error ?? res.statusText}`)
        return
      }
      refreshCompletionCatalog()
      setSaveStatus(`Saved view "${name}"`)
      setTimeout(() => setSaveStatus(null), 3000)
    } catch (err) {
      setSaveStatus(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [canvas.doc])

  // Save as entity: emit → POST → refresh catalog
  const handleSaveEntity = useCallback(async (name: string, description: string) => {
    const result = emitEntity(canvas.doc, { name, description: description || undefined }, resolveComponent as (n: string) => ComponentDef | undefined)
    if (!result.ok || !result.artifact) {
      setSaveStatus(`Error: ${result.error}`)
      return
    }
    try {
      const res = await fetch('/api/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: result.artifact }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        setSaveStatus(`Save failed: ${body.error ?? res.statusText}`)
        return
      }
      refreshCompletionCatalog()
      setSaveStatus(`Saved entity "${name}"`)
      setTimeout(() => setSaveStatus(null), 3000)
    } catch (err) {
      setSaveStatus(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [canvas.doc])

  // Cache of resolved ports per placement — avoid re-fetching on every render
  const portsCache = useRef<Map<string, PlacementPorts>>(new Map())

  // Catalog-level type caches (entity name → output, component name → input)
  // These are shared with the palette sub-components for compatibility highlighting.
  const entityOutputCache = useRef<Map<string, TypeExpr>>(new Map())
  const componentInputCache = useRef<Map<string, TypeExpr>>(new Map())
  const [entityOutputTypes, setEntityOutputTypes] = useState<Map<string, TypeExpr>>(new Map())
  const [componentInputTypes, setComponentInputTypes] = useState<Map<string, TypeExpr>>(new Map())

  // Fetch types for all placements
  useEffect(() => {
    const toFetch = canvas.doc.placements.filter((p) => !portsCache.current.has(p.id))
    if (toFetch.length === 0) return

    const fetches = toFetch.map(async (p) => {
      let ports: PlacementPorts | null
      if (p.kind === 'entity') {
        ports = await resolveEntityPorts(p.targetName)
        if (ports?.output) {
          entityOutputCache.current.set(p.targetName, ports.output)
        }
      } else if (p.kind === 'function') {
        ports = resolveFunctionPorts(p.targetName)
      } else {
        ports = await resolveComponentPorts(p.targetName)
        if (ports?.input) {
          componentInputCache.current.set(p.targetName, ports.input)
        }
      }
      if (ports) portsCache.current.set(p.id, ports)
    })

    Promise.all(fetches).then(() => {
      setPlacementPorts(new Map(portsCache.current))
      setEntityOutputTypes(new Map(entityOutputCache.current))
      setComponentInputTypes(new Map(componentInputCache.current))
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
      kind?: 'entity' | 'component' | 'function'
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

  // Derive palette highlight targets from the selected placement.
  //   entity selected  → highlight components that accept its output; functions that accept it
  //   component selected → highlight entities that produce compatible output; functions whose output feeds it
  //   function selected → highlight entities (fn input side) and components (fn output side)
  const selectedPorts = selectedPlacement ? placementPorts.get(selectedPlacement.id) : undefined

  // EntityPalette: highlight when a component or function is selected
  const entityHighlightTarget: TypeExpr | undefined =
    selectedPlacement?.kind === 'component' ? selectedPorts?.input
    : selectedPlacement?.kind === 'function' ? selectedPorts?.input
    : undefined

  // ComponentPalette: highlight when an entity or function is selected
  const componentHighlightTarget: TypeExpr | undefined =
    selectedPlacement?.kind === 'entity' ? selectedPorts?.output
    : selectedPlacement?.kind === 'function' ? selectedPorts?.output
    : undefined

  // FunctionPalette: highlight input side from entity output, output side from component input
  const fnInputHighlight: TypeExpr | undefined =
    selectedPlacement?.kind === 'entity' ? selectedPorts?.output : undefined
  const fnOutputHighlight: TypeExpr | undefined =
    selectedPlacement?.kind === 'component' ? selectedPorts?.input : undefined

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

  // Preview: resolve the live data for an entity placement by fetching its primary field.
  // Component placements don't produce data in isolation — return undefined.
  const resolveInput = useCallback(async (placementId: string): Promise<MaisieValue | undefined> => {
    const placement = canvas.doc.placements.find((p) => p.id === placementId)
    if (!placement || placement.kind !== 'entity') return undefined

    try {
      // First get entity definition to know the field name
      const defRes = await fetch(`/api/entities/${encodeURIComponent(placement.targetName)}`)
      if (!defRes.ok) return undefined
      const entity = await defRes.json() as { fields?: Record<string, { kind: string }> }
      const dataFields = Object.entries(entity.fields ?? {}).filter(([, f]) => f.kind === 'data')
      if (dataFields.length === 0) return undefined
      const fieldName = dataFields[0][0]

      // Fetch the field value
      const valRes = await fetch(`/api/entities/${encodeURIComponent(placement.targetName)}/${encodeURIComponent(fieldName)}`)
      if (!valRes.ok) return undefined
      const body = await valRes.json() as unknown
      // Derived entity response is wrapped in {value: ...}
      if (body !== null && typeof body === 'object' && 'value' in (body as object)) {
        return (body as { value: MaisieValue }).value
      }
      return body as MaisieValue
    } catch {
      return undefined
    }
  }, [canvas.doc.placements])

  // Preview: return the input TypeExpr for a component placement from the ports cache.
  const resolveInputType = useCallback((placementId: string): TypeExpr | undefined => {
    return placementPorts.get(placementId)?.input
  }, [placementPorts])

  // Apply a bridging chain — replace the incompatible wire with function placements + wires
  const handleApplyChain = useCallback((chain: BridgingChain) => {
    if (!chainSuggestion) return
    const newDoc = applyChain(canvas.doc, chain, chainSuggestion.wireId)
    canvas.setDoc(newDoc)
    setChainSuggestion(null)
  }, [chainSuggestion, canvas])

  // Show chain suggestion popover when a wire is selected and has suggestions
  const handleWireClick = useCallback((wireId: string, pos: { x: number; y: number }, chains: BridgingChain[]) => {
    canvas.setSelectedId(wireId)
    if (chains.length > 0) {
      setChainSuggestion({ wireId, chains, anchorPos: pos })
    }
  }, [canvas])

  if (canvas.restoring) {
    return <div className="canvas-layout-outer canvas-restoring">Restoring canvas…</div>
  }

  return (
    <DndContext onDragStart={handleDragStart} onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
      <div className="canvas-layout-outer">
        <SaveArtifactPanel
          onSaveComponent={handleSaveComponent}
          onSaveEntity={handleSaveEntity}
          onSaveView={handleSaveView}
          onClearCanvas={handleClearCanvas}
          canEmit={{ component: canEmitComponentError, entity: canEmitEntityError, view: canEmitViewError }}
          status={saveStatus}
          isEmpty={canvas.doc.placements.length === 0}
        />
        <div className="canvas-layout canvas-layout-split">
          {/* Left: Entity palette */}
          <EntityPalette
            highlightTarget={entityHighlightTarget}
            entityOutputTypes={entityOutputTypes}
          />

          {/* Center: Canvas surface + function dock */}
          <div className="canvas-center-column">
            <CanvasSurface
              canvasRef={canvasRef}
              canvas={canvas}
              pendingWire={pendingWire}
              portPositions={portPositions}
              placementPorts={placementPorts}
              registerPort={registerPort}
              updatePortPositions={updatePortPositions}
              onKeyDown={handleKeyDown}
              chainSuggestion={chainSuggestion}
              onWireClick={handleWireClick}
              onApplyChain={handleApplyChain}
              onDismissChain={() => setChainSuggestion(null)}
            />
            <FunctionPalette
              highlightInputTarget={fnInputHighlight}
              highlightOutputTarget={fnOutputHighlight}
            />
          </div>

          {/* Right: Component palette or inspector overlay */}
          <div className="canvas-right-column">
            <ComponentPalette
              highlightTarget={componentHighlightTarget}
              componentInputTypes={componentInputTypes}
            />
            {(selectedPlacement || selectedWire) && (
              <div className="canvas-inspector-overlay">
                <Inspector
                  placement={selectedPlacement}
                  wire={selectedWire}
                  placementPorts={placementPorts}
                  placements={canvas.doc.placements}
                  onDeletePlacement={() => { if (canvas.selectedId) canvas.removePlacement(canvas.selectedId) }}
                  onDeleteWire={() => { if (canvas.selectedId) canvas.removeWire(canvas.selectedId) }}
                  onSetWireTransform={(transform) => {
                    if (canvas.selectedId) canvas.setWireTransform(canvas.selectedId, transform)
                  }}
                  onUpdatePlacementConfig={(config) => {
                    if (canvas.selectedId) canvas.updatePlacementConfig(canvas.selectedId, config)
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Compatibility legend */}
        {(entityHighlightTarget ?? componentHighlightTarget ?? fnInputHighlight ?? fnOutputHighlight) && (
          <CompatLegend />
        )}

        <div className={`canvas-preview-drawer${previewOpen ? '' : ' collapsed'}`}>
          <div className="canvas-preview-toolbar">
            <span className="canvas-preview-title">Preview</span>
            <button
              className="canvas-preview-toggle"
              onClick={() => setPreviewOpen((v) => !v)}
            >
              {previewOpen ? 'Hide' : 'Show'}
            </button>
          </div>
          {previewOpen && (
            <Preview
              doc={canvas.doc}
              resolveInput={resolveInput}
              resolveInputType={resolveInputType}
            />
          )}
        </div>
      </div>
      {/* Toggle button in the bottom-right of the canvas area, visible when drawer is closed */}
      {!previewOpen && (
        <div className="canvas-preview-fab">
          <button onClick={() => setPreviewOpen(true)}>Preview</button>
        </div>
      )}
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
  chainSuggestion: { wireId: string; chains: BridgingChain[]; anchorPos: { x: number; y: number } } | null
  onWireClick: (wireId: string, pos: { x: number; y: number }, chains: BridgingChain[]) => void
  onApplyChain: (chain: BridgingChain) => void
  onDismissChain: () => void
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
  chainSuggestion,
  onWireClick,
  onApplyChain,
  onDismissChain,
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
          const chains = validation.suggestedChains ?? []
          const midPos = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
          return (
            <Wire
              key={wire.id}
              from={from}
              to={to}
              status={validation.status}
              selected={canvas.selectedId === wire.id}
              message={validation.message}
              transform={wire.transform}
              onClick={() => onWireClick(wire.id, midPos, chains)}
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

      {/* Chain suggestion popover — shown when an incompatible wire is clicked and chains exist */}
      {chainSuggestion && (
        <ChainSuggestionPopover
          chains={chainSuggestion.chains}
          anchorPos={chainSuggestion.anchorPos}
          onApply={onApplyChain}
          onDismiss={onDismissChain}
        />
      )}
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

// ── CompatLegend ──────────────────────────────────────────────────────────────

function CompatLegend() {
  return (
    <div className="canvas-compat-legend">
      <span className="canvas-compat-legend-label">Compatibility:</span>
      <span className="canvas-compat-badge canvas-compat-badge-compatible">direct</span>
      <span className="canvas-compat-legend-hint">direct match</span>
      <span className="canvas-compat-badge canvas-compat-badge-chain">via fn</span>
      <span className="canvas-compat-legend-hint">bridgeable with a function</span>
      <span className="canvas-compat-badge canvas-compat-badge-incompatible">no match</span>
      <span className="canvas-compat-legend-hint">incompatible</span>
    </div>
  )
}

// ── SaveArtifactPanel ─────────────────────────────────────────────────────────

interface SaveArtifactPanelProps {
  onSaveComponent: (name: string, description: string) => Promise<void>
  onSaveEntity: (name: string, description: string) => Promise<void>
  onSaveView: (name: string, description: string) => Promise<void>
  onClearCanvas: () => Promise<void>
  canEmit: { component: string | null; entity: string | null; view: string | null }
  status: string | null
  isEmpty: boolean
}

function SaveArtifactPanel({
  onSaveComponent,
  onSaveEntity,
  onSaveView,
  onClearCanvas,
  canEmit,
  status,
  isEmpty,
}: SaveArtifactPanelProps) {
  const [open, setOpen] = useState<'component' | 'entity' | 'view' | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const handleOpen = (kind: 'component' | 'entity' | 'view') => {
    setName('')
    setDescription('')
    setOpen(kind)
  }

  const handleSave = async () => {
    if (!name.trim() || !open) return
    setSaving(true)
    try {
      if (open === 'component') {
        await onSaveComponent(name.trim(), description.trim())
      } else if (open === 'entity') {
        await onSaveEntity(name.trim(), description.trim())
      } else {
        await onSaveView(name.trim(), description.trim())
      }
      setOpen(null)
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSave()
    }
    if (e.key === 'Escape') setOpen(null)
  }

  const kindLabel =
    open === 'component' ? 'Component'
    : open === 'entity' ? 'Entity'
    : 'View'

  const namePlaceholder =
    open === 'component' ? 'e.g. MovieStrip'
    : open === 'view' ? 'e.g. recent-movies-strip'
    : 'e.g. recent-movies-view'

  return (
    <div className="canvas-save-panel">
      <div className="canvas-save-toolbar">
        <span className="canvas-save-label">Emit:</span>
        <button
          className="canvas-save-btn"
          disabled={canEmit.component !== null}
          title={canEmit.component ?? 'Save canvas as a derived component'}
          onClick={() => handleOpen('component')}
        >
          Save as Component
        </button>
        <button
          className="canvas-save-btn"
          disabled={canEmit.entity !== null}
          title={canEmit.entity ?? 'Save canvas as a derived entity'}
          onClick={() => handleOpen('entity')}
        >
          Save as Entity
        </button>
        <button
          className="canvas-save-btn"
          disabled={canEmit.view !== null}
          title={canEmit.view ?? 'Save canvas as a named view (entity + chain + component)'}
          onClick={() => handleOpen('view')}
        >
          Save as View
        </button>
        <button
          className="canvas-save-btn canvas-clear-btn"
          disabled={isEmpty}
          title={isEmpty ? 'Canvas is already empty' : 'Clear all placements and wires'}
          onClick={() => void onClearCanvas()}
        >
          Clear
        </button>
        {status && <span className="canvas-save-status">{status}</span>}
      </div>

      {open && (
        <div className="canvas-save-form" onKeyDown={handleKeyDown}>
          <div className="canvas-save-form-row">
            <label className="canvas-save-form-label">
              Name
              <input
                className="canvas-save-form-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={namePlaceholder}
                autoFocus
              />
            </label>
          </div>
          <div className="canvas-save-form-row">
            <label className="canvas-save-form-label">
              Description (optional)
              <textarea
                className="canvas-save-form-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What does this artifact do?"
              />
            </label>
          </div>
          <div className="canvas-save-form-actions">
            <button
              className="canvas-save-form-submit"
              onClick={() => void handleSave()}
              disabled={saving || !name.trim()}
            >
              {saving ? 'Saving…' : `Save as ${kindLabel}`}
            </button>
            <button
              className="canvas-save-form-cancel"
              onClick={() => setOpen(null)}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
