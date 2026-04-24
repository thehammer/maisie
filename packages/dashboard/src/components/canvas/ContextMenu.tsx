import { useEffect, useRef } from 'react'

export interface MenuItem {
  id: string
  label: string
  disabled?: boolean
  danger?: boolean     // visual hint (red text) for destructive actions
  onSelect: () => void
}

export interface ContextMenuProps {
  position: { x: number; y: number }  // client-space coordinates
  items: MenuItem[]
  onDismiss: () => void
}

export function ContextMenu({ position, items, onDismiss }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Dismiss on outside click or Escape
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onDismiss()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onDismiss])

  return (
    <div
      ref={ref}
      className="canvas-context-menu"
      style={{ position: 'fixed', left: position.x, top: position.y, zIndex: 1000 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          className={`canvas-context-menu-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`}
          disabled={item.disabled}
          onClick={(e) => {
            e.stopPropagation()
            if (!item.disabled) {
              item.onSelect()
              onDismiss()
            }
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
