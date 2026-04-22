/**
 * DynamicCard — auto-renders any plugin action output using the widget catalog.
 *
 * When a card ID doesn't match a hand-written component, App falls back here.
 * DynamicCard fetches its own data, optionally transforms it via ops pipeline,
 * and delegates rendering to FieldRenderer for each field.
 *
 * Card layout (ops + rendererConfigs) will be stored in the DB and injected here
 * once the card configurator UI is built. For now, defaults are inferred from
 * maisieType annotations on each field.
 */

import { useEffect, useState, useCallback } from "react";
import { useApi } from "../hooks/useApi";
import { useEntitySubscription } from "../hooks/useEntitySubscription";
import { FieldRenderer, inferRendererConfig } from "../lib/renderers/FieldRenderer";
import { applyPipeline } from "../lib/pipeline";
import { CardRefreshContext } from "../lib/CardRefreshContext";
import type { MaisieFieldType, OpConfig, CardRendererConfig, SectionConfig } from "@maisie/shared";

// Mirrors plugin-core's CardDescriptor — defined locally since the dashboard
// only depends on @maisie/shared, not @maisie/plugin-core.
export interface CardDescriptor {
  id: string;           // "{pluginName}.{actionName}" for plugin entities; entity name for derived
  pluginName?: string;  // undefined for derived entities
  actionName: string;
  label: string;
  section: string;
  schemaType?: "scalar" | "record" | "collection" | "json";
  outputFields: Array<{
    key: string;
    type: "string" | "number" | "boolean" | "array" | "object" | "unknown";
    maisieType: MaisieFieldType | null;
    label: string;
    optional: boolean;
  }>;
}

interface DynamicCardProps {
  descriptor: CardDescriptor;
  pollInterval?: number;
  /** Op pipeline to apply before rendering (from stored card layout). */
  ops?: OpConfig[];
  /** Per-field renderer config overrides (from stored card layout). */
  rendererConfigs?: CardRendererConfig;
  /** Ordered subset of field keys to display (from card configurator). */
  visibleFields?: string[];
  /** Override the card title (from card configurator). */
  titleOverride?: string;
  /** Collection display layout chosen by the wizard. */
  displayStyle?: 'table' | 'card-list' | 'simple-list';
  /**
   * Direct endpoint URL — bypasses pluginName/actionName URL derivation.
   * Used by static descriptors for hand-written cards.
   */
  endpoint?: string;
  /**
   * Pre-fetched data — skip internal fetch. Used when App.tsx already has
   * the data from a shared useApi call.
   */
  data?: unknown;
  dataLoading?: boolean;
  dataError?: unknown;
  /** External refresh function — called after mutations when using pre-fetched data. */
  onRefresh?: () => void;
  /**
   * Compound card sections — renders a record response as multiple sections,
   * each pulling data from a different field. Used for multi-section cards
   * like NasCard, PlexCard, MediaCard.
   */
  sections?: SectionConfig[];
  /**
   * Function fields to render as action buttons. Each entry is POSTed to
   * /api/entities/{descriptor.id}/{name} when clicked.
   */
  functionFields?: Array<{ name: string; label?: string }>;
}

// Mirrors deriveHttpPath() in plugin-core/registry.ts — strips verb prefix,
// replaces underscores with hyphens to match the actual HTTP route.
const VERB_PREFIXES = ["list_", "get_", "set_", "create_", "delete_", "invoke_", "stream_", "subscribe_"];

function deriveApiPath(actionName: string): string {
  let name = actionName;
  for (const prefix of VERB_PREFIXES) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }
  return "/" + name.replace(/_/g, "-");
}

export function DynamicCard({
  descriptor,
  pollInterval = 30_000,
  ops = [],
  rendererConfigs = {},
  visibleFields,
  titleOverride,
  endpoint,
  data: externalData,
  dataLoading,
  dataError,
  onRefresh,
  sections,
  displayStyle,
  functionFields,
}: DynamicCardProps) {
  // Derived entities (pluginName is undefined) fetch from /api/entities/{id}/{field}
  // which returns {value: ...}. Plugin entities use the plugin's own action endpoint.
  const isDerived = descriptor.pluginName === undefined;
  const derivedUrl = endpoint
    || (isDerived
      ? `/api/entities/${descriptor.id}/${descriptor.actionName}`
      : `/api/${descriptor.pluginName}${deriveApiPath(descriptor.actionName)}`);

  // Skip fetch if external data is provided (from shared useApi in App.tsx)
  const skipFetch = externalData !== undefined;
  const internal = useApi<unknown>(skipFetch ? null : derivedUrl, pollInterval);
  // Derived entity response is wrapped in {value: ...} — unwrap before passing to renderers.
  const rawInternal = skipFetch ? externalData : internal.data;
  const data = (isDerived && !skipFetch && rawInternal !== null && typeof rawInternal === 'object' && 'value' in (rawInternal as object))
    ? (rawInternal as { value: unknown }).value
    : rawInternal;
  const loading = skipFetch ? (dataLoading ?? false) : internal.loading;
  const error = skipFetch ? dataError : internal.error;
  const refresh = onRefresh ?? internal.refresh;

  // Subscribe to entity invalidation events. When the entity's backing data
  // changes (a plugin event fires on MQTT), the dependency graph publishes
  // home/entity/{id}/invalidated and we re-fetch immediately.
  // descriptor.id is the entity name (e.g. "exterior-lights").
  const tick = useEntitySubscription(descriptor.id);
  useEffect(() => {
    if (tick > 0) refresh();
  }, [tick]);

  // Apply the op pipeline to transform collection data before rendering
  const transformed = applyPipeline(data as never, ops);

  const errorMsg = error ? String(error) : null;
  const title = titleOverride || descriptor.label;

  // Filter and reorder fields if visibleFields is set
  const shownFields = visibleFields
    ? visibleFields
        .map((key) => descriptor.outputFields.find((f) => f.key === key))
        .filter((f): f is CardDescriptor["outputFields"][number] => !!f)
    : descriptor.outputFields;

  let content: React.ReactNode;

  // Compound card — render sections from a record response
  if (sections?.length && data && typeof data === "object" && !Array.isArray(data)) {
    content = (
      <DynamicCompound
        title={title}
        data={data as Record<string, unknown>}
        sections={sections}
        topFields={visibleFields
          ? shownFields
          : descriptor.outputFields.filter(
              (f) => f.type !== "array" && f.type !== "object",
            )}
        rendererConfigs={rendererConfigs}
        loading={loading}
        error={errorMsg}
      />
    );
  } else if (Array.isArray(transformed)) {
    const items = transformed as Record<string, unknown>[];
    if (displayStyle === 'simple-list') {
      content = (
        <DynamicSimpleList
          title={title}
          items={items}
          fields={shownFields}
          loading={loading}
          error={errorMsg}
        />
      );
    } else if (displayStyle === 'table') {
      content = (
        <DynamicList
          title={title}
          items={items}
          fields={shownFields}
          rendererConfigs={rendererConfigs}
          loading={loading}
          error={errorMsg}
        />
      );
    } else if (displayStyle === 'card-list') {
      content = (
        <DynamicListItems
          title={title}
          items={items}
          fields={shownFields}
          rendererConfigs={rendererConfigs}
          loading={loading}
          error={errorMsg}
        />
      );
    } else {
      // Auto heuristic
      const hasImage = shownFields.some((f) => f.maisieType === "image");
      const useListLayout = hasImage || shownFields.length <= 4;
      content = useListLayout ? (
        <DynamicListItems
          title={title}
          items={items}
          fields={shownFields}
          rendererConfigs={rendererConfigs}
          loading={loading}
          error={errorMsg}
        />
      ) : (
        <DynamicList
          title={title}
          items={items}
          fields={shownFields}
          rendererConfigs={rendererConfigs}
          loading={loading}
          error={errorMsg}
        />
      );
    }
  } else {
    content = (
      <DynamicRecord
        title={title}
        data={transformed as Record<string, unknown> | null}
        fields={shownFields}
        rendererConfigs={rendererConfigs}
        loading={loading}
        error={errorMsg}
        entityName={descriptor.id}
        functionFields={functionFields}
        onRefresh={refresh}
      />
    );
  }

  return (
    <CardRefreshContext.Provider value={refresh}>
      {content}
    </CardRefreshContext.Provider>
  );
}

// ── DynamicRecord ─────────────────────────────────────────────────────────────

interface DynamicRecordProps {
  title: string;
  data: Record<string, unknown> | null;
  fields: CardDescriptor["outputFields"];
  rendererConfigs: CardRendererConfig;
  loading?: boolean;
  error?: string | null;
  /** Entity name — used to build POST /api/entities/{entityName}/{field} URLs. */
  entityName?: string;
  /** Function fields to render as action buttons below the data fields. */
  functionFields?: Array<{ name: string; label?: string }>;
  /** Refresh callback — called after a function field invocation. */
  onRefresh?: () => void;
}

function DynamicRecord({ title, data, fields, rendererConfigs, loading, error, entityName, functionFields, onRefresh }: DynamicRecordProps) {
  return (
    <div className="resource-card">
      <h3 className="card-title">{title}</h3>
      {loading && <div className="resource-loading">Loading…</div>}
      {error && <div className="resource-error">{error}</div>}
      {data && !loading && (
        <div className="resource-fields">
          {fields.map((f) => {
            const config = rendererConfigs[f.key] ?? inferRendererConfig(f.maisieType);
            return (
              <div key={f.key} className="resource-field">
                <span className="resource-field-label">{f.label}</span>
                <span className="resource-field-value">
                  <FieldRenderer value={data[f.key]} config={config} />
                </span>
              </div>
            );
          })}
        </div>
      )}
      {functionFields && functionFields.length > 0 && entityName && (
        <div className="resource-function-fields">
          {functionFields.map((ff) => (
            <FunctionFieldButton
              key={ff.name}
              entityName={entityName}
              fieldName={ff.name}
              label={ff.label ?? ff.name}
              onSuccess={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── FunctionFieldButton ───────────────────────────────────────────────────────

interface FunctionFieldButtonProps {
  entityName: string;
  fieldName: string;
  label: string;
  onSuccess?: () => void;
}

function FunctionFieldButton({ entityName, fieldName, label, onSuccess }: FunctionFieldButtonProps) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    if (pending) return;
    setPending(true);
    setResult(null);
    try {
      const res = await fetch(`/api/entities/${entityName}/${fieldName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setResult(`Error: ${data.error}`);
      } else {
        setResult('Done');
        onSuccess?.();
      }
    } catch (err) {
      setResult(`Error: ${err}`);
    }
    setPending(false);
    setTimeout(() => setResult(null), 5000);
  }, [entityName, fieldName, pending, onSuccess]);

  return (
    <span className="resource-action-wrapper">
      <button
        className="resource-action"
        onClick={handleClick}
        disabled={pending}
      >
        {pending ? 'Running…' : label}
      </button>
      {result && <span className="resource-action-result">{result}</span>}
    </span>
  );
}

// ── DynamicSimpleList ─────────────────────────────────────────────────────────
// Minimal list: one item per row, showing only the first title-like field.

interface DynamicSimpleListProps {
  title: string;
  items: Record<string, unknown>[] | null;
  fields: CardDescriptor["outputFields"];
  loading?: boolean;
  error?: string | null;
}

function DynamicSimpleList({ title, items, fields, loading, error }: DynamicSimpleListProps) {
  // Find the first string/title field (non-image, non-status)
  const titleField = fields.find(
    (f) => f.maisieType === "string" || f.maisieType === null || f.type === "string",
  ) ?? fields[0];

  return (
    <div className="resource-card">
      <h3 className="card-title">{title}</h3>
      {loading && <div className="resource-loading">Loading…</div>}
      {error && <div className="resource-error">{error}</div>}
      {items && !loading && items.length === 0 && (
        <div className="empty-state">No items</div>
      )}
      {items && !loading && (
        <ul className="simple-list">
          {items.map((item, i) => (
            <li key={String(item.id ?? i)} className="simple-list-item">
              {titleField ? String(item[titleField.key] ?? "") : String(i + 1)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── DynamicList ───────────────────────────────────────────────────────────────

interface DynamicListProps {
  title: string;
  items: Record<string, unknown>[] | null;
  fields: CardDescriptor["outputFields"];
  rendererConfigs: CardRendererConfig;
  loading?: boolean;
  error?: string | null;
}

function DynamicList({ title, items, fields, rendererConfigs, loading, error }: DynamicListProps) {
  return (
    <div className="resource-card">
      <h3 className="card-title">{title}</h3>
      {loading && <div className="resource-loading">Loading…</div>}
      {error && <div className="resource-error">{error}</div>}
      {items && !loading && (
        <table className="resource-table">
          <thead>
            <tr>
              {fields.map((f) => <th key={f.key}>{f.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={String(item.id ?? i)}>
                {fields.map((f) => {
                  const config = rendererConfigs[f.key] ?? inferRendererConfig(f.maisieType);
                  return (
                    <td key={f.key}>
                      <FieldRenderer value={item[f.key]} config={config} row={item} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── DynamicListItems ──────────────────────────────────────────────────────────
// List-item layout: thumbnail + primary text + secondary text + badge.
// Auto-derives roles from maisieType annotations:
//   image → thumbnail, first string → title, status → badge, rest → subtitle

function DynamicListItems({ title, items, fields, rendererConfigs, loading, error }: DynamicListProps) {
  // Classify fields by role
  const imageField = fields.find((f) => f.maisieType === "image");
  const statusField = fields.find((f) => f.maisieType === "status");
  const stringFields = fields.filter(
    (f) => f !== imageField && f !== statusField &&
           (f.maisieType === "string" || f.maisieType === null || f.type === "string"),
  );
  const titleField = stringFields[0];
  const subFields = stringFields.slice(1);
  // Remaining fields (numbers, timestamps, etc.) go into subtitle
  const otherFields = fields.filter(
    (f) => f !== imageField && f !== statusField && !stringFields.includes(f),
  );

  return (
    <div className="resource-card">
      <h3 className="card-title">{title}</h3>
      {loading && <div className="resource-loading">Loading…</div>}
      {error && <div className="resource-error">{error}</div>}
      {items && !loading && items.length === 0 && (
        <div className="empty-state">No items</div>
      )}
      {items && !loading && items.map((item, i) => (
        <div key={String(item.id ?? i)} className="list-item">
          {imageField && item[imageField.key] ? (
            <img
              src={String(item[imageField.key])}
              alt=""
              className="list-item-thumb"
              loading="lazy"
            />
          ) : imageField ? (
            <div className="list-item-thumb list-item-thumb-placeholder">
              {String(item[titleField?.key ?? ""] ?? "").charAt(0).toUpperCase() || "?"}
            </div>
          ) : null}
          <div className="list-item-text">
            {titleField && (
              <div className="list-item-title">
                {String(item[titleField.key] ?? "")}
              </div>
            )}
            <div className="list-item-sub">
              {[...subFields, ...otherFields].map((f, j) => {
                const val = item[f.key];
                if (val === null || val === undefined) return null;
                const config = rendererConfigs[f.key] ?? inferRendererConfig(f.maisieType);
                return (
                  <span key={f.key}>
                    {j > 0 && " — "}
                    <FieldRenderer value={val} config={config} row={item} />
                  </span>
                );
              })}
            </div>
          </div>
          {statusField && item[statusField.key] != null && (
            <span className="list-item-badge">
              <FieldRenderer
                value={item[statusField.key]}
                config={rendererConfigs[statusField.key] ?? inferRendererConfig(statusField.maisieType)}
                row={item}
              />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── DynamicCompound ───────────────────────────────────────────────────────────
// Multi-section card: top-level scalar fields as a record header, then each
// section renders a nested field (usually a collection) as its own block.

interface DynamicCompoundProps {
  title: string;
  data: Record<string, unknown>;
  sections: SectionConfig[];
  /** Top-level scalar fields to show in the card header (before sections). */
  topFields: CardDescriptor["outputFields"];
  rendererConfigs: CardRendererConfig;
  loading?: boolean;
  error?: string | null;
}

function DynamicCompound({ title, data, sections, topFields, rendererConfigs, loading, error }: DynamicCompoundProps) {
  return (
    <div className="resource-card">
      <h3 className="card-title">{title}</h3>
      {loading && <div className="resource-loading">Loading…</div>}
      {error && <div className="resource-error">{error}</div>}
      {data && !loading && (
        <>
          {/* Top-level scalar fields */}
          {topFields.length > 0 && (
            <div className="resource-fields">
              {topFields.map((f) => {
                const val = data[f.key];
                if (val === null || val === undefined) return null;
                // Skip fields that are used as section sources
                if (sections.some((s) => s.sourceField === f.key)) return null;
                const config = rendererConfigs[f.key] ?? inferRendererConfig(f.maisieType);
                return (
                  <div key={f.key} className="resource-field">
                    <span className="resource-field-label">{f.label}</span>
                    <span className="resource-field-value">
                      <FieldRenderer value={val} config={config} row={data} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sections */}
          {sections.map((section) => {
            if (section.display === "hidden") return null;
            const sectionData = data[section.sourceField];
            const hideWhenEmpty = section.hideWhenEmpty !== false;

            // Handle both arrays (collections) and single objects (records)
            let items: Record<string, unknown>[] | null;
            if (Array.isArray(sectionData)) {
              items = sectionData as Record<string, unknown>[];
            } else if (sectionData && typeof sectionData === "object") {
              // Single object — wrap in array for uniform processing
              items = [sectionData as Record<string, unknown>];
            } else {
              items = null;
            }

            if (!items || (items.length === 0 && hideWhenEmpty)) return null;

            // Apply section-level ops
            const processed = section.ops?.length
              ? applyPipeline(items as never, section.ops) as Record<string, unknown>[]
              : items;

            // Limit
            const limited = section.maxItems
              ? (processed ?? []).slice(0, section.maxItems)
              : processed ?? [];

            // Infer fields from first item if no visibleFields specified
            const sectionFields: CardDescriptor["outputFields"] = section.visibleFields
              ? section.visibleFields.map((key) => ({
                  key,
                  type: "string" as const,
                  maisieType: null,
                  label: key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase()),
                  optional: false,
                }))
              : limited.length > 0
                ? Object.keys(limited[0]).map((key) => ({
                    key,
                    type: "string" as const,
                    maisieType: null,
                    label: key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase()),
                    optional: false,
                  }))
                : [];

            const sectionRenderers = section.rendererConfigs ?? {};

            return (
              <div key={section.sourceField} className="compound-section">
                <div className="compound-section-title">{section.title}</div>
                {section.display === "list" ? (
                  <CompoundListItems items={limited} fields={sectionFields} rendererConfigs={sectionRenderers} />
                ) : section.display === "table" ? (
                  <CompoundTable items={limited} fields={sectionFields} rendererConfigs={sectionRenderers} />
                ) : (
                  // 'record' — show as key-value pairs (first item only)
                  limited[0] && (
                    <div className="resource-fields">
                      {sectionFields.map((f) => {
                        const val = limited[0][f.key];
                        if (val === null || val === undefined) return null;
                        const config = sectionRenderers[f.key] ?? inferRendererConfig(f.maisieType);
                        return (
                          <div key={f.key} className="resource-field">
                            <span className="resource-field-label">{f.label}</span>
                            <span className="resource-field-value">
                              <FieldRenderer value={val} config={config} row={limited[0]} />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/** List items within a compound section. */
function CompoundListItems({ items, fields, rendererConfigs }: {
  items: Record<string, unknown>[];
  fields: CardDescriptor["outputFields"];
  rendererConfigs: CardRendererConfig;
}) {
  // Classify: first string → title, status → badge, rest → sub
  const statusField = fields.find((f) => f.maisieType === "status");
  const stringFields = fields.filter(
    (f) => f !== statusField && (f.maisieType === "string" || f.maisieType === null || f.type === "string"),
  );
  const titleField = stringFields[0];
  const subFields = stringFields.slice(1);
  const otherFields = fields.filter((f) => f !== statusField && !stringFields.includes(f));

  return (
    <>
      {items.map((item, i) => (
        <div key={String(item.id ?? i)} className="list-item">
          <div className="list-item-text">
            {titleField && (
              <div className="list-item-title">{String(item[titleField.key] ?? "")}</div>
            )}
            {(subFields.length > 0 || otherFields.length > 0) && (
              <div className="list-item-sub">
                {[...subFields, ...otherFields].map((f, j) => {
                  const val = item[f.key];
                  if (val === null || val === undefined) return null;
                  const config = rendererConfigs[f.key] ?? inferRendererConfig(f.maisieType);
                  return (
                    <span key={f.key}>
                      {j > 0 && " — "}
                      <FieldRenderer value={val} config={config} row={item} />
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          {statusField && item[statusField.key] != null && (
            <span className="list-item-badge">
              <FieldRenderer
                value={item[statusField.key]}
                config={rendererConfigs[statusField.key] ?? inferRendererConfig(statusField.maisieType)}
                row={item}
              />
            </span>
          )}
        </div>
      ))}
    </>
  );
}

/** Table within a compound section. */
function CompoundTable({ items, fields, rendererConfigs }: {
  items: Record<string, unknown>[];
  fields: CardDescriptor["outputFields"];
  rendererConfigs: CardRendererConfig;
}) {
  return (
    <table className="resource-table">
      <thead>
        <tr>{fields.map((f) => <th key={f.key}>{f.label}</th>)}</tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={String(item.id ?? i)}>
            {fields.map((f) => {
              const config = rendererConfigs[f.key] ?? inferRendererConfig(f.maisieType);
              return <td key={f.key}><FieldRenderer value={item[f.key]} config={config} row={item} /></td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
