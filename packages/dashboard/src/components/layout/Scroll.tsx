import React from 'react'

interface ScrollProps {
  children?: React.ReactNode
  direction?: 'horizontal' | 'vertical'
  gap?: number
  padding?: number
}

export function Scroll({ children, direction = 'vertical', gap = 8, padding = 0 }: ScrollProps) {
  const isHorizontal = direction === 'horizontal'
  return (
    <div
      className="layout-scroll"
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        gap: `${gap}px`,
        padding: `${padding}px`,
        overflowX: isHorizontal ? 'auto' : 'hidden',
        overflowY: isHorizontal ? 'hidden' : 'auto',
      }}
    >
      {children}
    </div>
  )
}
