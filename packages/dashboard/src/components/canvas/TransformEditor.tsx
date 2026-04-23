import type {
  LinkExpr,
  IdentityLink,
  PickLink,
  RenameLink,
  ComputeLink,
  ChainLink,
  LiteralValue,
} from '../../lib/canvas/link-expr'

interface TransformEditorProps {
  value: LinkExpr | undefined
  onChange: (next: LinkExpr | undefined) => void
  /** Source record field names for pick/rename autocomplete. */
  sourceFields?: string[]
}

export function TransformEditor({ value, onChange, sourceFields }: TransformEditorProps) {
  const kind = value?.kind ?? 'identity'

  const handleKindChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(defaultFor(e.target.value as LinkExpr['kind']))
  }

  return (
    <div className="canvas-transform-editor">
      <div className="canvas-transform-kind-picker">
        <label>Transform:</label>
        <select value={kind} onChange={handleKindChange}>
          <option value="identity">None (identity)</option>
          <option value="pick">Pick fields</option>
          <option value="rename">Rename fields</option>
          <option value="compute">Add / compute fields</option>
          <option value="chain">Chain</option>
        </select>
      </div>
      {value && value.kind !== 'identity' && (
        <div className="canvas-transform-body">
          {value.kind === 'pick' && (
            <PickEditor value={value} onChange={onChange} sourceFields={sourceFields} />
          )}
          {value.kind === 'rename' && (
            <RenameEditor value={value} onChange={onChange} sourceFields={sourceFields} />
          )}
          {value.kind === 'compute' && (
            <ComputeEditor value={value} onChange={onChange} />
          )}
          {value.kind === 'chain' && (
            <ChainEditor value={value} onChange={onChange} sourceFields={sourceFields} />
          )}
        </div>
      )}
    </div>
  )
}

function defaultFor(kind: LinkExpr['kind']): LinkExpr | undefined {
  switch (kind) {
    case 'identity': return undefined
    case 'pick':     return { kind: 'pick', fields: [] }
    case 'rename':   return { kind: 'rename', mappings: [], keepRest: false }
    case 'compute':  return { kind: 'compute', assignments: [], keepRest: true }
    case 'chain':    return { kind: 'chain', links: [] }
  }
}

// ── PickEditor ────────────────────────────────────────────────────────────────

interface PickEditorProps {
  value: PickLink
  onChange: (next: LinkExpr) => void
  sourceFields?: string[]
}

function PickEditor({ value, onChange, sourceFields }: PickEditorProps) {
  const toggleField = (field: string) => {
    const next = value.fields.includes(field)
      ? value.fields.filter((f) => f !== field)
      : [...value.fields, field]
    onChange({ ...value, fields: next })
  }

  const addCustomField = () => {
    const field = prompt('Field name:')
    if (field && field.trim()) {
      onChange({ ...value, fields: [...value.fields, field.trim()] })
    }
  }

  const removeField = (field: string) => {
    onChange({ ...value, fields: value.fields.filter((f) => f !== field) })
  }

  return (
    <div className="canvas-transform-pick">
      {sourceFields && sourceFields.length > 0 && (
        <div className="canvas-transform-field-list">
          <div className="canvas-transform-label">Available fields:</div>
          {sourceFields.map((f) => (
            <label key={f} className="canvas-transform-checkbox">
              <input
                type="checkbox"
                checked={value.fields.includes(f)}
                onChange={() => toggleField(f)}
              />
              {f}
            </label>
          ))}
        </div>
      )}
      {value.fields.length > 0 && (
        <div className="canvas-transform-selected-fields">
          <div className="canvas-transform-label">Picked:</div>
          {value.fields.map((f) => (
            <div key={f} className="canvas-transform-tag">
              {f}
              <button onClick={() => removeField(f)} className="canvas-transform-tag-remove">×</button>
            </div>
          ))}
        </div>
      )}
      <button onClick={addCustomField} className="canvas-transform-add-btn">+ Field</button>
    </div>
  )
}

// ── RenameEditor ──────────────────────────────────────────────────────────────

interface RenameEditorProps {
  value: RenameLink
  onChange: (next: LinkExpr) => void
  sourceFields?: string[]
}

function RenameEditor({ value, onChange, sourceFields }: RenameEditorProps) {
  const addMapping = () => {
    onChange({
      ...value,
      mappings: [...value.mappings, { from: '', to: '' }],
    })
  }

  const removeMapping = (idx: number) => {
    onChange({
      ...value,
      mappings: value.mappings.filter((_, i) => i !== idx),
    })
  }

  const updateMapping = (idx: number, field: 'from' | 'to', val: string) => {
    const next = value.mappings.map((m, i) =>
      i === idx ? { ...m, [field]: val } : m,
    )
    onChange({ ...value, mappings: next })
  }

  return (
    <div className="canvas-transform-rename">
      <label className="canvas-transform-checkbox">
        <input
          type="checkbox"
          checked={!!value.keepRest}
          onChange={(e) => onChange({ ...value, keepRest: e.target.checked })}
        />
        Keep unmentioned fields
      </label>
      <div className="canvas-transform-mappings">
        {value.mappings.map((m, i) => (
          <div key={i} className="canvas-transform-mapping-row">
            {sourceFields && sourceFields.length > 0 ? (
              <select
                value={m.from}
                onChange={(e) => updateMapping(i, 'from', e.target.value)}
              >
                <option value="">— from —</option>
                {sourceFields.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                placeholder="from"
                value={m.from}
                onChange={(e) => updateMapping(i, 'from', e.target.value)}
              />
            )}
            <span className="canvas-transform-arrow">→</span>
            <input
              type="text"
              placeholder="to"
              value={m.to}
              onChange={(e) => updateMapping(i, 'to', e.target.value)}
            />
            <button onClick={() => removeMapping(i)} className="canvas-transform-remove-btn">×</button>
          </div>
        ))}
      </div>
      <button onClick={addMapping} className="canvas-transform-add-btn">+ Rename</button>
    </div>
  )
}

// ── ComputeEditor ─────────────────────────────────────────────────────────────

interface ComputeEditorProps {
  value: ComputeLink
  onChange: (next: LinkExpr) => void
}

function ComputeEditor({ value, onChange }: ComputeEditorProps) {
  const addAssignment = () => {
    onChange({
      ...value,
      assignments: [...value.assignments, { name: '', value: '' }],
    })
  }

  const removeAssignment = (idx: number) => {
    onChange({
      ...value,
      assignments: value.assignments.filter((_, i) => i !== idx),
    })
  }

  const updateName = (idx: number, name: string) => {
    const next = value.assignments.map((a, i) => i === idx ? { ...a, name } : a)
    onChange({ ...value, assignments: next })
  }

  const updateValue = (idx: number, val: LiteralValue) => {
    const next = value.assignments.map((a, i) => i === idx ? { ...a, value: val } : a)
    onChange({ ...value, assignments: next })
  }

  const updateType = (idx: number, type: string) => {
    const current = value.assignments[idx].value
    let coerced: LiteralValue
    switch (type) {
      case 'number':  coerced = typeof current === 'number' ? current : 0; break
      case 'boolean': coerced = typeof current === 'boolean' ? current : false; break
      case 'null':    coerced = null; break
      default:        coerced = current != null ? String(current) : ''; break
    }
    updateValue(idx, coerced)
  }

  const typeOf = (val: LiteralValue): string => {
    if (val === null) return 'null'
    return typeof val
  }

  return (
    <div className="canvas-transform-compute">
      <label className="canvas-transform-checkbox">
        <input
          type="checkbox"
          checked={value.keepRest ?? true}
          onChange={(e) => onChange({ ...value, keepRest: e.target.checked })}
        />
        Keep existing fields
      </label>
      <div className="canvas-transform-assignments">
        {value.assignments.map((a, i) => (
          <div key={i} className="canvas-transform-assignment-row">
            <input
              type="text"
              placeholder="field name"
              value={a.name}
              onChange={(e) => updateName(i, e.target.value)}
            />
            <span className="canvas-transform-equals">=</span>
            <select
              value={typeOf(a.value)}
              onChange={(e) => updateType(i, e.target.value)}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="null">null</option>
            </select>
            {typeOf(a.value) === 'string' && (
              <input
                type="text"
                value={String(a.value ?? '')}
                onChange={(e) => updateValue(i, e.target.value)}
              />
            )}
            {typeOf(a.value) === 'number' && (
              <input
                type="number"
                value={Number(a.value)}
                onChange={(e) => updateValue(i, Number(e.target.value))}
              />
            )}
            {typeOf(a.value) === 'boolean' && (
              <select
                value={String(a.value)}
                onChange={(e) => updateValue(i, e.target.value === 'true')}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            )}
            <button onClick={() => removeAssignment(i)} className="canvas-transform-remove-btn">×</button>
          </div>
        ))}
      </div>
      <button onClick={addAssignment} className="canvas-transform-add-btn">+ Assignment</button>
    </div>
  )
}

// ── ChainEditor ───────────────────────────────────────────────────────────────

interface ChainEditorProps {
  value: ChainLink
  onChange: (next: LinkExpr) => void
  sourceFields?: string[]
}

function ChainEditor({ value, onChange, sourceFields }: ChainEditorProps) {
  const addLink = () => {
    onChange({ ...value, links: [...value.links, { kind: 'identity' }] })
  }

  const removeLink = (idx: number) => {
    onChange({ ...value, links: value.links.filter((_, i) => i !== idx) })
  }

  const updateLink = (idx: number, next: LinkExpr | undefined) => {
    const updated = value.links.map((l, i) => i === idx ? (next ?? { kind: 'identity' } as LinkExpr) : l)
    onChange({ ...value, links: updated })
  }

  return (
    <div className="canvas-transform-chain">
      {value.links.map((link, i) => (
        <div key={i} className="canvas-transform-chain-step">
          <div className="canvas-transform-chain-step-header">
            <span className="canvas-transform-chain-step-num">Step {i + 1}</span>
            <button onClick={() => removeLink(i)} className="canvas-transform-remove-btn">×</button>
          </div>
          <TransformEditor
            value={link}
            onChange={(next) => updateLink(i, next)}
            sourceFields={sourceFields}
          />
        </div>
      ))}
      <button onClick={addLink} className="canvas-transform-add-btn">+ Step</button>
    </div>
  )
}
