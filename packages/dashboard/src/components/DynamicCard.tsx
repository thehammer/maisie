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

import { useApi } from "../hooks/useApi";
import { FieldRenderer, inferRendererConfig } from "../lib/renderers/FieldRenderer";
import { applyPipeline } from "../lib/pipeline";
import type { MaisieFieldType, OpConfig, CardRendererConfig } from "@maisie/shared";

// Mirrors plugin-core's CardDescriptor — defined locally since the dashboard
// only depends on @maisie/shared, not @maisie/plugin-core.
export interface CardDescriptor {
  id: string;           // "{pluginName}.{actionName}"
  pluginName: string;
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
}: DynamicCardProps) {
  const derivedUrl = endpoint || `/api/${descriptor.pluginName}${deriveApiPath(descriptor.actionName)}`;
  // Skip fetch if external data is provided (from shared useApi in App.tsx)
  const skipFetch = externalData !== undefined;
  const internal = useApi<unknown>(skipFetch ? null : derivedUrl, pollInterval);
  const data = skipFetch ? externalData : internal.data;
  const loading = skipFetch ? (dataLoading ?? false) : internal.loading;
  const error = skipFetch ? dataError : internal.error;

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

  if (Array.isArray(transformed)) {
    // Use list-items layout when fields include an image or only a few
    // text+status fields (typical list-item pattern). Table for many columns.
    const hasImage = shownFields.some((f) => f.maisieType === "image");
    const useListLayout = hasImage || shownFields.length <= 4;

    if (useListLayout) {
      return (
        <DynamicListItems
          title={title}
          items={transformed as Record<string, unknown>[]}
          fields={shownFields}
          rendererConfigs={rendererConfigs}
          loading={loading}
          error={errorMsg}
        />
      );
    }

    return (
      <DynamicList
        title={title}
        items={transformed as Record<string, unknown>[]}
        fields={shownFields}
        rendererConfigs={rendererConfigs}
        loading={loading}
        error={errorMsg}
      />
    );
  }

  return (
    <DynamicRecord
      title={title}
      data={transformed as Record<string, unknown> | null}
      fields={shownFields}
      rendererConfigs={rendererConfigs}
      loading={loading}
      error={errorMsg}
    />
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
}

function DynamicRecord({ title, data, fields, rendererConfigs, loading, error }: DynamicRecordProps) {
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
                      <FieldRenderer value={item[f.key]} config={config} />
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
                    <FieldRenderer value={val} config={config} />
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
              />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
