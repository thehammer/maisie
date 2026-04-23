/**
 * EntityPalette — left-side panel listing entities grouped by section.
 *
 * When `highlightTarget` is provided (a component or function input type),
 * each entity's output TypeExpr is evaluated against it and the item receives
 * a compatibility CSS class. Compatible items are sorted to the top within
 * each section group.
 */

import { useDraggable } from '@dnd-kit/core'
import { useApi } from '../../hooks/useApi'
import { classifyCompatibility, sortByCompatibility } from '../../lib/canvas/palette-sort'
import type { TypeExpr } from '@maisie/shared'

interface CatalogEntity {
  name: string
  kind?: string
  description?: string
  section?: string
  /** Output TypeExpr — injected by Canvas from the resolved ports cache. */
  outputType?: TypeExpr
}

interface EntityPaletteProps {
  /**
   * When set, evaluate each entity's output against this target type and
   * apply compatibility highlighting + sorting within each group.
   */
  highlightTarget?: TypeExpr
  /**
   * Resolved output types for catalog entities, keyed by entity name.
   * Populated by Canvas from the API + resolveEntityPorts cache.
   */
  entityOutputTypes?: Map<string, TypeExpr>
}

export function EntityPalette({ highlightTarget, entityOutputTypes }: EntityPaletteProps) {
  const entitiesApi = useApi<CatalogEntity[]>('/api/entities', 0)
  const entities = entitiesApi.data ?? []

  // Group by section
  const bySection = new Map<string, CatalogEntity[]>()
  for (const e of entities) {
    const key = e.section ?? 'other'
    if (!bySection.has(key)) bySection.set(key, [])
    bySection.get(key)!.push(e)
  }

  return (
    <aside className="canvas-palette canvas-palette-entities">
      <div className="canvas-palette-header">
        <span className="canvas-palette-title">Entities</span>
      </div>
      {[...bySection.entries()].map(([section, items]) => {
        // Annotate with compatibility status
        const annotated = items.map((e) => ({
          ...e,
          compatibilityStatus: classifyCompatibility(
            entityOutputTypes?.get(e.name),
            highlightTarget,
          ),
        }))
        // Sort compatible first; preserve order within tier
        const sorted = highlightTarget ? sortByCompatibility(annotated) : annotated

        return (
          <div key={section} className="canvas-palette-section">
            <div className="canvas-palette-group">
              <div className="canvas-palette-group-title">{section}</div>
              {sorted.map((e) => (
                <EntityPaletteItem
                  key={e.name}
                  entity={e}
                  compatibilityStatus={highlightTarget ? e.compatibilityStatus : undefined}
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

interface EntityPaletteItemProps {
  entity: CatalogEntity
  compatibilityStatus?: 'compatible' | 'chain' | 'incompatible' | 'unknown'
}

function EntityPaletteItem({ entity, compatibilityStatus }: EntityPaletteItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `entity:${entity.name}`,
    data: { kind: 'entity', targetName: entity.name, source: 'palette' },
  })

  const compatClass = compatibilityStatus
    ? `canvas-palette-item-compat-${compatibilityStatus}`
    : ''

  return (
    <div
      ref={setNodeRef}
      className={`canvas-palette-item canvas-palette-item-entity ${compatClass} ${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      <div className="canvas-palette-item-label">{entity.name}</div>
      {entity.description && (
        <div className="canvas-palette-item-sub">{entity.description}</div>
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
