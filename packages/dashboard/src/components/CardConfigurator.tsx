/**
 * CardConfigurator — edit panel for any dashboard card.
 *
 * Opens as a slide-out panel attached to a card. For dynamic cards (from the
 * catalog), provides full control: title, visible fields, ops pipeline, and
 * per-field renderer overrides. For hand-written cards, shows basic settings
 * only (title, column span).
 *
 * State is local until "Apply" — at which point it calls onSave with the
 * updated config patch. The parent persists it via useLayout.updateCardConfig.
 */

import { useState, useCallback } from "react";
import type { CardConfig } from "../hooks/useLayout";
import type { CardDescriptor } from "./DynamicCard";
import type {
  OpConfig,
  CardRendererConfig,
  RendererConfig,
  ComparisonOp,
  SortDir,
} from "@maisie/shared";
import { RENDERER_DEFAULTS } from "@maisie/shared";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CardConfiguratorProps {
  widget: CardConfig;
  /** If available, the card's catalog descriptor (only for dynamic cards). */
  descriptor?: CardDescriptor;
  onSave: (patch: Pick<CardConfig, "title" | "visibleFields" | "ops" | "rendererConfigs">) => void;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CardConfigurator({ widget, descriptor, onSave, onClose }: CardConfiguratorProps) {
  const isDynamic = !!descriptor;
  const fields = descriptor?.outputFields ?? [];

  // Local state — initialized from widget config
  const [title, setTitle] = useState(widget.title ?? "");
  const [visibleFields, setVisibleFields] = useState<string[]>(
    widget.visibleFields ?? fields.map((f) => f.key),
  );
  const [ops, setOps] = useState<OpConfig[]>(widget.ops ?? []);
  const [rendererConfigs, setRendererConfigs] = useState<CardRendererConfig>(
    widget.rendererConfigs ?? {},
  );

  const handleApply = useCallback(() => {
    onSave({
      title: title || undefined,
      visibleFields: visibleFields.length === fields.length ? undefined : visibleFields,
      ops: ops.length ? ops : undefined,
      rendererConfigs: Object.keys(rendererConfigs).length ? rendererConfigs : undefined,
    });
    onClose();
  }, [title, visibleFields, ops, rendererConfigs, fields.length, onSave, onClose]);

  const toggleField = useCallback((key: string) => {
    setVisibleFields((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }, []);

  const moveField = useCallback((key: string, dir: -1 | 1) => {
    setVisibleFields((prev) => {
      const idx = prev.indexOf(key);
      if (idx === -1) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  }, []);

  // ── Ops pipeline editing ──────────────────────────────────────────────────

  const addFilter = useCallback(() => {
    const firstField = fields[0]?.key ?? "id";
    setOps((prev) => [...prev, { type: "filter", field: firstField, op: "eq" as ComparisonOp, value: "" }]);
  }, [fields]);

  const addSort = useCallback(() => {
    const firstField = fields[0]?.key ?? "id";
    setOps((prev) => [...prev, { type: "sort", field: firstField, dir: "asc" as SortDir }]);
  }, [fields]);

  const addLimit = useCallback(() => {
    setOps((prev) => [...prev, { type: "limit", n: 10 }]);
  }, []);

  const removeOp = useCallback((index: number) => {
    setOps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateOp = useCallback((index: number, patch: Partial<OpConfig>) => {
    setOps((prev) => prev.map((op, i) => (i === index ? { ...op, ...patch } as OpConfig : op)));
  }, []);

  // ── Renderer config editing ───────────────────────────────────────────────

  const updateRendererConfig = useCallback((key: string, config: RendererConfig) => {
    setRendererConfigs((prev) => ({ ...prev, [key]: config }));
  }, []);

  const clearRendererConfig = useCallback((key: string) => {
    setRendererConfigs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="card-configurator-overlay" onClick={onClose}>
      <div className="card-configurator" onClick={(e) => e.stopPropagation()}>
        <div className="card-configurator-header">
          <h3>Configure: {widget.title || descriptor?.label || widget.id}</h3>
          <button className="card-configurator-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="card-configurator-body">
          {/* ── Title ────────────────────────────────────────────────── */}
          <section className="card-configurator-section">
            <label className="card-configurator-label">Card Title</label>
            <input
              className="card-configurator-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={descriptor?.label || widget.id}
            />
          </section>

          {/* ── Fields (dynamic cards only) ───────────────────────────── */}
          {isDynamic && fields.length > 0 && (
            <section className="card-configurator-section">
              <label className="card-configurator-label">Visible Fields</label>
              <div className="card-configurator-fields">
                {fields.map((f) => {
                  const isVisible = visibleFields.includes(f.key);
                  const idx = visibleFields.indexOf(f.key);
                  return (
                    <div key={f.key} className="card-configurator-field-row">
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={() => toggleField(f.key)}
                      />
                      <span className="card-configurator-field-label">{f.label}</span>
                      <span className="card-configurator-field-type">{f.maisieType || f.type}</span>
                      {isVisible && (
                        <span className="card-configurator-field-order">
                          <button
                            className="card-configurator-arrow"
                            disabled={idx <= 0}
                            onClick={() => moveField(f.key, -1)}
                          >
                            &uarr;
                          </button>
                          <button
                            className="card-configurator-arrow"
                            disabled={idx >= visibleFields.length - 1}
                            onClick={() => moveField(f.key, 1)}
                          >
                            &darr;
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Ops Pipeline (collection cards only) ──────────────────── */}
          {isDynamic && descriptor?.schemaType === "collection" && (
            <section className="card-configurator-section">
              <label className="card-configurator-label">Data Pipeline</label>
              <div className="card-configurator-ops">
                {ops.map((op, i) => (
                  <OpEditor
                    key={i}
                    op={op}
                    fields={fields}
                    onChange={(patch) => updateOp(i, patch)}
                    onRemove={() => removeOp(i)}
                  />
                ))}
                <div className="card-configurator-op-buttons">
                  <button className="card-configurator-btn-small" onClick={addFilter}>
                    + Filter
                  </button>
                  <button className="card-configurator-btn-small" onClick={addSort}>
                    + Sort
                  </button>
                  <button className="card-configurator-btn-small" onClick={addLimit}>
                    + Limit
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ── Field Renderers (dynamic cards only) ──────────────────── */}
          {isDynamic && fields.length > 0 && (
            <section className="card-configurator-section">
              <label className="card-configurator-label">Field Display</label>
              <div className="card-configurator-renderers">
                {fields
                  .filter((f) => visibleFields.includes(f.key))
                  .map((f) => (
                    <FieldRendererEditor
                      key={f.key}
                      fieldKey={f.key}
                      fieldLabel={f.label}
                      maisieType={f.maisieType}
                      config={rendererConfigs[f.key]}
                      onChange={(config) => updateRendererConfig(f.key, config)}
                      onClear={() => clearRendererConfig(f.key)}
                    />
                  ))}
              </div>
            </section>
          )}
        </div>

        <div className="card-configurator-footer">
          <button className="card-configurator-btn cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="card-configurator-btn apply" onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ── OpEditor ──────────────────────────────────────────────────────────────────

const COMPARISON_OPS: { value: ComparisonOp; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "contains", label: "contains" },
  { value: "startsWith", label: "starts with" },
];

function OpEditor({
  op,
  fields,
  onChange,
  onRemove,
}: {
  op: OpConfig;
  fields: CardDescriptor["outputFields"];
  onChange: (patch: Partial<OpConfig>) => void;
  onRemove: () => void;
}) {
  if (op.type === "filter") {
    return (
      <div className="card-configurator-op-row">
        <span className="card-configurator-op-type">Filter</span>
        <select value={op.field} onChange={(e) => onChange({ field: e.target.value })}>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
        <select value={op.op} onChange={(e) => onChange({ op: e.target.value as ComparisonOp })}>
          {COMPARISON_OPS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <input
          className="card-configurator-input small"
          value={String(op.value ?? "")}
          onChange={(e) => {
            const v = e.target.value;
            // Auto-convert to number if it looks numeric
            const asNum = Number(v);
            onChange({ value: v === "" ? "" : isNaN(asNum) ? v : asNum });
          }}
          placeholder="value"
        />
        <button className="card-configurator-op-remove" onClick={onRemove}>
          &times;
        </button>
      </div>
    );
  }

  if (op.type === "sort") {
    return (
      <div className="card-configurator-op-row">
        <span className="card-configurator-op-type">Sort</span>
        <select value={op.field} onChange={(e) => onChange({ field: e.target.value })}>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
        <select value={op.dir} onChange={(e) => onChange({ dir: e.target.value as SortDir })}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
        <button className="card-configurator-op-remove" onClick={onRemove}>
          &times;
        </button>
      </div>
    );
  }

  if (op.type === "limit") {
    return (
      <div className="card-configurator-op-row">
        <span className="card-configurator-op-type">Limit</span>
        <input
          className="card-configurator-input small"
          type="number"
          min={1}
          value={op.n}
          onChange={(e) => onChange({ n: Math.max(1, Number(e.target.value)) })}
        />
        <span>rows</span>
        <button className="card-configurator-op-remove" onClick={onRemove}>
          &times;
        </button>
      </div>
    );
  }

  return null;
}

// ── FieldRendererEditor ───────────────────────────────────────────────────────

/** Common renderer config fields based on maisieType. */
function FieldRendererEditor({
  fieldKey,
  fieldLabel,
  maisieType,
  config,
  onChange,
  onClear,
}: {
  fieldKey: string;
  fieldLabel: string;
  maisieType: string | null;
  config: RendererConfig | undefined;
  onChange: (config: RendererConfig) => void;
  onClear: () => void;
}) {
  const effectiveType = config?.type || maisieType || "string";
  const defaults = RENDERER_DEFAULTS[effectiveType as keyof typeof RENDERER_DEFAULTS];

  // Show type-specific controls
  return (
    <details className="card-configurator-renderer-row">
      <summary>
        <span className="card-configurator-field-label">{fieldLabel}</span>
        <span className="card-configurator-field-type">{effectiveType}</span>
        {config && (
          <button
            className="card-configurator-reset"
            onClick={(e) => { e.preventDefault(); onClear(); }}
            title="Reset to default"
          >
            &circlearrowleft;
          </button>
        )}
      </summary>
      <div className="card-configurator-renderer-controls">
        {renderTypeControls(effectiveType, config ?? defaults, onChange)}
      </div>
    </details>
  );
}

function renderTypeControls(
  type: string,
  config: RendererConfig,
  onChange: (config: RendererConfig) => void,
): React.ReactNode {
  switch (type) {
    case "percentage":
      return (
        <>
          <label>
            Warning at{" "}
            <input
              type="number"
              className="card-configurator-input tiny"
              value={(config as any).warnAt ?? 70}
              onChange={(e) => onChange({ ...config, warnAt: Number(e.target.value) } as RendererConfig)}
            />
            %
          </label>
          <label>
            Critical at{" "}
            <input
              type="number"
              className="card-configurator-input tiny"
              value={(config as any).critAt ?? 90}
              onChange={(e) => onChange({ ...config, critAt: Number(e.target.value) } as RendererConfig)}
            />
            %
          </label>
        </>
      );

    case "number":
      return (
        <>
          <label>
            Decimals{" "}
            <input
              type="number"
              className="card-configurator-input tiny"
              min={0}
              max={10}
              value={(config as any).decimals ?? 2}
              onChange={(e) => onChange({ ...config, decimals: Number(e.target.value) } as RendererConfig)}
            />
          </label>
          <label>
            Suffix{" "}
            <input
              type="text"
              className="card-configurator-input small"
              value={(config as any).suffix ?? ""}
              onChange={(e) => onChange({ ...config, suffix: e.target.value } as RendererConfig)}
            />
          </label>
        </>
      );

    case "temperature":
      return (
        <>
          <label>
            Unit{" "}
            <select
              value={(config as any).unit ?? "C"}
              onChange={(e) => onChange({ ...config, unit: e.target.value } as RendererConfig)}
            >
              <option value="C">Celsius</option>
              <option value="F">Fahrenheit</option>
            </select>
          </label>
          <label>
            Warning at{" "}
            <input
              type="number"
              className="card-configurator-input tiny"
              value={(config as any).warnAt ?? 70}
              onChange={(e) => onChange({ ...config, warnAt: Number(e.target.value) } as RendererConfig)}
            />
            &deg;
          </label>
        </>
      );

    case "timestamp":
    case "epoch_ms":
      return (
        <label>
          Format{" "}
          <select
            value={(config as any).format ?? "relative"}
            onChange={(e) => onChange({ ...config, format: e.target.value } as RendererConfig)}
          >
            <option value="relative">Relative (2h ago)</option>
            <option value="datetime">Date & Time</option>
            <option value="date">Date Only</option>
            <option value="time">Time Only</option>
          </select>
        </label>
      );

    case "duration":
      return (
        <label>
          Style{" "}
          <select
            value={(config as any).style ?? "compact"}
            onChange={(e) => onChange({ ...config, style: e.target.value } as RendererConfig)}
          >
            <option value="compact">Compact (2h 34m)</option>
            <option value="full">Full (2 hours 34 minutes)</option>
          </select>
        </label>
      );

    case "bytes":
      return (
        <label>
          Unit{" "}
          <select
            value={(config as any).unit ?? ""}
            onChange={(e) =>
              onChange({
                ...config,
                unit: e.target.value || undefined,
              } as RendererConfig)
            }
          >
            <option value="">Auto</option>
            <option value="B">Bytes</option>
            <option value="KB">KB</option>
            <option value="MB">MB</option>
            <option value="GB">GB</option>
            <option value="TB">TB</option>
          </select>
        </label>
      );

    case "boolean":
      return (
        <>
          <label>
            True label{" "}
            <input
              type="text"
              className="card-configurator-input small"
              value={(config as any).trueLabel ?? "Yes"}
              onChange={(e) => onChange({ ...config, trueLabel: e.target.value } as RendererConfig)}
            />
          </label>
          <label>
            False label{" "}
            <input
              type="text"
              className="card-configurator-input small"
              value={(config as any).falseLabel ?? "No"}
              onChange={(e) => onChange({ ...config, falseLabel: e.target.value } as RendererConfig)}
            />
          </label>
        </>
      );

    case "string":
      return (
        <label>
          Max length{" "}
          <input
            type="number"
            className="card-configurator-input tiny"
            min={0}
            value={(config as any).maxLength ?? ""}
            placeholder="none"
            onChange={(e) =>
              onChange({
                ...config,
                maxLength: e.target.value ? Number(e.target.value) : undefined,
              } as RendererConfig)
            }
          />
        </label>
      );

    case "json":
      return (
        <label>
          <input
            type="checkbox"
            checked={(config as any).expanded ?? false}
            onChange={(e) => onChange({ ...config, expanded: e.target.checked } as RendererConfig)}
          />{" "}
          Start expanded
        </label>
      );

    default:
      return <span className="card-configurator-no-options">No options for {type}</span>;
  }
}
