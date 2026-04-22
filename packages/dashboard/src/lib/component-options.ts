/**
 * Component options registry — pure data mapping MaisieFieldType (or schema type)
 * to the available display components the wizard can offer.
 *
 * No React imports — this is serializable data only.
 */

import type { RendererConfig } from '@maisie/shared'
import type { MaisieFieldType } from '@maisie/shared'

export interface ComponentOption {
  id: string
  name: string
  emoji: string
  description: string
  defaultConfig: RendererConfig
}

// Map from MaisieFieldType (or 'collection'/'record' schemaType) to available options
export const COMPONENT_OPTIONS: Record<string, ComponentOption[]> = {
  percentage: [
    { id: 'bar', name: 'Progress Bar', emoji: '▬', description: 'Colored bar with percentage', defaultConfig: { type: 'percentage', style: 'bar' } },
    { id: 'gauge', name: 'Gauge', emoji: '◑', description: 'Semi-circle arc gauge', defaultConfig: { type: 'gauge' } },
    { id: 'text', name: 'Text', emoji: '%', description: 'Plain percentage text', defaultConfig: { type: 'percentage', style: 'text' } },
  ],
  number: [
    { id: 'number', name: 'Number', emoji: '#', description: 'Formatted number', defaultConfig: { type: 'number' } },
  ],
  string: [
    { id: 'text', name: 'Text', emoji: 'Aa', description: 'Plain text', defaultConfig: { type: 'string' } },
    { id: 'code', name: 'Code', emoji: '<>', description: 'Monospace code', defaultConfig: { type: 'string', code: true } },
  ],
  status: [
    { id: 'badge', name: 'Badge', emoji: 'S', description: 'Colored status badge', defaultConfig: { type: 'status' } },
  ],
  boolean: [
    { id: 'boolean', name: 'Yes/No', emoji: 'Y', description: 'Yes or No label', defaultConfig: { type: 'boolean' } },
    { id: 'toggle', name: 'Toggle', emoji: 'T', description: 'Interactive toggle switch', defaultConfig: { type: 'toggle' } },
  ],
  timestamp: [
    { id: 'relative', name: 'Relative', emoji: 'R', description: '2 hours ago', defaultConfig: { type: 'timestamp', format: 'relative' } },
    { id: 'datetime', name: 'Date & Time', emoji: 'D', description: 'Full date and time', defaultConfig: { type: 'timestamp', format: 'datetime' } },
    { id: 'date', name: 'Date', emoji: 'd', description: 'Date only', defaultConfig: { type: 'timestamp', format: 'date' } },
  ],
  bytes: [
    { id: 'bytes', name: 'File Size', emoji: 'B', description: 'Auto-scaled (KB/MB/GB)', defaultConfig: { type: 'bytes' } },
  ],
  duration: [
    { id: 'compact', name: 'Compact', emoji: 'm', description: '2h 34m', defaultConfig: { type: 'duration', style: 'compact' } },
    { id: 'full', name: 'Full', emoji: 'h', description: '2 hours 34 minutes', defaultConfig: { type: 'duration', style: 'full' } },
  ],
  image: [
    { id: 'image', name: 'Thumbnail', emoji: 'I', description: 'Image thumbnail', defaultConfig: { type: 'image' } },
  ],
  temperature: [
    { id: 'temperature', name: 'Temperature', emoji: 'C', description: 'With color thresholds', defaultConfig: { type: 'temperature', unit: 'F' } },
  ],
  signal: [
    { id: 'signal', name: 'Signal Bars', emoji: '|', description: 'Signal strength bars', defaultConfig: { type: 'signal' } },
  ],
  toggle: [
    { id: 'toggle', name: 'Toggle', emoji: 'T', description: 'Interactive toggle', defaultConfig: { type: 'toggle' } },
  ],
  action: [
    { id: 'action', name: 'Button', emoji: '>', description: 'Clickable action button', defaultConfig: { type: 'action' } },
  ],
  // Collection-level display styles (not field-level renderers)
  collection: [
    { id: 'card-list', name: 'Card List', emoji: 'C', description: 'Thumbnail + title + metadata', defaultConfig: { type: 'collection' } },
    { id: 'table', name: 'Table', emoji: 'T', description: 'Columns and rows', defaultConfig: { type: 'collection' } },
    { id: 'simple-list', name: 'Simple List', emoji: 'L', description: 'Just the titles, clean and minimal', defaultConfig: { type: 'collection' } },
  ],
  record: [
    { id: 'fields', name: 'Fields', emoji: 'F', description: 'Label-value pairs', defaultConfig: { type: 'record' } },
  ],
  // Function fields — no-arg zero-param default; see getFunctionComponentOptions for signature-aware options
  function: [
    { id: 'button', name: 'Button', emoji: '>', description: 'Click to invoke', defaultConfig: { type: 'action' } },
  ],
}

export function getComponentOptions(maisieType: MaisieFieldType | string | null): ComponentOption[] {
  if (!maisieType) return []
  return COMPONENT_OPTIONS[maisieType] ?? []
}

/**
 * Returns component options for a function field based on its parameter signature.
 * Slider and text-input are future work — for now they fall back to Button.
 */
export function getFunctionComponentOptions(field: {
  kind: 'function'
  params?: Array<{ name: string; type: string }>
  returnType?: string
}): ComponentOption[] {
  const params = field.params ?? []
  if (params.length === 0) {
    const options: ComponentOption[] = [
      { id: 'button', name: 'Button', emoji: '>', description: 'Click to invoke', defaultConfig: { type: 'action' } },
    ]
    if (field.returnType === 'boolean') {
      options.push({ id: 'toggle', name: 'Toggle', emoji: 'T', description: 'On/off switch', defaultConfig: { type: 'toggle' } })
    }
    return options
  }
  if (params.length === 1) {
    const p = params[0]
    if (p.type === 'number') {
      // Slider is future work — render as button for now
      return [{ id: 'button', name: 'Button', emoji: '>', description: 'Click to invoke (slider: future)', defaultConfig: { type: 'action' } }]
    }
    if (p.type === 'string') {
      // Text-input is future work — render as button for now
      return [{ id: 'button', name: 'Button', emoji: '>', description: 'Click to invoke (text-input: future)', defaultConfig: { type: 'action' } }]
    }
    return [{ id: 'button', name: 'Button', emoji: '>', description: 'Click to invoke', defaultConfig: { type: 'action' } }]
  }
  // Multi-param: form is future work — render as button for now
  return [{ id: 'button', name: 'Button', emoji: '>', description: 'Click to invoke (form: future)', defaultConfig: { type: 'action' } }]
}
