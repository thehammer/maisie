import React from 'react'

const cssAlignMap: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
}

interface StackProps {
  children?: React.ReactNode
  gap?: number
  padding?: number
  align?: 'start' | 'center' | 'end' | 'stretch'
  fit?: 'fill' | 'content'
}

export function Stack({ children, gap = 8, padding = 0, align = 'stretch', fit = 'content' }: StackProps) {
  return (
    <div
      className="layout-stack"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: `${gap}px`,
        padding: `${padding}px`,
        alignItems: cssAlignMap[align],
        width: fit === 'fill' ? '100%' : undefined,
        height: fit === 'fill' ? '100%' : undefined,
      }}
    >
      {children}
    </div>
  )
}
