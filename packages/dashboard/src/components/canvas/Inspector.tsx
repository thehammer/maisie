import { useApi } from '../../hooks/useApi'
import type { Placement, Wire } from '../../lib/canvas/document'
import type { LinkExpr } from '../../lib/canvas/link-expr'
import { validateWire, type WireStatus } from '../../lib/canvas/wire-validator'
import type { PlacementPorts } from '../../lib/canvas/type-resolver'
import { TransformEditor } from './TransformEditor'

interface InspectorProps {
  placement: Placement | null
  wire: Wire | null
  placements: Placement[]
  placementPorts: Map<string, PlacementPorts>
  onDeletePlacement: () => void
  onDeleteWire: () => void
  onSetWireTransform: (transform: LinkExpr | undefined) => void
}

export function Inspector({
  placement,
  wire,
  placements,
  placementPorts,
  onDeletePlacement,
  onDeleteWire,
  onSetWireTransform,
}: InspectorProps) {
  if (!placement && !wire) {
    return (
      <aside className="canvas-inspector">
        <div className="canvas-inspector-empty">Select an item to inspect</div>
      </aside>
    )
  }

  if (wire) {
    return (
      <WireInspector
        wire={wire}
        placements={placements}
        placementPorts={placementPorts}
        onDelete={onDeleteWire}
        onSetTransform={onSetWireTransform}
      />
    )
  }

  if (!placement) return null

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
        <button onClick={onDeletePlacement} className="edit-layout-btn cancel">Delete</button>
      </div>
    </aside>
  )
}

interface WireInspectorProps {
  wire: Wire
  placements: Placement[]
  placementPorts: Map<string, PlacementPorts>
  onDelete: () => void
  onSetTransform: (transform: LinkExpr | undefined) => void
}

function WireInspector({ wire, placements, placementPorts, onDelete, onSetTransform }: WireInspectorProps) {
  const sourcePlacement = placements.find((p) => p.id === wire.source.placementId)
  const targetPlacement = placements.find((p) => p.id === wire.target.placementId)
  const srcPorts = placementPorts.get(wire.source.placementId)
  const tgtPorts = placementPorts.get(wire.target.placementId)
  const validation = validateWire(srcPorts?.output, tgtPorts?.input)

  // Extract source field names for the transform editor
  const sourceFields = srcPorts?.output?.kind === 'record'
    ? Object.keys(srcPorts.output.fields)
    : srcPorts?.output?.kind === 'collection' && srcPorts.output.element.kind === 'record'
      ? Object.keys(srcPorts.output.element.fields)
      : undefined

  return (
    <aside className="canvas-inspector">
      <div className="canvas-inspector-header">
        <div className="canvas-inspector-kind">wire</div>
        <div className="canvas-inspector-name">Connection</div>
      </div>
      <div className="canvas-inspector-body">
        <div className="canvas-inspector-section-title">Source</div>
        <div className="canvas-inspector-field">
          <span className="canvas-inspector-field-name">
            {sourcePlacement?.targetName ?? wire.source.placementId}
          </span>
          {wire.source.field && (
            <span className="canvas-inspector-field-type">.{wire.source.field}</span>
          )}
        </div>

        <div className="canvas-inspector-section-title">Target</div>
        <div className="canvas-inspector-field">
          <span className="canvas-inspector-field-name">
            {targetPlacement?.targetName ?? wire.target.placementId}
          </span>
          {wire.target.slot && (
            <span className="canvas-inspector-field-type">.{wire.target.slot}</span>
          )}
        </div>

        <div className="canvas-inspector-section-title">Validation</div>
        <div className={`canvas-inspector-wire-status canvas-inspector-wire-status-${validation.status}`}>
          {validation.status.toUpperCase()}
        </div>
        {validation.message && (
          <div className="canvas-inspector-error">{validation.message}</div>
        )}

        <div className="canvas-inspector-section-title">Transform</div>
        <TransformEditor
          value={wire.transform}
          onChange={onSetTransform}
          sourceFields={sourceFields}
        />
      </div>
      <div className="canvas-inspector-actions">
        <button onClick={onDelete} className="edit-layout-btn cancel">Delete Wire</button>
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
