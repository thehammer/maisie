/**
 * CardWizard — full-screen overlay wizard for building dashboard cards.
 *
 * Three steps:
 *   1. Source  — browse catalog, pick an action
 *   2. Transform — add filter/sort/limit ops (collections only)
 *   3. Display — choose display style + per-field renderers
 *
 * Right panel shows a live DynamicCard preview throughout.
 */

import { useState, useCallback, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { DynamicCard, type CardDescriptor } from "./DynamicCard";
import { COMPONENT_OPTIONS, getComponentOptions, getFunctionComponentOptions, type ComponentOption } from "../lib/component-options";
import type { CardRendererConfig, OpConfig } from "@maisie/shared";
import type { EntityDef, FunctionFieldDef } from "@maisie/shared";
import type { CardConfig } from "../hooks/useLayout";

// Section display names (shared with AddCardPanel)
const SECTION_LABELS: Record<string, string> = {
  system:       "System",
  ai:           "AI",
  personal:     "Personal",
  integrations: "Integrations",
  printer:      "Printer",
  smarthome:    "Smart Home",
  enrichment:   "Enrichment",
  library:      "Library",
  media:        "Media",
  nas:          "NAS",
  network:      "Network",
  protect:      "Cameras",
  dashboard:    "Dashboard",
};

const HIDDEN_SECTIONS = new Set(["dashboard"]);

// ── Wizard state ──────────────────────────────────────────────────────────────

interface WizardState {
  step: 1 | 2 | 3;
  descriptor: CardDescriptor | null;
  /** EntityDef for the selected descriptor — fetched lazily to discover function fields. */
  selectedEntity: EntityDef | null;
  ops: OpConfig[];
  displayStyle: 'table' | 'card-list' | 'simple-list' | undefined;
  visibleFields: string[];
  rendererConfigs: CardRendererConfig;
  /** Function fields selected in Step 3 to render as buttons. */
  functionFields: Array<{ name: string; label?: string }>;
  title: string;
}

const INITIAL_STATE: WizardState = {
  step: 1,
  descriptor: null,
  selectedEntity: null,
  ops: [],
  displayStyle: undefined,
  visibleFields: [],
  rendererConfigs: {},
  functionFields: [],
  title: "",
};

// ── Comparison operators for filter ──────────────────────────────────────────

const COMPARISON_OPS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'contains', label: 'contains' },
  { value: 'startsWith', label: 'starts with' },
] as const;

// ── Main component ────────────────────────────────────────────────────────────

interface CardWizardProps {
  open: boolean;
  onClose: () => void;
  onAdd: (card: CardConfig) => void;
}

export function CardWizard({ open, onClose, onAdd }: CardWizardProps) {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const catalogApi = useApi<CardDescriptor[]>(open ? "/api/cards/catalog" : null, 0);
  const catalog = catalogApi.data ?? [];

  // When a descriptor is selected, fetch its EntityDef to discover function fields.
  // The entity name matches the descriptor's id (e.g. "unifi.get_wan_health" or "exterior-lights").
  useEffect(() => {
    if (!state.descriptor) return;
    let cancelled = false;
    fetch(`/api/entities/${state.descriptor.id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((entity: EntityDef | null) => {
        if (!cancelled) setState((p) => ({ ...p, selectedEntity: entity }));
      })
      .catch(() => {
        if (!cancelled) setState((p) => ({ ...p, selectedEntity: null }));
      });
    return () => { cancelled = true; };
  }, [state.descriptor?.id]);

  const reset = useCallback(() => setState(INITIAL_STATE), []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleAdd = useCallback(() => {
    if (!state.descriptor) return;
    const card: CardConfig = {
      id: state.descriptor.id,
      visible: true,
      col_span: 1,
      order: 0,
      title: state.title || undefined,
      ops: state.ops.length ? state.ops : undefined,
      displayStyle: state.displayStyle,
      visibleFields: state.visibleFields.length ? state.visibleFields : undefined,
      rendererConfigs: Object.keys(state.rendererConfigs).length ? state.rendererConfigs : undefined,
      functionFields: state.functionFields.length ? state.functionFields : undefined,
    };
    onAdd(card);
    handleClose();
  }, [state, onAdd, handleClose]);

  if (!open) return null;

  // Group catalog by section
  const sections = new Map<string, CardDescriptor[]>();
  for (const w of catalog) {
    if (HIDDEN_SECTIONS.has(w.section)) continue;
    const group = sections.get(w.section) ?? [];
    group.push(w);
    sections.set(w.section, group);
  }

  const isCollection = state.descriptor?.schemaType === "collection";
  const totalSteps = isCollection ? 3 : 3;
  // Derived entities have pluginName === undefined. Their pipeline is baked into the
  // entity expression, so Step 2 (Transform) is irrelevant and should be skipped.
  const isDerived = state.descriptor?.pluginName === undefined;

  function goToStep(s: 1 | 2 | 3) {
    setState((prev) => ({ ...prev, step: s }));
  }

  return (
    <div className="wizard-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="wizard-container">
        {/* ── Left panel ─────────────────────────────────────── */}
        <div className="wizard-left">
          {/* Header */}
          <div className="wizard-header">
            <span className="wizard-title">Build a Card</span>
            <button className="wizard-close-btn" onClick={handleClose} title="Close">✕</button>
          </div>

          {/* Step indicators */}
          <div className="wizard-steps">
            {[
              { n: 1 as const, label: "Source" },
              { n: 2 as const, label: "Transform" },
              { n: 3 as const, label: "Display" },
            ].map(({ n, label }) => {
              const isActive = state.step === n;
              const isComplete = state.step > n;
              const isAccessible = n === 1 || (n === 2 && state.descriptor !== null) || (n === 3 && state.descriptor !== null);
              return (
                <button
                  key={n}
                  className={`wizard-step-btn ${isActive ? "active" : ""} ${isComplete ? "complete" : ""}`}
                  onClick={() => isAccessible && goToStep(n)}
                  disabled={!isAccessible}
                >
                  <span className="wizard-step-circle">{isComplete ? "✓" : n}</span>
                  <span className="wizard-step-label">{label}</span>
                </button>
              );
            })}
          </div>

          {/* Step content */}
          <div className="wizard-step-content">
            {state.step === 1 && (
              <Step1Source
                sections={sections}
                selected={state.descriptor}
                selectedEntity={state.selectedEntity}
                isDerived={isDerived}
                onSelect={(d) => setState((p) => ({ ...p, descriptor: d, selectedEntity: null, ops: [], displayStyle: undefined, visibleFields: [], rendererConfigs: {}, functionFields: [] }))}
                onNext={() => goToStep(isDerived ? 3 : 2)}
              />
            )}
            {state.step === 2 && state.descriptor && (
              <Step2Transform
                descriptor={state.descriptor}
                ops={state.ops}
                onChange={(ops) => setState((p) => ({ ...p, ops }))}
                onBack={() => goToStep(1)}
                onNext={() => goToStep(3)}
              />
            )}
            {state.step === 3 && state.descriptor && (
              <Step3Display
                descriptor={state.descriptor}
                selectedEntity={state.selectedEntity}
                displayStyle={state.displayStyle}
                visibleFields={state.visibleFields}
                rendererConfigs={state.rendererConfigs}
                functionFields={state.functionFields}
                title={state.title}
                onDisplayStyleChange={(s) => setState((p) => ({ ...p, displayStyle: s }))}
                onVisibleFieldsChange={(vf) => setState((p) => ({ ...p, visibleFields: vf }))}
                onRendererConfigChange={(rc) => setState((p) => ({ ...p, rendererConfigs: rc }))}
                onFunctionFieldsChange={(ff) => setState((p) => ({ ...p, functionFields: ff }))}
                onTitleChange={(t) => setState((p) => ({ ...p, title: t }))}
                onBack={() => goToStep(isDerived ? 1 : 2)}
                onAdd={handleAdd}
              />
            )}
          </div>
        </div>

        {/* ── Right panel (live preview) ──────────────────────── */}
        <div className="wizard-right">
          <div className="wizard-preview-label">Preview</div>
          {state.descriptor ? (
            <div className="wizard-preview-card">
              <DynamicCard
                descriptor={state.descriptor}
                ops={state.ops}
                displayStyle={state.displayStyle}
                visibleFields={state.visibleFields.length ? state.visibleFields : undefined}
                rendererConfigs={state.rendererConfigs}
                titleOverride={state.title || undefined}
                pollInterval={30000}
              />
            </div>
          ) : (
            <div className="wizard-preview-empty">
              Select a card in Step 1 to see a preview
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Source ────────────────────────────────────────────────────────────

interface Step1Props {
  sections: Map<string, CardDescriptor[]>;
  selected: CardDescriptor | null;
  selectedEntity: EntityDef | null;
  /** True when the selected descriptor is a derived entity (no pluginName). Step 2 will be skipped. */
  isDerived: boolean;
  onSelect: (d: CardDescriptor) => void;
  onNext: () => void;
}

function Step1Source({ sections, selected, selectedEntity, isDerived, onSelect, onNext }: Step1Props) {
  // Collect function fields from the fetched EntityDef
  const functionFields = selectedEntity
    ? Object.entries(selectedEntity.fields)
        .filter(([, f]) => f.kind === 'function')
        .map(([name, f]) => ({ name, field: f as FunctionFieldDef }))
    : [];

  return (
    <div className="wizard-step-panel">
      <div className="wizard-step-heading">Choose a data source</div>
      <div className="wizard-catalog">
        {sections.size === 0 && (
          <div className="wizard-empty-catalog">Loading catalog…</div>
        )}
        {[...sections.entries()].map(([section, widgets]) => (
          <div key={section} className="wizard-catalog-section">
            <div className="wizard-catalog-section-title">
              {SECTION_LABELS[section] ?? section}
            </div>
            {widgets.map((w) => (
              <button
                key={w.id}
                className={`wizard-catalog-item ${selected?.id === w.id ? "selected" : ""}`}
                onClick={() => onSelect(w)}
              >
                <span className="wizard-catalog-item-name">{w.label}</span>
                <span className="wizard-catalog-item-meta">
                  {w.schemaType ?? "record"} · {w.outputFields.length} fields
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {selected && (
        <div className="wizard-selected-info">
          <div className="wizard-selected-id">{selected.id}</div>
          <div className="wizard-selected-fields">
            {selected.outputFields.slice(0, 6).map((f) => (
              <span key={f.key} className="wizard-field-chip">
                {f.label}
                {f.maisieType && <span className="wizard-field-type">{f.maisieType}</span>}
              </span>
            ))}
            {selected.outputFields.length > 6 && (
              <span className="wizard-field-chip wizard-field-chip-more">
                +{selected.outputFields.length - 6} more
              </span>
            )}
          </div>
          {functionFields.length > 0 && (
            <div className="wizard-selected-functions">
              <div className="wizard-field-label" style={{ marginTop: '0.5rem', marginBottom: '0.25rem' }}>
                Function fields
              </div>
              <div className="wizard-selected-fields">
                {functionFields.map(({ name, field }) => (
                  <span key={name} className="wizard-field-chip wizard-field-chip-function">
                    {name}
                    <span className="wizard-field-type">
                      fn({field.params.map((p) => `${p.name}: ${p.type}`).join(', ')})
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {selected && isDerived && (
        <div className="wizard-step-note" style={{ marginTop: '0.5rem' }}>
          Derived entity — Transform step skipped (pipeline is baked into the entity expression).
        </div>
      )}
      <div className="wizard-step-footer">
        <button
          className="wizard-btn wizard-btn-primary"
          onClick={onNext}
          disabled={!selected}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Transform ─────────────────────────────────────────────────────────

interface Step2Props {
  descriptor: CardDescriptor;
  ops: OpConfig[];
  onChange: (ops: OpConfig[]) => void;
  onBack: () => void;
  onNext: () => void;
}

function Step2Transform({ descriptor, ops, onChange, onBack, onNext }: Step2Props) {
  const isCollection = descriptor.schemaType === "collection";
  const fields = descriptor.outputFields;

  // Local draft state for builder inputs
  const [filterField, setFilterField] = useState(fields[0]?.key ?? "");
  const [filterOp, setFilterOp] = useState<string>("eq");
  const [filterValue, setFilterValue] = useState("");
  const [sortField, setSortField] = useState(fields[0]?.key ?? "");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [limitN, setLimitN] = useState<number>(10);

  function addFilter() {
    if (!filterField) return;
    const op: OpConfig = { type: "filter", field: filterField, op: filterOp as never, value: filterValue };
    onChange([...ops, op]);
    setFilterValue("");
  }

  function addSort() {
    if (!sortField) return;
    onChange([...ops, { type: "sort", field: sortField, dir: sortDir }]);
  }

  function setLimit() {
    if (!limitN || limitN < 1) return;
    // Replace existing limit op if present
    const without = ops.filter((o) => o.type !== "limit");
    onChange([...without, { type: "limit", n: limitN }]);
  }

  function removeOp(index: number) {
    onChange(ops.filter((_, i) => i !== index));
  }

  const opLabel = (op: OpConfig): string => {
    switch (op.type) {
      case "filter": return `filter: ${op.field} ${op.op} "${op.value}"`;
      case "sort":   return `sort: ${op.field} ${op.dir}`;
      case "limit":  return `limit: ${op.n}`;
      case "group":  return `group: ${op.field}`;
      case "pick":   return `pick: ${op.fields.join(", ")}`;
      case "apply":  return `apply: ${op.fn}`;
      case "pipe":   return `pipe (${op.ops.length} ops)`;
    }
  };

  if (!isCollection) {
    return (
      <div className="wizard-step-panel">
        <div className="wizard-step-heading">Transform</div>
        <div className="wizard-step-note">
          This card returns a record — transform ops apply to collections only.
        </div>
        <div className="wizard-step-footer">
          <button className="wizard-btn" onClick={onBack}>← Back</button>
          <button className="wizard-btn wizard-btn-primary" onClick={onNext}>Next →</button>
        </div>
      </div>
    );
  }

  return (
    <div className="wizard-step-panel">
      <div className="wizard-step-heading">Transform data</div>

      {/* Current ops */}
      {ops.length > 0 && (
        <div className="wizard-ops-list">
          {ops.map((op, i) => (
            <div key={i} className="wizard-op-chip">
              <span>{opLabel(op)}</span>
              <button className="wizard-op-remove" onClick={() => removeOp(i)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Filter builder */}
      <div className="wizard-op-builder">
        <div className="wizard-op-builder-title">Filter</div>
        <div className="wizard-op-row">
          <select className="wizard-select" value={filterField} onChange={(e) => setFilterField(e.target.value)}>
            {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <select className="wizard-select wizard-select-narrow" value={filterOp} onChange={(e) => setFilterOp(e.target.value)}>
            {COMPARISON_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            className="wizard-input"
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            placeholder="value"
            onKeyDown={(e) => e.key === "Enter" && addFilter()}
          />
          <button className="wizard-btn wizard-btn-small" onClick={addFilter}>Add</button>
        </div>
      </div>

      {/* Sort builder */}
      <div className="wizard-op-builder">
        <div className="wizard-op-builder-title">Sort</div>
        <div className="wizard-op-row">
          <select className="wizard-select" value={sortField} onChange={(e) => setSortField(e.target.value)}>
            {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <select className="wizard-select wizard-select-narrow" value={sortDir} onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}>
            <option value="asc">Asc</option>
            <option value="desc">Desc</option>
          </select>
          <button className="wizard-btn wizard-btn-small" onClick={addSort}>Add</button>
        </div>
      </div>

      {/* Limit */}
      <div className="wizard-op-builder">
        <div className="wizard-op-builder-title">Limit</div>
        <div className="wizard-op-row">
          <input
            className="wizard-input wizard-input-narrow"
            type="number"
            min={1}
            value={limitN}
            onChange={(e) => setLimitN(Number(e.target.value))}
          />
          <span className="wizard-op-builder-note">rows</span>
          <button className="wizard-btn wizard-btn-small" onClick={setLimit}>Set</button>
        </div>
      </div>

      <div className="wizard-step-footer">
        <button className="wizard-btn" onClick={onBack}>← Back</button>
        <button className="wizard-btn wizard-btn-secondary" onClick={() => { onChange([]); onNext(); }}>Skip</button>
        <button className="wizard-btn wizard-btn-primary" onClick={onNext}>Next →</button>
      </div>
    </div>
  );
}

// ── Step 3: Display ───────────────────────────────────────────────────────────

interface Step3Props {
  descriptor: CardDescriptor;
  selectedEntity: EntityDef | null;
  displayStyle: 'table' | 'card-list' | 'simple-list' | undefined;
  visibleFields: string[];
  rendererConfigs: CardRendererConfig;
  functionFields: Array<{ name: string; label?: string }>;
  title: string;
  onDisplayStyleChange: (s: 'table' | 'card-list' | 'simple-list' | undefined) => void;
  onVisibleFieldsChange: (vf: string[]) => void;
  onRendererConfigChange: (rc: CardRendererConfig) => void;
  onFunctionFieldsChange: (ff: Array<{ name: string; label?: string }>) => void;
  onTitleChange: (t: string) => void;
  onBack: () => void;
  onAdd: () => void;
}

function Step3Display({
  descriptor,
  selectedEntity,
  displayStyle,
  visibleFields,
  rendererConfigs,
  functionFields,
  title,
  onDisplayStyleChange,
  onVisibleFieldsChange,
  onRendererConfigChange,
  onFunctionFieldsChange,
  onTitleChange,
  onBack,
  onAdd,
}: Step3Props) {
  const isCollection = descriptor.schemaType === "collection";
  const fields = descriptor.outputFields;

  // Collect function fields from the EntityDef (if available)
  const entityFunctionFields = selectedEntity
    ? Object.entries(selectedEntity.fields)
        .filter(([, f]) => f.kind === 'function')
        .map(([name, f]) => ({ name, field: f as FunctionFieldDef }))
    : [];

  function toggleFunctionField(name: string) {
    const isEnabled = functionFields.some((ff) => ff.name === name);
    if (isEnabled) {
      onFunctionFieldsChange(functionFields.filter((ff) => ff.name !== name));
    } else {
      onFunctionFieldsChange([...functionFields, { name }]);
    }
  }

  function setFunctionFieldLabel(name: string, label: string) {
    onFunctionFieldsChange(
      functionFields.map((ff) => ff.name === name ? { ...ff, label: label || undefined } : ff)
    );
  }

  // Default all fields visible when no selection yet
  const effectiveVisible = visibleFields.length
    ? visibleFields
    : fields.map((f) => f.key);

  function toggleField(key: string) {
    const next = effectiveVisible.includes(key)
      ? effectiveVisible.filter((k) => k !== key)
      : [...effectiveVisible, key];
    onVisibleFieldsChange(next);
  }

  function setFieldRenderer(key: string, option: ComponentOption) {
    onRendererConfigChange({ ...rendererConfigs, [key]: option.defaultConfig });
  }

  const collectionOptions = COMPONENT_OPTIONS["collection"] ?? [];
  const collectionStyleIds = ["card-list", "table", "simple-list"] as const;

  return (
    <div className="wizard-step-panel">
      <div className="wizard-step-heading">Choose display</div>

      {/* Title override */}
      <div className="wizard-field-group">
        <label className="wizard-field-label">Card title</label>
        <input
          className="wizard-input"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder={descriptor.label}
        />
      </div>

      {/* Collection display style */}
      {isCollection && (
        <div className="wizard-field-group">
          <label className="wizard-field-label">Layout style</label>
          <div className="wizard-option-grid">
            {collectionOptions.map((opt, i) => {
              const styleId = collectionStyleIds[i];
              const isSelected = displayStyle === styleId || (!displayStyle && i === 0);
              return (
                <button
                  key={opt.id}
                  className={`wizard-option-tile ${isSelected ? "selected" : ""}`}
                  onClick={() => onDisplayStyleChange(isSelected && displayStyle ? undefined : styleId)}
                >
                  <span className="wizard-option-emoji">{opt.emoji}</span>
                  <span className="wizard-option-name">{opt.name}</span>
                  <span className="wizard-option-desc">{opt.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Field selector */}
      <div className="wizard-field-group">
        <label className="wizard-field-label">Visible fields</label>
        <div className="wizard-field-list">
          {fields.map((f) => {
            const isVisible = effectiveVisible.includes(f.key);
            const fieldOptions = getComponentOptions(f.maisieType);
            const currentConfig = rendererConfigs[f.key];
            const activeOptionId = currentConfig
              ? fieldOptions.find((o) => o.defaultConfig.type === currentConfig.type)?.id
              : undefined;

            return (
              <div key={f.key} className={`wizard-field-row ${isVisible ? "" : "hidden"}`}>
                <label className="wizard-field-checkbox-label">
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => toggleField(f.key)}
                  />
                  <span className="wizard-field-name">{f.label}</span>
                  {f.maisieType && (
                    <span className="wizard-field-type-badge">{f.maisieType}</span>
                  )}
                </label>
                {isVisible && fieldOptions.length > 1 && (
                  <div className="wizard-field-renderer-options">
                    {fieldOptions.map((opt) => (
                      <button
                        key={opt.id}
                        className={`wizard-renderer-chip ${activeOptionId === opt.id || (!activeOptionId && fieldOptions[0].id === opt.id) ? "active" : ""}`}
                        onClick={() => setFieldRenderer(f.key, opt)}
                        title={opt.description}
                      >
                        {opt.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Function fields */}
      {entityFunctionFields.length > 0 && (
        <div className="wizard-field-group">
          <label className="wizard-field-label">Function fields (action buttons)</label>
          <div className="wizard-field-list">
            {entityFunctionFields.map(({ name, field }) => {
              const isEnabled = functionFields.some((ff) => ff.name === name);
              const enabledEntry = functionFields.find((ff) => ff.name === name);
              const funcOptions = getFunctionComponentOptions(field);
              const paramSig = field.params.length > 0
                ? field.params.map((p) => `${p.name}: ${p.type}`).join(', ')
                : '';
              return (
                <div key={name} className={`wizard-field-row ${isEnabled ? "" : "hidden"}`}>
                  <label className="wizard-field-checkbox-label">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => toggleFunctionField(name)}
                    />
                    <span className="wizard-field-name">{name}</span>
                    <span className="wizard-field-type-badge">
                      fn({paramSig}) → {field.returnType}
                    </span>
                  </label>
                  {isEnabled && (
                    <div className="wizard-field-renderer-options">
                      {funcOptions.map((opt) => (
                        <span key={opt.id} className="wizard-renderer-chip active" title={opt.description}>
                          {opt.name}
                        </span>
                      ))}
                      <input
                        className="wizard-input"
                        style={{ marginLeft: '0.5rem', width: '8rem' }}
                        value={enabledEntry?.label ?? ''}
                        onChange={(e) => setFunctionFieldLabel(name, e.target.value)}
                        placeholder={`Button label…`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="wizard-step-footer">
        <button className="wizard-btn" onClick={onBack}>← Back</button>
        <button className="wizard-btn wizard-btn-primary" onClick={onAdd}>
          Add to Dashboard
        </button>
      </div>
    </div>
  );
}
