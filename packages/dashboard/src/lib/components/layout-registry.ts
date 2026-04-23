import type { ComponentDef } from '@maisie/shared'

export const LAYOUT_PRIMITIVES: Record<string, ComponentDef> = {
  stack: {
    name: 'stack',
    kind: 'layout',
    description: 'Vertical stack of children.',
    props: {
      children: { type: { kind: 'collection', element: { kind: 'component' } } },
      gap: { type: { kind: 'scalar', type: 'number' }, default: 8 },
      padding: { type: { kind: 'scalar', type: 'number' }, default: 0 },
      align: { type: { kind: 'scalar', type: 'string' }, default: 'stretch' },
      fit: { type: { kind: 'scalar', type: 'string' }, default: 'content' },
    },
  },
  row: {
    name: 'row',
    kind: 'layout',
    description: 'Horizontal row of children.',
    props: {
      children: { type: { kind: 'collection', element: { kind: 'component' } } },
      gap: { type: { kind: 'scalar', type: 'number' }, default: 8 },
      padding: { type: { kind: 'scalar', type: 'number' }, default: 0 },
      align: { type: { kind: 'scalar', type: 'string' }, default: 'stretch' },
    },
  },
  grid: {
    name: 'grid',
    kind: 'layout',
    description: 'Two-dimensional grid of children.',
    props: {
      children: { type: { kind: 'collection', element: { kind: 'component' } } },
      columns: { type: { kind: 'scalar', type: 'number' }, default: 3 },
      gap: { type: { kind: 'scalar', type: 'number' }, default: 8 },
      padding: { type: { kind: 'scalar', type: 'number' }, default: 0 },
    },
  },
  overlay: {
    name: 'overlay',
    kind: 'layout',
    description: 'Children stacked in Z-order with optional anchors.',
    props: {
      children: { type: { kind: 'collection', element: { kind: 'component' } } },
    },
  },
  scroll: {
    name: 'scroll',
    kind: 'layout',
    description: 'Scrollable container.',
    props: {
      children: { type: { kind: 'collection', element: { kind: 'component' } } },
      direction: { type: { kind: 'scalar', type: 'string' }, default: 'vertical' },
      gap: { type: { kind: 'scalar', type: 'number' }, default: 8 },
      padding: { type: { kind: 'scalar', type: 'number' }, default: 0 },
    },
  },
  card: {
    name: 'card',
    kind: 'layout',
    description: 'Bordered container with optional title.',
    props: {
      children: { type: { kind: 'collection', element: { kind: 'component' } } },
      title: { type: { kind: 'scalar', type: 'string' } },
      padding: { type: { kind: 'scalar', type: 'number' }, default: 12 },
    },
  },
  spacer: {
    name: 'spacer',
    kind: 'layout',
    description: 'Empty space for alignment.',
    props: {
      size: { type: { kind: 'scalar', type: 'number' } },
      flex: { type: { kind: 'scalar', type: 'number' }, default: 1 },
    },
  },
}

export function getLayoutPrimitive(name: string): ComponentDef | undefined {
  return LAYOUT_PRIMITIVES[name]
}

export function listLayoutPrimitives(): ComponentDef[] {
  return Object.values(LAYOUT_PRIMITIVES)
}

export function isLayoutPrimitive(name: string): boolean {
  return name in LAYOUT_PRIMITIVES
}
