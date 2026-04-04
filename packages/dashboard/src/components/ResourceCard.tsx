/**
 * ResourceCard — generic renderer for PluginAction output.
 *
 * Reads field type annotations (attached via field() helper in @maisie/shared)
 * from the action catalog to pick the right component for each value, without
 * any plugin-specific knowledge.
 *
 * Used for: any action with ui.type = 'data' or 'both'.
 * Hand-written cards still exist for complex layouts — this handles the simple cases.
 */

import type { MaisieFieldType } from "@maisie/shared";

// ─── Field type → React element ────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: unknown;
  type: MaisieFieldType | null;
}

function FieldValue({ value, type }: { value: unknown; type: MaisieFieldType | null }) {
  if (value === null || value === undefined) return <span className="resource-null">—</span>;

  switch (type) {
    case "bytes":
      return <span className="resource-bytes">{formatBytes(Number(value))}</span>;

    case "percentage":
      return (
        <span className="resource-percentage">
          <span className="resource-progress-bar">
            <span style={{ width: `${Math.min(100, Number(value))}%` }} />
          </span>
          {Number(value).toFixed(0)}%
        </span>
      );

    case "status":
      return <span className={`resource-status resource-status-${normalizeStatus(String(value))}`}>{String(value)}</span>;

    case "image":
      return <img className="resource-image" src={String(value)} alt="" loading="lazy" />;

    case "timestamp": {
      const ts = Number(value);
      const date = ts > 1e12 ? new Date(ts) : new Date(ts * 1000); // ms vs s
      return <span className="resource-timestamp" title={date.toLocaleString()}>{relativeTime(date)}</span>;
    }

    case "duration":
      return <span className="resource-duration">{formatDuration(Number(value))}</span>;

    case "temperature":
      return <span className="resource-temperature">{Number(value).toFixed(0)}°C</span>;

    case "signal":
      return <span className="resource-signal">{Number(value)} dBm</span>;

    case "boolean":
    case "toggle":
      return <span className="resource-boolean">{value ? "✓" : "✗"}</span>;

    case "url":
      return <a className="resource-url" href={String(value)} target="_blank" rel="noopener">{String(value)}</a>;

    case "stream":
      return <span className="resource-stream">{String(value)}</span>;

    case "progress": {
      const p = value as { current?: number; total?: number; label?: string };
      const pct = p.total ? (p.current ?? 0) / p.total * 100 : 0;
      return (
        <span className="resource-percentage">
          <span className="resource-progress-bar">
            <span style={{ width: `${Math.min(100, pct)}%` }} />
          </span>
          {p.current}/{p.total}{p.label ? ` ${p.label}` : ""}
        </span>
      );
    }

    case "json":
      return <pre className="resource-json">{JSON.stringify(value, null, 2)}</pre>;

    default:
      return <span>{String(value)}</span>;
  }
}

function ResourceField({ label, value, type }: FieldProps) {
  return (
    <div className="resource-field">
      <span className="resource-field-label">{label}</span>
      <span className="resource-field-value">
        <FieldValue value={value} type={type} />
      </span>
    </div>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

export interface ResourceFieldDef {
  key: string;
  label: string;
  type: MaisieFieldType | null;
}

export interface ResourceCardProps {
  /** Card title — usually the action's ui.label */
  title: string;
  /** The data object to render */
  data: Record<string, unknown> | null;
  /** Field definitions with semantic types */
  fields: ResourceFieldDef[];
  /** If true, show a loading skeleton */
  loading?: boolean;
  /** Error message, if any */
  error?: string | null;
  /** Which fields to show — if empty, show all */
  visibleFields?: string[];
}

export function ResourceCard({ title, data, fields, loading, error, visibleFields }: ResourceCardProps) {
  const shown = visibleFields?.length
    ? fields.filter(f => visibleFields.includes(f.key))
    : fields;

  return (
    <div className="resource-card">
      <h3 className="card-title">{title}</h3>
      {loading && <div className="resource-loading">Loading…</div>}
      {error && <div className="resource-error">{error}</div>}
      {data && !loading && (
        <div className="resource-fields">
          {shown.map(f => (
            <ResourceField
              key={f.key}
              label={f.label}
              value={data[f.key]}
              type={f.type}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── List variant ────────────────────────────────────────────────────────────

export interface ResourceListProps {
  title: string;
  items: Record<string, unknown>[] | null;
  fields: ResourceFieldDef[];
  loading?: boolean;
  error?: string | null;
  /** Key field to use as React key */
  idField?: string;
  /** Which fields to show — if empty, show all */
  visibleFields?: string[];
}

export function ResourceList({ title, items, fields, loading, error, idField = "id", visibleFields }: ResourceListProps) {
  const shown = visibleFields?.length
    ? fields.filter(f => visibleFields.includes(f.key))
    : fields;

  return (
    <div className="resource-card">
      <h3 className="card-title">{title}</h3>
      {loading && <div className="resource-loading">Loading…</div>}
      {error && <div className="resource-error">{error}</div>}
      {items && !loading && (
        <table className="resource-table">
          <thead>
            <tr>
              {shown.map(f => <th key={f.key}>{f.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={String(item[idField] ?? i)}>
                {shown.map(f => (
                  <td key={f.key}>
                    <FieldValue value={item[f.key]} type={f.type} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Map arbitrary status strings to the shared status vocabulary for styling */
function normalizeStatus(value: string): string {
  const v = value.toLowerCase();
  if (v === "ok" || v === "healthy" || v === "connected" || v === "online" || v === "running") return "ok";
  if (v === "warning" || v === "degraded" || v === "slow") return "warning";
  if (v === "error" || v === "offline" || v === "disconnected" || v === "failed") return "error";
  if (v === "idle" || v === "standby" || v === "inactive") return "idle";
  if (v === "busy" || v === "active" || v === "in-progress") return "busy";
  return "unknown";
}
