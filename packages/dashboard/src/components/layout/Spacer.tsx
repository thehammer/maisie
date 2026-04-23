import React from 'react'

interface SpacerProps {
  size?: number
  flex?: number
}

export function Spacer({ size, flex = 1 }: SpacerProps) {
  return (
    <div
      className="layout-spacer"
      style={{
        flexShrink: 0,
        width: size !== undefined ? `${size}px` : undefined,
        height: size !== undefined ? `${size}px` : undefined,
        flexGrow: size !== undefined ? 0 : flex,
      }}
    />
  )
}
