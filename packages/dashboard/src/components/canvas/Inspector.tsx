import { useApi } from '../../hooks/useApi'
import type { Placement } from '../../lib/canvas/document'

interface InspectorProps {
  placement: Placement | null
  onDelete: () => void
}

export function Inspector({ placement, onDelete }: InspectorProps) {
  if (!placement) {
    return (
      <aside className="canvas-inspector">
        <div className="canvas-inspector-empty">Select an item to inspect</div>
      </aside>
    )
  }

  return (
    <aside className="canvas-inspector">
      <div className="canvas-inspector-header">
        <div className="canvas-inspector-kind">{placement.kind}</div>
        <div className="canvas-inspector-name">{placement.targetName}</div>
      </div>
      {placement.kind === 'entity' ? (
        <EntityInspector name={placement.targetName} />
      ) : (
        <ComponentInspector name={placement.targetName} />
      )}
      <div className="canvas-inspector-actions">
        <button onClick={onDelete} className="edit-layout-btn cancel">Delete</button>
      </div>
    </aside>
  )
}

function EntityInspector({ name }: { name: string }) {
  const { data, loading, error } = useApi<{ fields?: Record<string, { kind: string; type?: string; returnType?: string }> }>(`/api/entities/${encodeURIComponent(name)}`, 0)
  if (loading) return <div className="canvas-inspector-loading">Loading...</div>
  if (error) return <div className="canvas-inspector-error">{String(error)}</div>
  if (!data) return null
  const fields = data.fields ?? {}
  return (
    <div className="canvas-inspector-body">
      <div className="canvas-inspector-section-title">Fields</div>
      {Object.entries(fields).map(([fname, field]) => (
        <div key={fname} className="canvas-inspector-field">
          <span className="canvas-inspector-field-name">{fname}</span>
          <span className="canvas-inspector-field-type">
            {field.kind === 'function' ? `function -> ${field.returnType ?? '?'}` : field.type ?? '?'}
          </span>
        </div>
      ))}
    </div>
  )
}

function ComponentInspector({ name }: { name: string }) {
  const { data, loading, error } = useApi<{ kind?: string; description?: string; input?: unknown; props?: Record<string, unknown> }>(`/api/components/${encodeURIComponent(name)}`, 0)
  if (loading) return <div className="canvas-inspector-loading">Loading...</div>
  if (error) return <div className="canvas-inspector-error">{String(error)}</div>
  if (!data) return null
  return (
    <div className="canvas-inspector-body">
      {data.description && <div className="canvas-inspector-description">{data.description}</div>}
      <div className="canvas-inspector-section-title">Kind</div>
      <div className="canvas-inspector-field">{data.kind}</div>
      {data.input !== undefined && (
        <>
          <div className="canvas-inspector-section-title">Input</div>
          <pre className="canvas-inspector-code">{JSON.stringify(data.input, null, 2)}</pre>
        </>
      )}
      {data.props && Object.keys(data.props).length > 0 && (
        <>
          <div className="canvas-inspector-section-title">Props</div>
          {Object.entries(data.props).map(([propName, propInfo]) => (
            <div key={propName} className="canvas-inspector-field">
              <span className="canvas-inspector-field-name">{propName}</span>
              <span className="canvas-inspector-field-type">{JSON.stringify((propInfo as { type?: unknown }).type ?? 'unknown')}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
