import { useDraggable } from '@dnd-kit/core'
import { useApi } from '../../hooks/useApi'

interface CatalogEntity { name: string; kind?: string; description?: string; section?: string }
interface CatalogComponent { name: string; kind: 'base' | 'layout' | 'derived'; description?: string }

export function Palette() {
  const entitiesApi = useApi<CatalogEntity[]>('/api/entities', 0)
  const componentsApi = useApi<CatalogComponent[]>('/api/components', 0)

  const entities = entitiesApi.data ?? []
  const components = componentsApi.data ?? []

  // Group entities by section
  const entitiesBySection = new Map<string, CatalogEntity[]>()
  for (const e of entities) {
    const key = e.section ?? 'other'
    if (!entitiesBySection.has(key)) entitiesBySection.set(key, [])
    entitiesBySection.get(key)!.push(e)
  }

  // Group components by kind
  const componentsByKind = {
    base: components.filter(c => c.kind === 'base'),
    layout: components.filter(c => c.kind === 'layout'),
    derived: components.filter(c => c.kind === 'derived'),
  }

  return (
    <aside className="canvas-palette">
      <div className="canvas-palette-section">
        <div className="canvas-palette-title">Entities</div>
        {[...entitiesBySection.entries()].map(([section, items]) => (
          <div key={section} className="canvas-palette-group">
            <div className="canvas-palette-group-title">{section}</div>
            {items.map((e) => (
              <PaletteItem
                key={e.name}
                id={`entity:${e.name}`}
                kind="entity"
                targetName={e.name}
                label={e.name}
                sublabel={e.description}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="canvas-palette-section">
        <div className="canvas-palette-title">Components</div>
        {(['derived', 'layout', 'base'] as const).map((kind) => (
          componentsByKind[kind].length > 0 && (
            <div key={kind} className="canvas-palette-group">
              <div className="canvas-palette-group-title">{kind}</div>
              {componentsByKind[kind].map((c) => (
                <PaletteItem
                  key={c.name}
                  id={`component:${c.name}`}
                  kind="component"
                  targetName={c.name}
                  label={c.name}
                  sublabel={c.description}
                />
              ))}
            </div>
          )
        ))}
      </div>
    </aside>
  )
}

interface PaletteItemProps {
  id: string
  kind: 'entity' | 'component'
  targetName: string
  label: string
  sublabel?: string
}

function PaletteItem({ id, kind, targetName, label, sublabel }: PaletteItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { kind, targetName, source: 'palette' },
  })
  return (
    <div
      ref={setNodeRef}
      className={`canvas-palette-item canvas-palette-item-${kind} ${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      <div className="canvas-palette-item-label">{label}</div>
      {sublabel && <div className="canvas-palette-item-sub">{sublabel}</div>}
    </div>
  )
}
