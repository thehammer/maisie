/**
 * FieldRenderer — renders a MaisieValue according to a RendererConfig.
 *
 * The primary rendering component. Dispatches on config.type to pick the
 * correct sub-renderer, merging stored config with RENDERER_DEFAULTS.
 *
 * Usage:
 *   <FieldRenderer value={row.usedBytes} config={{ type: 'bytes' }} />
 *   <FieldRenderer value={row.status}    config={{ type: 'status' }} />
 *
 * When no config is available, use inferRendererConfig(maisieType) to derive
 * a default config from the schema annotation.
 */

import type {
  MaisieFieldType,
  RendererConfig,
  MaisieValue,
  BytesRendererConfig,
  PercentageRendererConfig,
  StatusRendererConfig,
  TimestampRendererConfig,
  EpochMsRendererConfig,
  DurationRendererConfig,
  TemperatureRendererConfig,
  ProgressRendererConfig,
  SignalRendererConfig,
  ActionRendererConfig,
  StreamRendererConfig,
  UrlRendererConfig,
  NumberRendererConfig,
  BooleanRendererConfig,
  StringRendererConfig,
  ToggleRendererConfig,
} from "@maisie/shared";
import { RENDERER_DEFAULTS } from "@maisie/shared";
import { useState, useCallback } from "react";
import { useCardRefresh } from "../CardRefreshContext";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number, unit?: BytesRendererConfig["unit"]): string {
  if (bytes === 0) return "0 B";
  const sizes: Array<[BytesRendererConfig["unit"], number]> = [
    ["TB", 1024 ** 4], ["GB", 1024 ** 3], ["MB", 1024 ** 2], ["KB", 1024], ["B", 1],
  ];
  if (unit && unit !== "B") {
    const divisor = sizes.find(([u]) => u === unit)?.[1] ?? 1;
    return `${(bytes / divisor).toFixed(1)} ${unit}`;
  }
  for (const [label, divisor] of sizes) {
    if (bytes >= divisor) return `${(bytes / divisor).toFixed(1)} ${label}`;
  }
  return `${bytes} B`;
}

function formatDuration(seconds: number, style: "compact" | "full"): string {
  if (style === "full") {
    if (seconds < 60) return `${seconds} second${seconds !== 1 ? "s" : ""}`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return s ? `${m} minutes ${s} seconds` : `${m} minutes`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h} hours ${rem} minutes` : `${h} hours`;
  }
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatDate(date: Date, format: TimestampRendererConfig["format"]): string {
  switch (format) {
    case "datetime": return date.toLocaleString();
    case "date":     return date.toLocaleDateString();
    case "time":     return date.toLocaleTimeString();
    default:         return relativeTime(date); // 'relative'
  }
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (Math.abs(seconds) < 60) return "just now";
  const minutes = Math.floor(Math.abs(seconds) / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32;
}

function normalizeStatus(value: string): string {
  const v = value.toLowerCase();
  if (["ok", "healthy", "connected", "online", "running", "active"].includes(v)) return "ok";
  if (["warning", "degraded", "slow", "tray_empty"].includes(v)) return "warning";
  if (["error", "offline", "disconnected", "failed"].includes(v)) return "error";
  if (["idle", "standby", "inactive", "sleep"].includes(v)) return "idle";
  if (["busy", "in-progress", "printing"].includes(v)) return "busy";
  return "unknown";
}

// dBm → 0–n bars
function dbmToBars(dbm: number, bars: number): number {
  // typical range: -100 (no signal) to -40 (excellent)
  const pct = Math.max(0, Math.min(1, (dbm + 100) / 60));
  return Math.ceil(pct * bars);
}

// ── Sub-renderers ─────────────────────────────────────────────────────────────

function BytesRenderer({ value, config }: { value: unknown; config: BytesRendererConfig }) {
  const n = Number(value);
  if (isNaN(n)) return <span className="resource-null">—</span>;
  return <span className="resource-bytes">{formatBytes(n, config.unit)}</span>;
}

function NumberRenderer({ value, config }: { value: unknown; config: NumberRendererConfig }) {
  const n = Number(value);
  if (isNaN(n)) return <span className="resource-null">—</span>;
  const formatted = n.toFixed(config.decimals ?? 2);
  return (
    <span className="resource-number">
      {config.prefix}{formatted}{config.suffix}
    </span>
  );
}

function StringRenderer({ value, config }: { value: unknown; config: StringRendererConfig }) {
  let s = String(value ?? "");
  if (config.maxLength && s.length > config.maxLength) {
    s = s.slice(0, config.maxLength) + "…";
  }
  if (config.code) return <code className="resource-code">{s}</code>;
  return <span>{s}</span>;
}

function BooleanRenderer({ value, config }: { value: unknown; config: BooleanRendererConfig }) {
  const truthy = Boolean(value);
  return (
    <span className={`resource-boolean resource-boolean-${truthy ? "true" : "false"}`}>
      {truthy ? (config.trueLabel ?? "Yes") : (config.falseLabel ?? "No")}
    </span>
  );
}

function PercentageRenderer({ value, config }: { value: unknown; config: PercentageRendererConfig }) {
  const pct = Math.min(100, Math.max(0, Number(value)));
  if (isNaN(pct)) return <span className="resource-null">—</span>;

  const warnAt = config.warnAt ?? 70;
  const critAt = config.critAt ?? 90;
  const colorClass = pct >= critAt ? "crit" : pct >= warnAt ? "warn" : "ok";

  return (
    <span className="resource-percentage">
      {config.showBar !== false && (
        <span className={`resource-progress-bar resource-progress-bar-${colorClass}`}>
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      {pct.toFixed(0)}%
    </span>
  );
}

function StatusRenderer({ value, config }: { value: unknown; config: StatusRendererConfig }) {
  const s = String(value ?? "");
  const normalized = config.colorMap?.[s] ? s : normalizeStatus(s);
  return (
    <span className={`resource-status resource-status-${normalized}`}>{s}</span>
  );
}

function ImageRenderer({ value, config }: { value: unknown; config: { aspectRatio?: string; fit?: string } }) {
  if (!value) return <span className="resource-null">—</span>;
  return (
    <img
      className="resource-image"
      src={String(value)}
      alt=""
      loading="lazy"
      style={{ aspectRatio: config.aspectRatio, objectFit: config.fit as React.CSSProperties["objectFit"] }}
    />
  );
}

function TimestampRenderer({ value, config }: { value: unknown; config: TimestampRendererConfig }) {
  if (!value) return <span className="resource-null">—</span>;
  const s = String(value);
  const date = new Date(s);
  if (isNaN(date.getTime())) return <span>{s}</span>;
  return (
    <span className="resource-timestamp" title={date.toLocaleString()}>
      {formatDate(date, config.format ?? "relative")}
    </span>
  );
}

function EpochMsRenderer({ value, config }: { value: unknown; config: EpochMsRendererConfig }) {
  if (!value && value !== 0) return <span className="resource-null">—</span>;
  const ms = Number(value);
  if (isNaN(ms)) return <span className="resource-null">—</span>;
  const date = new Date(ms);
  return (
    <span className="resource-timestamp" title={date.toLocaleString()}>
      {formatDate(date, config.format ?? "relative")}
    </span>
  );
}

function DurationRenderer({ value, config }: { value: unknown; config: DurationRendererConfig }) {
  const secs = Number(value);
  if (isNaN(secs)) return <span className="resource-null">—</span>;
  return <span className="resource-duration">{formatDuration(secs, config.style ?? "compact")}</span>;
}

function ProgressRenderer({ value, config }: { value: unknown; config: ProgressRendererConfig }) {
  if (!value || typeof value !== "object") return <span className="resource-null">—</span>;
  const p = value as { current?: number; total?: number; label?: string };
  const pct = p.total ? ((p.current ?? 0) / p.total) * 100 : 0;
  return (
    <span className="resource-percentage">
      <span className="resource-progress-bar">
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      {config.showFraction !== false && `${p.current ?? 0}/${p.total ?? 0}`}
      {config.showLabel !== false && p.label ? ` ${p.label}` : ""}
    </span>
  );
}

function TemperatureRenderer({ value, config }: { value: unknown; config: TemperatureRendererConfig }) {
  const c = Number(value);
  if (isNaN(c)) return <span className="resource-null">—</span>;

  const warnAt = config.warnAt ?? 70;
  const critAt = config.critAt ?? 85;
  const colorClass = c >= critAt ? "crit" : c >= warnAt ? "warn" : "ok";

  if (config.unit === "F") {
    const f = celsiusToFahrenheit(c);
    return <span className={`resource-temperature resource-temperature-${colorClass}`}>{f.toFixed(0)}°F</span>;
  }
  return <span className={`resource-temperature resource-temperature-${colorClass}`}>{c.toFixed(0)}°C</span>;
}

function SignalRenderer({ value, config }: { value: unknown; config: SignalRendererConfig }) {
  const dbm = Number(value);
  if (isNaN(dbm)) return <span className="resource-null">—</span>;
  const bars = config.bars ?? 4;
  const filled = dbmToBars(dbm, bars);
  return (
    <span className="resource-signal" title={`${dbm} dBm`}>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={`resource-signal-bar ${i < filled ? "resource-signal-bar-filled" : "resource-signal-bar-empty"}`}
        />
      ))}
    </span>
  );
}

function ToggleRenderer({ value, config, row }: { value: unknown; config: ToggleRendererConfig; row?: Record<string, unknown> }) {
  const refresh = useCardRefresh();
  const [pending, setPending] = useState(false);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const isOn = optimistic ?? Boolean(value);

  const handleToggle = useCallback(async () => {
    if (!config.writeEndpoint || pending) return;
    setPending(true);
    setOptimistic(!isOn);
    try {
      const payload: Record<string, unknown> = {};
      if (config.payloadField && row) {
        payload[config.payloadField] = row[config.payloadField];
      }
      await fetch(config.writeEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      refresh();
    } catch {
      setOptimistic(null); // revert on error
    }
    setPending(false);
    // Clear optimistic after refresh arrives
    setTimeout(() => setOptimistic(null), 1000);
  }, [config.writeEndpoint, config.payloadField, row, isOn, pending, refresh]);

  if (config.writeEndpoint) {
    return (
      <button
        className={`toggle-btn ${isOn ? "on" : ""} ${pending ? "pending" : ""}`}
        onClick={handleToggle}
        disabled={pending}
      >
        {isOn ? "ON" : "OFF"}
      </button>
    );
  }

  // Read-only display when no write endpoint configured
  return (
    <span className={`resource-toggle resource-toggle-${isOn ? "on" : "off"}`}>
      {isOn ? "On" : "Off"}
    </span>
  );
}

function ActionRenderer({ config }: { config: ActionRendererConfig }) {
  const refresh = useCardRefresh();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleAction = useCallback(async () => {
    if (!config.writeEndpoint || pending) return;
    if (config.confirm && !window.confirm(config.confirmMessage ?? "Are you sure?")) return;
    setPending(true);
    setResult(null);
    try {
      const res = await fetch(config.writeEndpoint, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setResult(`Error: ${data.error}`);
      } else {
        setResult("Done");
        refresh();
      }
    } catch (err) {
      setResult(`Error: ${err}`);
    }
    setPending(false);
    // Clear result after 5s
    setTimeout(() => setResult(null), 5000);
  }, [config.writeEndpoint, config.confirm, config.confirmMessage, pending, refresh]);

  return (
    <span className="resource-action-wrapper">
      <button
        className="resource-action"
        onClick={handleAction}
        disabled={pending || !config.writeEndpoint}
      >
        {pending ? "Running…" : (config.label ?? "Run")}
      </button>
      {result && <span className="resource-action-result">{result}</span>}
    </span>
  );
}

function StreamRenderer({ value, config }: { value: unknown; config: StreamRendererConfig }) {
  if (!value) return <span className="resource-null">—</span>;
  return (
    <span className="resource-stream">
      [{config.player ?? "hls"} stream — {String(value)}]
    </span>
  );
}

function UrlRenderer({ value, config }: { value: unknown; config: { label?: string; newTab?: boolean } }) {
  if (!value) return <span className="resource-null">—</span>;
  const href = String(value);
  return (
    <a
      className="resource-url"
      href={href}
      target={config.newTab !== false ? "_blank" : undefined}
      rel="noopener noreferrer"
    >
      {config.label ?? href}
    </a>
  );
}

function JsonRenderer({ value, config }: { value: unknown; config: { expanded?: boolean } }) {
  if (value === null || value === undefined) return <span className="resource-null">—</span>;
  return (
    <details open={config.expanded}>
      <summary className="resource-json-summary">
        {Array.isArray(value) ? `[${(value as unknown[]).length}]` : "{…}"}
      </summary>
      <pre className="resource-json">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

// ── FieldRenderer (main export) ───────────────────────────────────────────────

interface FieldRendererProps {
  value: MaisieValue | unknown;
  config: RendererConfig;
  /** The full row object — needed by toggle/action renderers for payload context. */
  row?: Record<string, unknown>;
}

/**
 * Renders a single value according to a RendererConfig.
 * Merges the provided config with RENDERER_DEFAULTS for that type.
 */
export function FieldRenderer({ value, config, row }: FieldRendererProps) {
  if (value === null || value === undefined) {
    return <span className="resource-null">—</span>;
  }

  // Merge with defaults
  const defaults = RENDERER_DEFAULTS[config.type] as RendererConfig;
  const merged = { ...defaults, ...config } as RendererConfig;

  switch (merged.type) {
    case "string":      return <StringRenderer value={value} config={merged} />;
    case "number":      return <NumberRenderer value={value} config={merged} />;
    case "boolean":     return <BooleanRenderer value={value} config={merged} />;
    case "bytes":       return <BytesRenderer value={value} config={merged} />;
    case "percentage":  return <PercentageRenderer value={value} config={merged} />;
    case "status":      return <StatusRenderer value={value} config={merged} />;
    case "image":       return <ImageRenderer value={value} config={merged} />;
    case "timestamp":   return <TimestampRenderer value={value} config={merged} />;
    case "epoch_ms":    return <EpochMsRenderer value={value} config={merged} />;
    case "duration":    return <DurationRenderer value={value} config={merged} />;
    case "progress":    return <ProgressRenderer value={value} config={merged} />;
    case "temperature": return <TemperatureRenderer value={value} config={merged} />;
    case "signal":      return <SignalRenderer value={value} config={merged} />;
    case "toggle":      return <ToggleRenderer value={value} config={merged} row={row} />;
    case "action":      return <ActionRenderer config={merged} />;
    case "stream":      return <StreamRenderer value={value} config={merged} />;
    case "url":         return <UrlRenderer value={value} config={merged} />;
    case "record":      return <JsonRenderer value={value} config={{ expanded: false }} />;
    case "collection":  return <JsonRenderer value={value} config={{ expanded: false }} />;
    case "json":        return <JsonRenderer value={value} config={merged} />;
  }
}

// ── inferRendererConfig ───────────────────────────────────────────────────────

/**
 * Derive a default RendererConfig from a MaisieFieldType annotation.
 * Used by DynamicCard when no stored card layout exists.
 */
export function inferRendererConfig(maisieType: MaisieFieldType | null): RendererConfig {
  switch (maisieType) {
    case "bytes":       return { type: "bytes" };
    case "percentage":  return { type: "percentage" };
    case "status":      return { type: "status" };
    case "image":       return { type: "image" };
    case "timestamp":   return { type: "timestamp" };
    case "epoch_ms":    return { type: "epoch_ms" };
    case "duration":    return { type: "duration" };
    case "progress":    return { type: "progress" };
    case "temperature": return { type: "temperature" };
    case "signal":      return { type: "signal" };
    case "toggle":      return { type: "toggle" };
    case "action":      return { type: "action" };
    case "stream":      return { type: "stream" };
    case "url":         return { type: "url" };
    case "record":      return { type: "record" };
    case "collection":  return { type: "collection" };
    case "json":        return { type: "json" };
    case "boolean":     return { type: "boolean" };
    case "number":      return { type: "number", decimals: 0, suffix: "" };
    case "string":
    default:            return { type: "string" };
  }
}

