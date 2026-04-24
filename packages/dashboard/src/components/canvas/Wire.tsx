import type { WireStatus } from '../../lib/canvas/wire-validator'
import type { LinkExpr } from '../../lib/canvas/link-expr'

interface WireProps {
  from: { x: number; y: number }
  to: { x: number; y: number }
  status: WireStatus
  selected?: boolean
  onClick?: () => void
  onDelete?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  message?: string
  transform?: LinkExpr
}

const STATUS_COLOR: Record<WireStatus, string> = {
  compatible: 'var(--status-ok, #4ade80)',
  ambiguous: 'var(--status-warn, #facc15)',
  incompatible: 'var(--status-err, #f87171)',
  unknown: 'var(--text-muted, #888)',
}

export function Wire({ from, to, status, selected, onClick, onDelete, onContextMenu, message, transform }: WireProps) {
  // Cubic bezier — handles offset horizontally by half the distance
  const dx = Math.abs(to.x - from.x) * 0.5
  const path = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`
  const color = STATUS_COLOR[status]
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClick?.()
  }
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu?.(e)
  }

  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  const hasTransform = transform && transform.kind !== 'identity'

  return (
    <g className={`canvas-wire ${selected ? 'selected' : ''}`} onClick={handleClick} onContextMenu={handleContextMenu}>
      <path d={path} fill="none" stroke={color} strokeWidth={selected ? 3 : 2} />
      {selected && message && (
        <foreignObject
          x={(from.x + to.x) / 2 - 100}
          y={(from.y + to.y) / 2 - 20}
          width={200}
          height={60}
        >
          <div className="canvas-wire-tooltip">{message}</div>
        </foreignObject>
      )}
      {hasTransform && !selected && (
        <foreignObject
          x={midX - 28}
          y={midY - 11}
          width={56}
          height={22}
          style={{ pointerEvents: 'none' }}
        >
          <div className="canvas-wire-transform-pill">
            {transform.kind}
          </div>
        </foreignObject>
      )}
      {/* invisible thicker hit target for easier clicking */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} />
      {/* Delete affordance — shown when the wire is selected */}
      {selected && onDelete && (
        <foreignObject
          x={midX - 10}
          y={midY - 10}
          width={20}
          height={20}
        >
          <button
            className="canvas-wire-delete"
            title="Delete wire"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            ×
          </button>
        </foreignObject>
      )}
    </g>
  )
}
