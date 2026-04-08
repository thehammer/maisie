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
}: DynamicCardProps) {
  const url = `/api/${descriptor.pluginName}${deriveApiPath(descriptor.actionName)}`;
  const { data, loading, error } = useApi<unknown>(url, pollInterval);

  // Apply the op pipeline to transform collection data before rendering
  const transformed = applyPipeline(data as never, ops);

  const errorMsg = error ? String(error) : null;

  if (Array.isArray(transformed)) {
    return (
      <DynamicList
        title={descriptor.label}
        items={transformed as Record<string, unknown>[]}
        fields={descriptor.outputFields}
        rendererConfigs={rendererConfigs}
        loading={loading}
        error={errorMsg}
      />
    );
  }

  return (
    <DynamicRecord
      title={descriptor.label}
      data={transformed as Record<string, unknown> | null}
      fields={descriptor.outputFields}
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
