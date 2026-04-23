import React from 'react'

export type OverlayPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'center'
  | 'fill'

const positionStyles: Record<OverlayPosition, React.CSSProperties> = {
  fill:         { top: 0, right: 0, bottom: 0, left: 0 },
  'top-left':   { top: 0, left: 0 },
  'top-right':  { top: 0, right: 0 },
  'bottom-left':  { bottom: 0, left: 0 },
  'bottom-right': { bottom: 0, right: 0 },
  top:    { top: 0, left: 0, right: 0 },
  bottom: { bottom: 0, left: 0, right: 0 },
  left:   { top: 0, bottom: 0, left: 0 },
  right:  { top: 0, bottom: 0, right: 0 },
  center: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
}

interface OverlayItemProps {
  children?: React.ReactNode
  position?: OverlayPosition
}

function OverlayItem({ children, position = 'fill' }: OverlayItemProps) {
  return (
    <div
      style={{
        position: 'absolute',
        ...positionStyles[position],
      }}
    >
      {children}
    </div>
  )
}

interface OverlayProps {
  children?: React.ReactNode
}

export function Overlay({ children }: OverlayProps) {
  return (
    <div
      className="layout-overlay"
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      {children}
    </div>
  )
}

Overlay.Item = OverlayItem
