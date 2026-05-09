/**
 * Base component renderer — React dispatch for all BASE_COMPONENTS.
 *
 * `renderBaseComponent(name, value)` is the single entry point for rendering
 * a typed data value using the platform component vocabulary. Each registered
 * base component maps to a case here.
 *
 * Stubs render data-visible fallbacks (JSON viewer or static list). They are
 * intentionally visible so that missing implementations are obvious during
 * development, not silent.
 */

import React from 'react'

// ── Renderer config ────────────────────────────────────────────────────────

/**
 * Describes how a base component should render its value.
 * The renderer picks the right React element based on this config.
 */
type RendererConfig =
  | { type: 'string' }
  | { type: 'number'; precision?: number }
  | { type: 'boolean' }
  | { type: 'bytes' }
  | { type: 'percentage' }
  | { type: 'status' }
  | { type: 'image'; width?: number; height?: number; alt?: string }
  | { type: 'timestamp' }
  | { type: 'duration' }
  | { type: 'temperature'; warnAt?: number; critAt?: number }
  | { type: 'signal' }
  | { type: 'gauge'; min?: number; max?: number }
  | { type: 'progress' }
  | { type: 'url'; label?: string; newTab?: boolean }
  | { type: 'toggle'; disabled?: boolean }
  | { type: 'button'; label?: string; variant?: string }
  | { type: 'json'; expanded?: boolean }
  | { type: 'carousel'; cardWidth?: number; cardGap?: number }

/**
 * Derives the RendererConfig for a named base component.
 * Unknown names fall back to a string renderer — visually obvious, not broken.
 */
function buildRendererConfig(
  name: string,
  props?: Record<string, unknown>,
): RendererConfig {
  switch (name) {
    case 'text':
      return { type: 'string' }

    case 'number':
      return { type: 'number', precision: props?.precision as number | undefined }

    case 'boolean':
      return { type: 'boolean' }

    case 'bytes':
      return { type: 'bytes' }

    case 'percentage':
      return { type: 'percentage' }

    case 'status':
      return { type: 'status' }

    case 'image':
      return {
        type: 'image',
        width: props?.width as number | undefined,
        height: props?.height as number | undefined,
        alt: props?.alt as string | undefined,
      }

    case 'timestamp':
      return { type: 'timestamp' }

    case 'duration':
      return { type: 'duration' }

    case 'temperature':
      return {
        type: 'temperature',
        warnAt: props?.warnAt as number | undefined,
        critAt: props?.critAt as number | undefined,
      }

    case 'signal':
      return { type: 'signal' }

    case 'gauge':
      return {
        type: 'gauge',
        min: props?.min as number | undefined,
        max: props?.max as number | undefined,
      }

    case 'progress':
      return { type: 'progress' }

    case 'url':
      return {
        type: 'url',
        label: props?.label as string | undefined,
        newTab: props?.newTab as boolean | undefined,
      }

    case 'toggle':
      return { type: 'toggle', disabled: props?.disabled as boolean | undefined }

    case 'button':
      return {
        type: 'button',
        label: props?.label as string | undefined,
        variant: props?.variant as string | undefined,
      }

    case 'json':
      return { type: 'json', expanded: props?.expanded as boolean | undefined }

    case 'carousel':
      // Carousel is a base component stub — its full implementation uses RAF.
      // For now, dispatch to the carousel type which renders a static horizontal list.
      return {
        type: 'carousel',
        cardWidth: props?.cardWidth as number | undefined,
        cardGap: props?.cardGap as number | undefined,
      }

    default:
      return { type: 'string' }
  }
}

// ── Format helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`
  return `${bytes} B`
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const STATUS_COLORS: Record<string, string> = {
  ok: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  idle: '#6b7280',
  busy: '#3b82f6',
  unknown: '#9ca3af',
}

// ── React renderers ────────────────────────────────────────────────────────

function renderJson(value: unknown, expanded: boolean): React.ReactElement {
  return (
    <details open={expanded} style={{ fontSize: 12 }}>
      <summary style={{ cursor: 'pointer', color: '#9ca3af' }}>
        {Array.isArray(value) ? `[${(value as unknown[]).length} items]` : '{…}'}
      </summary>
      <pre style={{ marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}

function renderCarouselStub(
  value: unknown,
  cardWidth: number,
  cardGap: number,
): React.ReactElement {
  // Stub: render a static horizontal list. Full RAF implementation is future work.
  const items = Array.isArray(value) ? value : []
  if (items.length === 0) {
    return <span style={{ color: '#6b7280', fontSize: 12 }}>No items</span>
  }
  return (
    <div
      style={{
        display: 'flex',
        gap: cardGap,
        overflowX: 'auto',
        padding: '4px 0',
      }}
    >
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            minWidth: cardWidth,
            background: '#1f1f1f',
            borderRadius: 4,
            padding: 8,
            fontSize: 11,
            color: '#d1d5db',
          }}
        >
          {typeof item === 'object' && item !== null
            ? JSON.stringify(item).slice(0, 40)
            : String(item)}
        </div>
      ))}
    </div>
  )
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Render a base component by name with a typed value.
 *
 * @param name   The BASE_COMPONENTS key (e.g. "carousel", "status", "bytes")
 * @param value  The data value to render
 * @param props  Optional component props (overrides defaults from ComponentDef)
 */
export function renderBaseComponent(
  name: string,
  value: unknown,
  props?: Record<string, unknown>,
): React.ReactElement {
  const config = buildRendererConfig(name, props)

  switch (config.type) {
    case 'string':
      return <span>{String(value ?? '')}</span>

    case 'number': {
      const n = typeof value === 'number' ? value : Number(value)
      const precision = config.precision ?? 0
      return <span>{isNaN(n) ? '—' : n.toFixed(precision)}</span>
    }

    case 'boolean':
      return <span>{value ? 'Yes' : 'No'}</span>

    case 'bytes': {
      const n = typeof value === 'number' ? value : Number(value)
      return <span>{isNaN(n) ? '—' : formatBytes(n)}</span>
    }

    case 'percentage': {
      const pct = typeof value === 'number' ? value : Number(value)
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              flex: 1,
              height: 6,
              background: '#374151',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.max(0, pct))}%`,
                height: '100%',
                background: '#3b82f6',
                borderRadius: 3,
              }}
            />
          </div>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>{pct.toFixed(0)}%</span>
        </div>
      )
    }

    case 'status': {
      const s = String(value ?? 'unknown').toLowerCase()
      const color = STATUS_COLORS[s] ?? STATUS_COLORS.unknown
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            borderRadius: 12,
            background: `${color}22`,
            color,
            fontSize: 11,
            fontWeight: 500,
            textTransform: 'capitalize',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: color,
              display: 'inline-block',
            }}
          />
          {s}
        </span>
      )
    }

    case 'image': {
      const src = String(value ?? '')
      return (
        <img
          src={src}
          alt={config.alt ?? ''}
          width={config.width ?? 64}
          height={config.height ?? 64}
          style={{ objectFit: 'cover', borderRadius: 4 }}
        />
      )
    }

    case 'timestamp':
      return (
        <span title={String(value ?? '')} style={{ color: '#9ca3af', fontSize: 12 }}>
          {formatRelativeTime(String(value ?? new Date().toISOString()))}
        </span>
      )

    case 'duration': {
      const n = typeof value === 'number' ? value : Number(value)
      return <span>{isNaN(n) ? '—' : formatDuration(n)}</span>
    }

    case 'temperature': {
      const n = typeof value === 'number' ? value : Number(value)
      const warnAt = config.warnAt ?? 70
      const critAt = config.critAt ?? 90
      const color = n >= critAt ? '#ef4444' : n >= warnAt ? '#f59e0b' : '#d1d5db'
      return <span style={{ color }}>{isNaN(n) ? '—' : `${n.toFixed(0)}°C`}</span>
    }

    case 'signal': {
      const n = typeof value === 'number' ? value : Number(value)
      // dBm: -50 excellent, -70 fair, -90 poor
      const quality = n >= -50 ? 4 : n >= -60 ? 3 : n >= -70 ? 2 : 1
      return (
        <span title={`${n} dBm`} style={{ display: 'inline-flex', gap: 2, alignItems: 'flex-end' }}>
          {[1, 2, 3, 4].map((bar) => (
            <span
              key={bar}
              style={{
                width: 4,
                height: bar * 4 + 4,
                background: bar <= quality ? '#3b82f6' : '#374151',
                borderRadius: 1,
                display: 'inline-block',
              }}
            />
          ))}
        </span>
      )
    }

    case 'gauge': {
      const n = typeof value === 'number' ? value : Number(value)
      const min = config.min ?? 0
      const max = config.max ?? 100
      const pct = Math.min(1, Math.max(0, (n - min) / (max - min)))
      // Simple arc gauge using conic-gradient
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: `conic-gradient(#3b82f6 ${pct * 360}deg, #374151 0deg)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: '#111827',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                color: '#d1d5db',
              }}
            >
              {(pct * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      )
    }

    case 'progress': {
      const p = value as { current?: number; total?: number; label?: string } | null
      if (!p) return <span>—</span>
      const current = p.current ?? 0
      const total = p.total ?? 1
      const pct = total > 0 ? (current / total) * 100 : 0
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {p.label && <span style={{ fontSize: 11, color: '#9ca3af' }}>{p.label}</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                flex: 1,
                height: 6,
                background: '#374151',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: '#3b82f6',
                  borderRadius: 3,
                }}
              />
            </div>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>
              {current}/{total}
            </span>
          </div>
        </div>
      )
    }

    case 'url': {
      const href = String(value ?? '')
      return (
        <a
          href={href}
          target={config.newTab !== false ? '_blank' : undefined}
          rel="noopener noreferrer"
          style={{ color: '#3b82f6', textDecoration: 'underline', fontSize: 12 }}
        >
          {config.label ?? href}
        </a>
      )
    }

    case 'toggle':
      // Read-only display of a boolean toggle state. Write capability requires
      // an onToggle prop wired to a set_ action — not yet implemented.
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            opacity: config.disabled ? 0.5 : 1,
          }}
        >
          <span
            style={{
              width: 32,
              height: 16,
              borderRadius: 8,
              background: value ? '#3b82f6' : '#374151',
              display: 'inline-block',
              position: 'relative',
              transition: 'background 0.15s',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 2,
                left: value ? 18 : 2,
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: '#fff',
                transition: 'left 0.15s',
              }}
            />
          </span>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>{value ? 'On' : 'Off'}</span>
        </span>
      )

    case 'button':
      // Read-only display. Interactive wiring is future work.
      return (
        <button
          disabled
          style={{
            padding: '4px 12px',
            borderRadius: 4,
            border: '1px solid #374151',
            background: '#1f2937',
            color: '#d1d5db',
            fontSize: 12,
            cursor: 'not-allowed',
            opacity: 0.7,
          }}
        >
          {config.label ?? String(value ?? 'Action')}
        </button>
      )

    case 'json':
      return renderJson(value, config.expanded ?? false)

    case 'carousel':
      return renderCarouselStub(
        value,
        config.cardWidth ?? 80,
        config.cardGap ?? 10,
      )
  }
}
