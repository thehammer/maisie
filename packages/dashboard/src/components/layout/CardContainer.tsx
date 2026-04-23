import React from 'react'

interface CardContainerProps {
  children?: React.ReactNode
  title?: string
  padding?: number
}

export function CardContainer({ children, title, padding = 12 }: CardContainerProps) {
  return (
    <div
      className="layout-card"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: `${padding}px`,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {title && (
        <div
          style={{
            fontSize: '0.8rem',
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: `${padding / 2}px`,
          }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  )
}
