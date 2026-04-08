/**
 * Renderer configuration types — serializable config shapes for each MaisieFieldType.
 *
 * These are pure data structures with no React dependency. The dashboard imports
 * them to drive its React renderers; the agent can persist them in the layout DB.
 *
 * Each RendererConfig has a `type` matching a MaisieFieldType. The card
 * configurator stores a map of field key → RendererConfig in the card layout.
 */

// ── Scalar renderers ──────────────────────────────────────────────────────────

export interface StringRendererConfig {
  type: 'string'
  /** Truncate long values to this character count (default: no limit). */
  maxLength?: number
  /** Render as a monospace code span. */
  code?: boolean
}

export interface NumberRendererConfig {
  type: 'number'
  /** Decimal places (default: 2). */
  decimals?: number
  /** Text prepended before the value: "$", "≈", etc. */
  prefix?: string
  /** Text appended after the value: "ms", "rpm", etc. */
  suffix?: string
}

export interface BooleanRendererConfig {
  type: 'boolean'
  /** Label for a truthy value (default: "Yes"). */
  trueLabel?: string
  /** Label for a falsy value (default: "No"). */
  falseLabel?: string
}

export interface BytesRendererConfig {
  type: 'bytes'
  /** Force a specific unit instead of auto-scaling. */
  unit?: 'B' | 'KB' | 'MB' | 'GB' | 'TB'
}

export interface PercentageRendererConfig {
  type: 'percentage'
  /** Show a progress bar behind the number (default: true). */
  showBar?: boolean
  /** Warning threshold 0–100 — bar turns amber above this (default: 70). */
  warnAt?: number
  /** Critical threshold 0–100 — bar turns red above this (default: 90). */
  critAt?: number
}

export interface StatusRendererConfig {
  type: 'status'
  /**
   * Override the default color for specific status strings.
   * Values must map to a Tailwind semantic color name.
   */
  colorMap?: Record<string, 'green' | 'yellow' | 'red' | 'gray' | 'blue'>
}

export interface ImageRendererConfig {
  type: 'image'
  /** CSS aspect-ratio value, e.g. "16/9" (default: "auto"). */
  aspectRatio?: string
  /** CSS object-fit value (default: "cover"). */
  fit?: 'cover' | 'contain' | 'fill' | 'none'
}

export interface TimestampRendererConfig {
  type: 'timestamp'
  /** Display format (default: "relative" → "2h ago"). */
  format?: 'relative' | 'datetime' | 'date' | 'time'
}

export interface EpochMsRendererConfig {
  type: 'epoch_ms'
  /** Display format (default: "relative"). */
  format?: 'relative' | 'datetime' | 'date' | 'time'
}

export interface DurationRendererConfig {
  type: 'duration'
  /** "compact" → "2h 34m", "full" → "2 hours 34 minutes" (default: "compact"). */
  style?: 'compact' | 'full'
}

export interface ProgressRendererConfig {
  type: 'progress'
  /** Show "34/100" fraction beside the bar (default: true). */
  showFraction?: boolean
  /** Show the label string from the progress object if present (default: true). */
  showLabel?: boolean
}

export interface TemperatureRendererConfig {
  type: 'temperature'
  /** Display unit (default: "C"). */
  unit?: 'C' | 'F'
  /** Amber warning threshold in °C (default: 70). */
  warnAt?: number
  /** Red critical threshold in °C (default: 85). */
  critAt?: number
}

export interface SignalRendererConfig {
  type: 'signal'
  /**
   * Number of signal strength "bars" to render (default: 4).
   * The dBm value is divided into this many equal bands.
   */
  bars?: number
}

export interface ToggleRendererConfig {
  type: 'toggle'
  /**
   * Action id to invoke when the toggle changes. The plugin action must accept
   * { value: boolean } and be declared with http: { method: 'POST' }.
   */
  actionId?: string
}

export interface ActionRendererConfig {
  type: 'action'
  /** Button label (default: "Run"). */
  label?: string
  /**
   * If true, shows a confirm dialog before invoking (default: false).
   * Useful for destructive actions.
   */
  confirm?: boolean
  /** Confirmation message (default: "Are you sure?"). */
  confirmMessage?: string
}

export interface StreamRendererConfig {
  type: 'stream'
  /** Player variant (default: "hls"). */
  player?: 'hls' | 'webrtc' | 'mjpeg'
  /** Fixed height in pixels (default: 180). */
  height?: number
}

export interface UrlRendererConfig {
  type: 'url'
  /** Link display text (default: shows the URL). */
  label?: string
  /** Open in new tab (default: true). */
  newTab?: boolean
}

// ── Composite renderers ───────────────────────────────────────────────────────

/**
 * Config for a nested record field — controls which fields are visible
 * and their individual renderer configs.
 */
export interface RecordRendererConfig {
  type: 'record'
  /** Ordered list of field keys to display. If omitted, shows all fields. */
  fields?: string[]
  /** Per-field renderer overrides. */
  fieldConfigs?: Record<string, RendererConfig>
}

/**
 * Config for a nested collection field — controls columns and basic display.
 */
export interface CollectionRendererConfig {
  type: 'collection'
  /** Ordered list of field keys to use as columns. If omitted, uses all fields. */
  columns?: string[]
  /** Per-column renderer overrides. */
  columnConfigs?: Record<string, RendererConfig>
  /** Maximum rows to show before a "show more" prompt (default: no limit). */
  maxRows?: number
}

export interface JsonRendererConfig {
  type: 'json'
  /** Start expanded (default: false). */
  expanded?: boolean
}

// ── Union ─────────────────────────────────────────────────────────────────────

export type RendererConfig =
  | StringRendererConfig
  | NumberRendererConfig
  | BooleanRendererConfig
  | BytesRendererConfig
  | PercentageRendererConfig
  | StatusRendererConfig
  | ImageRendererConfig
  | TimestampRendererConfig
  | EpochMsRendererConfig
  | DurationRendererConfig
  | ProgressRendererConfig
  | TemperatureRendererConfig
  | SignalRendererConfig
  | ToggleRendererConfig
  | ActionRendererConfig
  | StreamRendererConfig
  | UrlRendererConfig
  | RecordRendererConfig
  | CollectionRendererConfig
  | JsonRendererConfig

/**
 * The full renderer configuration for a card — a map of field key to
 * RendererConfig. Stored in the card layout in the DB.
 */
export type CardRendererConfig = Record<string, RendererConfig>

// ── Defaults ──────────────────────────────────────────────────────────────────

/**
 * Sensible defaults for each renderer type.
 * Renderers should merge these with any stored config before rendering.
 */
export const RENDERER_DEFAULTS: { [K in RendererConfig['type']]: Extract<RendererConfig, { type: K }> } = {
  string:      { type: 'string' },
  number:      { type: 'number', decimals: 2 },
  boolean:     { type: 'boolean', trueLabel: 'Yes', falseLabel: 'No' },
  bytes:       { type: 'bytes' },
  percentage:  { type: 'percentage', showBar: true, warnAt: 70, critAt: 90 },
  status:      { type: 'status' },
  image:       { type: 'image', aspectRatio: 'auto', fit: 'cover' },
  timestamp:   { type: 'timestamp', format: 'relative' },
  epoch_ms:    { type: 'epoch_ms', format: 'relative' },
  duration:    { type: 'duration', style: 'compact' },
  progress:    { type: 'progress', showFraction: true, showLabel: true },
  temperature: { type: 'temperature', unit: 'C', warnAt: 70, critAt: 85 },
  signal:      { type: 'signal', bars: 4 },
  toggle:      { type: 'toggle' },
  action:      { type: 'action', label: 'Run', confirm: false, confirmMessage: 'Are you sure?' },
  stream:      { type: 'stream', player: 'hls', height: 180 },
  url:         { type: 'url', newTab: true },
  record:      { type: 'record' },
  collection:  { type: 'collection' },
  json:        { type: 'json', expanded: false },
}
