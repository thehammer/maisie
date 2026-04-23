import React from 'react'

interface GridProps {
  children?: React.ReactNode
  columns?: number | string
  rows?: number | string
  gap?: number
  padding?: number
}

function toTemplateValue(val: number | string | undefined, dimension: 'columns' | 'rows'): string | undefined {
  if (val === undefined) return undefined
  if (typeof val === 'string') return val
  const unit = dimension === 'columns' ? 'column' : 'row'
  void unit
  return `repeat(${val}, 1fr)`
}

export function Grid({ children, columns, rows, gap = 8, padding = 0 }: GridProps) {
  return (
    <div
      className="layout-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: toTemplateValue(columns, 'columns'),
        gridTemplateRows: toTemplateValue(rows, 'rows'),
        gap: `${gap}px`,
        padding: `${padding}px`,
      }}
    >
      {children}
    </div>
  )
}
