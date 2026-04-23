import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { Placement as PlacementType } from '../../lib/canvas/document'

interface PlacementProps {
  placement: PlacementType
  selected: boolean
  onSelect: () => void
  /** Ref callback for the output port element (entities and functions). */
  outputPortRef?: (el: HTMLElement | null) => void
  /** Ref callback for the input port element (components and functions). */
  inputPortRef?: (el: HTMLElement | null) => void
}

export function Placement({ placement, selected, onSelect, outputPortRef, inputPortRef }: PlacementProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: placement.id,
    data: { source: 'canvas', placementId: placement.id },
  })

  const style: React.CSSProperties = {
    position: 'absolute',
    left: placement.position.x,
    top: placement.position.y,
    transform: CSS.Translate.toString(transform),
    cursor: 'move',
  }

  // Derive a short display label: for function placements, strip the 'std.' prefix
  const displayName = placement.kind === 'function'
    ? placement.targetName.replace(/^std\./, '')
    : placement.targetName

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`canvas-placement canvas-placement-${placement.kind} ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      {...attributes}
      {...listeners}
    >
      {/* Input port — components and functions consume input on the left */}
      {(placement.kind === 'component' || placement.kind === 'function') && (
        <InputPort placementId={placement.id} portRef={inputPortRef} />
      )}
      <div className="canvas-placement-kind">{placement.kind}</div>
      <div className="canvas-placement-name">{displayName}</div>
      {/* Output port — entities and functions produce output on the right */}
      {(placement.kind === 'entity' || placement.kind === 'function') && (
        <OutputPort placementId={placement.id} portRef={outputPortRef} />
      )}
    </div>
  )
}

interface OutputPortProps {
  placementId: string
  portRef?: (el: HTMLElement | null) => void
}

function OutputPort({ placementId, portRef }: OutputPortProps) {
  const portId = `port:${placementId}:output`
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: portId,
    data: { source: 'port', placementId, role: 'output' },
  })

  const combinedRef = (el: HTMLDivElement | null) => {
    setNodeRef(el)
    portRef?.(el)
  }

  return (
    <div
      ref={combinedRef}
      className={`canvas-port canvas-port-output ${isDragging ? 'dragging' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      {...attributes}
      {...listeners}
    />
  )
}

interface InputPortProps {
  placementId: string
  portRef?: (el: HTMLElement | null) => void
}

function InputPort({ placementId, portRef }: InputPortProps) {
  const portId = `port:${placementId}:input`
  const { setNodeRef, isOver } = useDroppable({
    id: portId,
    data: { target: 'port', placementId, role: 'input' },
  })

  const combinedRef = (el: HTMLDivElement | null) => {
    setNodeRef(el)
    portRef?.(el)
  }

  return (
    <div
      ref={combinedRef}
      className={`canvas-port canvas-port-input ${isOver ? 'drop-target' : ''}`}
    />
  )
}
