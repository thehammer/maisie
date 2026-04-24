/**
 * ComponentPalette — right-side panel listing components grouped by kind.
 *
 * When `highlightTarget` is provided (an entity output type or function output),
 * each component's input TypeExpr is evaluated against it and the item receives
 * a compatibility CSS class. Compatible items are sorted to the top within each
 * kind group.
 */

import { useDraggable } from '@dnd-kit/core'
import { useApi } from '../../hooks/useApi'
import { classifyCompatibility, sortByCompatibility } from '../../lib/canvas/palette-sort'
import type { TypeExpr } from '@maisie/shared'

interface CatalogComponent {
  name: string
  kind: 'base' | 'layout' | 'derived'
  description?: string
}

interface ComponentPaletteProps {
  /**
   * When set, evaluate each component's input against this target type and
   * apply compatibility highlighting + sorting within each kind group.
   */
  highlightTarget?: TypeExpr
  /**
   * Resolved input types for catalog components, keyed by component name.
   * Populated by Canvas from the API + resolveComponentPorts cache.
   */
  componentInputTypes?: Map<string, TypeExpr>
  /**
   * Called when an item is right-clicked. Receives kind, name, and client-space position.
   */
  onItemContextMenu?: (kind: 'component', name: string, position: { x: number; y: number }) => void
}

export function ComponentPalette({ highlightTarget, componentInputTypes, onItemContextMenu }: ComponentPaletteProps) {
  const componentsApi = useApi<CatalogComponent[]>('/api/components', 0)
  const components = componentsApi.data ?? []

  const byKind = {
    derived: components.filter((c) => c.kind === 'derived'),
    layout: components.filter((c) => c.kind === 'layout'),
    base: components.filter((c) => c.kind === 'base'),
  }

  return (
    <aside className="canvas-palette canvas-palette-components">
      <div className="canvas-palette-header">
        <span className="canvas-palette-title">Components</span>
      </div>
      {(['derived', 'layout', 'base'] as const).map((kind) => {
        const items = byKind[kind]
        if (items.length === 0) return null

        const annotated = items.map((c) => ({
          ...c,
          compatibilityStatus: classifyCompatibility(
            highlightTarget,
            componentInputTypes?.get(c.name),
          ),
        }))
        const sorted = highlightTarget ? sortByCompatibility(annotated) : annotated

        return (
          <div key={kind} className="canvas-palette-section">
            <div className="canvas-palette-group">
              <div className="canvas-palette-group-title">{kind}</div>
              {sorted.map((c) => (
                <ComponentPaletteItem
                  key={c.name}
                  component={c}
                  compatibilityStatus={highlightTarget ? c.compatibilityStatus : undefined}
                  onContextMenu={onItemContextMenu ? (pos) => onItemContextMenu('component', c.name, pos) : undefined}
                />
              ))}
            </div>
          </div>
        )
      })}
    </aside>
  )
}

// ── Item ──────────────────────────────────────────────────────────────────────

interface ComponentPaletteItemProps {
  component: CatalogComponent
  compatibilityStatus?: 'compatible' | 'chain' | 'incompatible' | 'unknown'
  onContextMenu?: (position: { x: number; y: number }) => void
}

function ComponentPaletteItem({ component, compatibilityStatus, onContextMenu }: ComponentPaletteItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `component:${component.name}`,
    data: { kind: 'component', targetName: component.name, source: 'palette' },
  })

  const compatClass = compatibilityStatus
    ? `canvas-palette-item-compat-${compatibilityStatus}`
    : ''

  return (
    <div
      ref={setNodeRef}
      className={`canvas-palette-item canvas-palette-item-component ${compatClass} ${isDragging ? 'dragging' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu?.({ x: e.clientX, y: e.clientY })
      }}
      {...attributes}
      {...listeners}
    >
      <div className="canvas-palette-item-label">{component.name}</div>
      {component.description && (
        <div className="canvas-palette-item-sub">{component.description}</div>
      )}
      {compatibilityStatus && (
        <CompatBadge status={compatibilityStatus} />
      )}
    </div>
  )
}

// ── Compatibility badge ────────────────────────────────────────────────────────

function CompatBadge({ status }: { status: 'compatible' | 'chain' | 'incompatible' | 'unknown' }) {
  const labels: Record<typeof status, string> = {
    compatible: 'direct',
    chain: 'via fn',
    incompatible: 'no match',
    unknown: '?',
  }
  return (
    <span className={`canvas-compat-badge canvas-compat-badge-${status}`}>
      {labels[status]}
    </span>
  )
}
