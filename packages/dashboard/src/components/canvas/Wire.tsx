import type { WireStatus } from '../../lib/canvas/wire-validator'

interface WireProps {
  from: { x: number; y: number }
  to: { x: number; y: number }
  status: WireStatus
  selected?: boolean
  onClick?: () => void
  message?: string
}

const STATUS_COLOR: Record<WireStatus, string> = {
  compatible: 'var(--status-ok, #4ade80)',
  ambiguous: 'var(--status-warn, #facc15)',
  incompatible: 'var(--status-err, #f87171)',
  unknown: 'var(--text-muted, #888)',
}

export function Wire({ from, to, status, selected, onClick, message }: WireProps) {
  // Cubic bezier — handles offset horizontally by half the distance
  const dx = Math.abs(to.x - from.x) * 0.5
  const path = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`
  const color = STATUS_COLOR[status]
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClick?.()
  }

  return (
    <g className={`canvas-wire ${selected ? 'selected' : ''}`} onClick={handleClick}>
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
      {/* invisible thicker hit target for easier clicking */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} />
    </g>
  )
}
