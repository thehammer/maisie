import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { Placement as PlacementType } from '../../lib/canvas/document'

interface PlacementProps {
  placement: PlacementType
  selected: boolean
  onSelect: () => void
}

export function Placement({ placement, selected, onSelect }: PlacementProps) {
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
      <div className="canvas-placement-kind">{placement.kind}</div>
      <div className="canvas-placement-name">{placement.targetName}</div>
    </div>
  )
}
