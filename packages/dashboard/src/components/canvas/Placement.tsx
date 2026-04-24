import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { TypeExpr, FunctionParamDecl } from '@maisie/shared'
import { formatType } from '@maisie/shared'
import type { Placement as PlacementType } from '../../lib/canvas/document'

interface PlacementProps {
  placement: PlacementType
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  /** Called with client-space position when the placement is right-clicked. */
  onContextMenu?: (e: React.MouseEvent) => void
  /** Ref callback for the output port element (entities and functions). */
  outputPortRef?: (el: HTMLElement | null) => void
  /** Ref callback for the input port element (components and functions). */
  inputPortRef?: (el: HTMLElement | null) => void
  /**
   * The inferred or declared output TypeExpr for this placement.
   * Provided by Canvas after resolving ports + wires + inline params.
   */
  outputType?: TypeExpr
  /**
   * The declared input TypeExpr for component placements.
   * Shows what shape the component expects.
   */
  inputType?: TypeExpr
  /**
   * True when this function placement's input port is wired.
   * If false, schema panel shows a "wire an input" prompt instead.
   */
  isWired?: boolean
  /**
   * Inline parameter declarations for function placements.
   * Each renders as an editable input on the node so users can configure
   * parameters without opening the inspector.
   */
  inlineParams?: FunctionParamDecl[]
  /**
   * Update a single parameter's value in placement.config.
   */
  onUpdateParam?: (paramName: string, value: unknown) => void
}

export function Placement({ placement, selected, onSelect, onDelete, onContextMenu, outputPortRef, inputPortRef, outputType, inputType, isWired, inlineParams, onUpdateParam }: PlacementProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: placement.id,
    data: { source: 'canvas', placementId: placement.id },
  })

  const style: React.CSSProperties = {
    position: 'absolute',
    left: placement.position.x,
    top: placement.position.y,
    transform: CSS.Translate.toString(transform),
    cursor: 'move',
  }

  // Derive a short display label: for function placements, strip the 'std.' prefix
  const displayName = placement.kind === 'function'
    ? placement.targetName.replace(/^std\./, '')
    : placement.targetName

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`canvas-placement canvas-placement-${placement.kind} ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(e)
      }}
      {...attributes}
      {...listeners}
    >
      {/* Input port — components and functions consume input on the left */}
      {(placement.kind === 'component' || placement.kind === 'function') && (
        <InputPort placementId={placement.id} portRef={inputPortRef} />
      )}
      <div className="canvas-placement-kind">{placement.kind}</div>
      <div className="canvas-placement-name">{displayName}</div>
      {/* Inline parameter editors — only for function placements with inline params */}
      {placement.kind === 'function' && inlineParams && inlineParams.length > 0 && onUpdateParam && (
        <ParamEditor params={inlineParams} config={placement.config ?? {}} onUpdate={onUpdateParam} />
      )}
      {/* Schema panel — shows the type shape one level deep */}
      {placement.kind === 'entity' && outputType && (
        <SchemaPanel type={outputType} />
      )}
      {placement.kind === 'function' && (
        isWired && outputType
          ? <SchemaPanel type={outputType} />
          : <div className="canvas-placement-schema">
              <span className="canvas-placement-schema-prompt">wire an input to see output shape</span>
            </div>
      )}
      {placement.kind === 'component' && inputType && (
        <SchemaPanel type={inputType} label="expects" />
      )}
      {/* Output port — entities and functions produce output on the right */}
      {(placement.kind === 'entity' || placement.kind === 'function') && (
        <OutputPort placementId={placement.id} portRef={outputPortRef} />
      )}
      {/* Delete affordance — small × shown on hover/selected, top-right.
          stopPropagation on pointerDown AND mouseDown so @dnd-kit's pointer
          sensor doesn't interpret the click as a drag-start. */}
      <button
        className="canvas-placement-delete"
        title="Delete placement"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        ×
      </button>
    </div>
  )
}

interface OutputPortProps {
  placementId: string
  portRef?: (el: HTMLElement | null) => void
}

function OutputPort({ placementId, portRef }: OutputPortProps) {
  const portId = `port:${placementId}:output`
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: portId,
    data: { source: 'port', placementId, role: 'output' },
  })

  const combinedRef = (el: HTMLDivElement | null) => {
    setNodeRef(el)
    portRef?.(el)
  }

  return (
    <div
      ref={combinedRef}
      className={`canvas-port canvas-port-output ${isDragging ? 'dragging' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      {...attributes}
      {...listeners}
    />
  )
}

interface InputPortProps {
  placementId: string
  portRef?: (el: HTMLElement | null) => void
}

function InputPort({ placementId, portRef }: InputPortProps) {
  const portId = `port:${placementId}:input`
  const { setNodeRef, isOver } = useDroppable({
    id: portId,
    data: { target: 'port', placementId, role: 'input' },
  })

  const combinedRef = (el: HTMLDivElement | null) => {
    setNodeRef(el)
    portRef?.(el)
  }

  return (
    <div
      ref={combinedRef}
      className={`canvas-port canvas-port-input ${isOver ? 'drop-target' : ''}`}
    />
  )
}

// ── SchemaPanel ──────────────────────────────────────────────────────────────

interface SchemaPanelProps {
  type: TypeExpr
  /** Optional prefix label (e.g. "expects") shown before type rows. */
  label?: string
}

/**
 * Renders a shallow (one-level-deep) type panel below the placement name.
 *
 * Scalars: a single row showing the type name.
 * Records: each field as "name: type" (nested composites shown as their kind word).
 * Collections: "collection<elementKind>" — no drilling into the element.
 * Any other TypeExpr: formatted inline via formatType().
 */
function SchemaPanel({ type, label }: SchemaPanelProps) {
  return (
    <div className="canvas-placement-schema">
      {label && <div className="canvas-placement-schema-label">{label}</div>}
      <SchemaPanelContent type={type} />
    </div>
  )
}

function SchemaPanelContent({ type }: { type: TypeExpr }) {
  if (type.kind === 'scalar') {
    return (
      <div className="canvas-placement-schema-field">
        <span className="canvas-placement-schema-type">{type.type}</span>
      </div>
    )
  }

  if (type.kind === 'record') {
    const entries = Object.entries(type.fields)
    if (entries.length === 0) {
      return (
        <div className="canvas-placement-schema-field">
          <span className="canvas-placement-schema-type">record</span>
        </div>
      )
    }
    return (
      <>
        {entries.map(([name, fieldType]) => (
          <div key={name} className="canvas-placement-schema-field">
            <span className="canvas-placement-schema-name">{name}</span>
            <span className="canvas-placement-schema-type">{shallowTypeName(fieldType)}</span>
          </div>
        ))}
      </>
    )
  }

  if (type.kind === 'collection') {
    return (
      <div className="canvas-placement-schema-field">
        <span className="canvas-placement-schema-type">
          collection&lt;{shallowTypeName(type.element)}&gt;
        </span>
      </div>
    )
  }

  // any, function, component, optional, union — format inline
  return (
    <div className="canvas-placement-schema-field">
      <span className="canvas-placement-schema-type">{formatType(type)}</span>
    </div>
  )
}

// ── ParamEditor ──────────────────────────────────────────────────────────────

interface ParamEditorProps {
  params: FunctionParamDecl[]
  config: Record<string, unknown>
  onUpdate: (paramName: string, value: unknown) => void
}

/**
 * Inline parameter inputs rendered directly on a function placement.
 * Lets the user set required parameters (like `field` for `get`/`pluck`)
 * without opening the inspector.
 *
 * Only renders the params marked `inline: true` in the descriptor.
 * Each input stops pointer/mouse propagation so @dnd-kit doesn't interpret
 * typing as drag-start.
 */
function ParamEditor({ params, config, onUpdate }: ParamEditorProps) {
  const inlineDecls = params.filter((p) => p.inline)
  if (inlineDecls.length === 0) return null

  return (
    <div className="canvas-placement-params">
      {inlineDecls.map((p) => {
        const current = (config[p.name] ?? p.default ?? '') as string | number
        const isNumber = p.type.kind === 'scalar' && p.type.type === 'number'
        const isFunction = p.type.kind === 'function'
        return (
          <div key={p.name} className="canvas-placement-param">
            <label className="canvas-placement-param-label">{p.name}</label>
            {isFunction ? (
              <textarea
                className="canvas-placement-param-input canvas-placement-param-lambda"
                value={String(current ?? '')}
                placeholder={p.description ?? '(item) => ...'}
                rows={2}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  // Cmd/Ctrl+Enter or Escape blurs the textarea (commits via onChange).
                  if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey)) || e.key === 'Escape') {
                    (e.currentTarget as HTMLTextAreaElement).blur()
                  }
                }}
                onChange={(e) => onUpdate(p.name, e.target.value)}
              />
            ) : (
              <input
                className="canvas-placement-param-input"
                type={isNumber ? 'number' : 'text'}
                value={String(current ?? '')}
                placeholder={p.description}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  // Enter or Escape blurs the input (commits via onChange).
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    (e.currentTarget as HTMLInputElement).blur()
                  }
                }}
                onChange={(e) => {
                  const value = isNumber ? Number(e.target.value) : e.target.value
                  onUpdate(p.name, value)
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * One-word description of a TypeExpr for use as a nested type label.
 * Does not recurse into collections or records.
 */
function shallowTypeName(type: TypeExpr): string {
  switch (type.kind) {
    case 'scalar': return type.type
    case 'record': return 'record'
    case 'collection': return `collection<${shallowTypeName(type.element)}>`
    case 'any': return 'any'
    case 'function': return 'function'
    case 'component': return 'component'
    case 'optional': return `${shallowTypeName(type.inner)}?`
    case 'union': return type.members.map(shallowTypeName).join(' | ')
  }
}
