import type { ComponentDef } from '@maisie/shared'

export const BASE_COMPONENTS: Record<string, ComponentDef> = {
  text: {
    name: 'text',
    kind: 'base',
    description: 'Plain text rendering of a string value.',
    input: { kind: 'scalar', type: 'string' },
    props: {
      maxLength: { type: { kind: 'scalar', type: 'number' }, description: 'Truncate after this many chars' },
      code: { type: { kind: 'scalar', type: 'boolean' }, default: false, description: 'Render as monospace' },
    },
  },
  number: {
    name: 'number',
    kind: 'base',
    description: 'Formatted number with optional prefix/suffix.',
    input: { kind: 'scalar', type: 'number' },
    props: {
      decimals: { type: { kind: 'scalar', type: 'number' }, default: 2 },
      prefix: { type: { kind: 'scalar', type: 'string' }, default: '' },
      suffix: { type: { kind: 'scalar', type: 'string' }, default: '' },
    },
  },
  boolean: {
    name: 'boolean',
    kind: 'base',
    input: { kind: 'scalar', type: 'boolean' },
    props: {
      trueLabel: { type: { kind: 'scalar', type: 'string' }, default: 'Yes' },
      falseLabel: { type: { kind: 'scalar', type: 'string' }, default: 'No' },
    },
  },
  bytes: {
    name: 'bytes',
    kind: 'base',
    input: { kind: 'scalar', type: 'bytes' },
  },
  percentage: {
    name: 'percentage',
    kind: 'base',
    input: { kind: 'scalar', type: 'percentage' },
    props: {
      style: { type: { kind: 'scalar', type: 'string' }, default: 'bar' },
      warnAt: { type: { kind: 'scalar', type: 'number' }, default: 70 },
      critAt: { type: { kind: 'scalar', type: 'number' }, default: 90 },
    },
  },
  status: {
    name: 'status',
    kind: 'base',
    input: { kind: 'scalar', type: 'status' },
  },
  image: {
    name: 'image',
    kind: 'base',
    input: { kind: 'scalar', type: 'image' },
    props: {
      aspectRatio: { type: { kind: 'scalar', type: 'string' }, default: 'auto' },
      fit: { type: { kind: 'scalar', type: 'string' }, default: 'cover' },
    },
  },
  timestamp: {
    name: 'timestamp',
    kind: 'base',
    input: { kind: 'scalar', type: 'timestamp' },
    props: {
      format: { type: { kind: 'scalar', type: 'string' }, default: 'relative' },
    },
  },
  duration: {
    name: 'duration',
    kind: 'base',
    input: { kind: 'scalar', type: 'duration' },
    props: {
      style: { type: { kind: 'scalar', type: 'string' }, default: 'compact' },
    },
  },
  temperature: {
    name: 'temperature',
    kind: 'base',
    input: { kind: 'scalar', type: 'temperature' },
    props: {
      unit: { type: { kind: 'scalar', type: 'string' }, default: 'C' },
    },
  },
  signal: {
    name: 'signal',
    kind: 'base',
    input: { kind: 'scalar', type: 'signal' },
    props: {
      bars: { type: { kind: 'scalar', type: 'number' }, default: 4 },
    },
  },
  gauge: {
    name: 'gauge',
    kind: 'base',
    description: 'SVG semi-circle gauge.',
    input: { kind: 'scalar', type: 'number' },
    props: {
      warnAt: { type: { kind: 'scalar', type: 'number' }, default: 70 },
      critAt: { type: { kind: 'scalar', type: 'number' }, default: 90 },
      label: { type: { kind: 'scalar', type: 'string' } },
    },
  },
  progress: {
    name: 'progress',
    kind: 'base',
    input: { kind: 'scalar', type: 'progress' },
  },
  url: {
    name: 'url',
    kind: 'base',
    input: { kind: 'scalar', type: 'url' },
    props: {
      label: { type: { kind: 'scalar', type: 'string' } },
      newTab: { type: { kind: 'scalar', type: 'boolean' }, default: true },
    },
  },
  toggle: {
    name: 'toggle',
    kind: 'base',
    description: 'Interactive on/off switch for boolean-like state.',
    input: { kind: 'scalar', type: 'boolean' },
    props: {
      writeEndpoint: { type: { kind: 'scalar', type: 'string' } },
      payloadField: { type: { kind: 'scalar', type: 'string' } },
    },
  },
  button: {
    name: 'button',
    kind: 'base',
    description: 'Clickable button that invokes a function.',
    input: { kind: 'function', params: [], returns: { kind: 'any' } },
    props: {
      label: { type: { kind: 'scalar', type: 'string' }, default: 'Run' },
      confirm: { type: { kind: 'scalar', type: 'boolean' }, default: false },
    },
  },
  json: {
    name: 'json',
    kind: 'base',
    input: { kind: 'any' },
    props: {
      expanded: { type: { kind: 'scalar', type: 'boolean' }, default: false },
    },
  },
}

export function getBaseComponent(name: string): ComponentDef | undefined {
  return BASE_COMPONENTS[name]
}

export function listBaseComponents(): ComponentDef[] {
  return Object.values(BASE_COMPONENTS)
}
