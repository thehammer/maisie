/**
 * Component Registry — base components and layout primitives.
 *
 * Every component definition here has three responsibilities:
 *   1. Declare a typed input contract (what data it accepts)
 *   2. Declare props (configuration knobs)
 *   3. Document its rendering semantics
 *
 * BASE_COMPONENTS render a typed data value. LAYOUT_PRIMITIVES are structural
 * containers — they take children, not a data value.
 *
 * Adding a component here is a deliberate protocol change. The vocabulary is
 * finite by design; generic rendering is only possible when the set is closed.
 */

// ── Type expression vocabulary ─────────────────────────────────────────────

/**
 * TypeExpr — the type language for component input/prop contracts.
 *
 * Intentionally minimal: only the distinctions the rendering framework
 * actually needs are expressed here.
 */
export type TypeExpr =
  | { kind: 'any' }
  | { kind: 'scalar'; type: 'string' | 'number' | 'boolean' }
  | { kind: 'collection'; element: TypeExpr }
  | { kind: 'component'; input: TypeExpr }

// ── Component definition types ─────────────────────────────────────────────

/** A single configurable prop on a component. */
export interface PropDef {
  type: TypeExpr
  /** Default value used when the prop is not supplied. */
  default?: unknown
  /** Human-readable explanation of what this prop controls. */
  description?: string
}

/** A component definition — the platform contract for one renderable unit. */
export interface ComponentDef {
  name: string
  kind: 'base' | 'layout'
  /** Describes rendering semantics and usage. Required. */
  description: string
  /** The data type this component renders. Absent for layout primitives. */
  input?: TypeExpr
  /** Named configuration props, separate from the data input. */
  props?: Record<string, PropDef>
}

// ── Base components ────────────────────────────────────────────────────────

/**
 * BASE_COMPONENTS — components that render a typed data value.
 *
 * Each entry renders one semantically distinct thing. The name is stable and
 * used as the component identifier in the registry, in action ui.componentHint,
 * and in pipeline render expressions.
 *
 * Adding or removing entries is a protocol change.
 */
export const BASE_COMPONENTS: Record<string, ComponentDef> = {
  text: {
    name: 'text',
    kind: 'base',
    description: 'Plain text value. Renders a string as-is.',
    input: { kind: 'scalar', type: 'string' },
  },

  number: {
    name: 'number',
    kind: 'base',
    description: 'Raw numeric value. No unit suffix or formatting applied.',
    input: { kind: 'scalar', type: 'number' },
    props: {
      precision: {
        type: { kind: 'scalar', type: 'number' },
        default: 0,
        description: 'Decimal places to display',
      },
    },
  },

  boolean: {
    name: 'boolean',
    kind: 'base',
    description: 'Boolean flag. Renders as Yes / No.',
    input: { kind: 'scalar', type: 'boolean' },
  },

  bytes: {
    name: 'bytes',
    kind: 'base',
    description: 'Storage or transfer size in bytes. Renders with unit suffix: "1.2 GB".',
    input: { kind: 'scalar', type: 'number' },
  },

  percentage: {
    name: 'percentage',
    kind: 'base',
    description: 'A 0–100 percentage value. Renders as a progress bar or inline gauge.',
    input: { kind: 'scalar', type: 'number' },
  },

  status: {
    name: 'status',
    kind: 'base',
    description:
      'Named state from the shared MaisieStatus vocabulary. Renders as a colored badge. ' +
      'Values: ok, warning, error, idle, busy, unknown.',
    input: { kind: 'scalar', type: 'string' },
  },

  image: {
    name: 'image',
    kind: 'base',
    description: 'Image URL. Renders as a thumbnail <img>.',
    input: { kind: 'scalar', type: 'string' },
    props: {
      width: {
        type: { kind: 'scalar', type: 'number' },
        default: 64,
        description: 'Display width in pixels',
      },
      height: {
        type: { kind: 'scalar', type: 'number' },
        default: 64,
        description: 'Display height in pixels',
      },
      alt: {
        type: { kind: 'scalar', type: 'string' },
        description: 'Alt text for accessibility',
      },
    },
  },

  timestamp: {
    name: 'timestamp',
    kind: 'base',
    description: 'ISO 8601 datetime string. Renders as relative time: "2h ago".',
    input: { kind: 'scalar', type: 'string' },
  },

  duration: {
    name: 'duration',
    kind: 'base',
    description: 'Elapsed time in seconds. Renders as "2h 34m".',
    input: { kind: 'scalar', type: 'number' },
  },

  temperature: {
    name: 'temperature',
    kind: 'base',
    description:
      'Temperature in Celsius. Renders as "72°C" with threshold-based color treatment.',
    input: { kind: 'scalar', type: 'number' },
    props: {
      warnAt: {
        type: { kind: 'scalar', type: 'number' },
        default: 70,
        description: 'Degrees Celsius above which the value renders as warning',
      },
      critAt: {
        type: { kind: 'scalar', type: 'number' },
        default: 90,
        description: 'Degrees Celsius above which the value renders as critical',
      },
    },
  },

  signal: {
    name: 'signal',
    kind: 'base',
    description: 'Signal strength in dBm. Renders as a segmented signal-strength indicator.',
    input: { kind: 'scalar', type: 'number' },
  },

  gauge: {
    name: 'gauge',
    kind: 'base',
    description:
      'Arc-style gauge for a bounded numeric value. Renders as a partial-circle meter.',
    input: { kind: 'scalar', type: 'number' },
    props: {
      min: {
        type: { kind: 'scalar', type: 'number' },
        default: 0,
        description: 'Minimum of the display range',
      },
      max: {
        type: { kind: 'scalar', type: 'number' },
        default: 100,
        description: 'Maximum of the display range',
      },
    },
  },

  progress: {
    name: 'progress',
    kind: 'base',
    description:
      'A { current, total, label? } progress object. Renders as a labeled progress bar ' +
      'showing both the fraction and an optional text label.',
    // input is a record: { current: number, total: number, label?: string }
    // Expressed as 'any' until the TypeExpr vocab gains record shapes.
    input: { kind: 'any' },
  },

  url: {
    name: 'url',
    kind: 'base',
    description: 'A URL string. Renders as a clickable <a> link.',
    input: { kind: 'scalar', type: 'string' },
    props: {
      label: {
        type: { kind: 'scalar', type: 'string' },
        description: 'Display text for the link; defaults to the URL itself',
      },
      newTab: {
        type: { kind: 'scalar', type: 'boolean' },
        default: true,
        description: 'Open in a new tab',
      },
    },
  },

  toggle: {
    name: 'toggle',
    kind: 'base',
    description:
      'Boolean with write capability. Renders as a toggle switch. ' +
      'Requires an onToggle prop wired to a set_ action.',
    input: { kind: 'scalar', type: 'boolean' },
    props: {
      disabled: {
        type: { kind: 'scalar', type: 'boolean' },
        default: false,
        description: 'Render the toggle as non-interactive',
      },
    },
  },

  button: {
    name: 'button',
    kind: 'base',
    description:
      'An action trigger. Renders as a button. Wired to an invoke_ action via the ' +
      'onPress prop.',
    input: { kind: 'any' },
    props: {
      label: {
        type: { kind: 'scalar', type: 'string' },
        description: 'Button label text',
      },
      variant: {
        type: { kind: 'scalar', type: 'string' },
        default: 'default',
        description: 'Visual variant: default, destructive, ghost',
      },
    },
  },

  json: {
    name: 'json',
    kind: 'base',
    description: 'Untyped structured data. Renders as a collapsible JSON viewer.',
    input: { kind: 'any' },
    props: {
      expanded: {
        type: { kind: 'scalar', type: 'boolean' },
        default: false,
        description: 'Whether the viewer starts in expanded state',
      },
    },
  },

  carousel: {
    name: 'carousel',
    kind: 'base',
    description:
      'Animation-loop horizontal scroll. Base component — imperative RAF rendering ' +
      'semantics. Takes a list and a tile component; renders a continuously scrolling strip. ' +
      'Current implementation: static horizontal list (stub). Full RAF implementation pending.',
    input: { kind: 'collection', element: { kind: 'any' } },
    props: {
      itemComponent: {
        type: { kind: 'component', input: { kind: 'any' } },
        description: 'Component to render each item in the carousel',
      },
      speed: {
        type: { kind: 'scalar', type: 'number' },
        default: 0.3,
        description: 'Scroll speed in pixels per animation frame',
      },
      cardWidth: {
        type: { kind: 'scalar', type: 'number' },
        default: 80,
        description: 'Width of each card in pixels',
      },
      cardGap: {
        type: { kind: 'scalar', type: 'number' },
        default: 10,
        description: 'Gap between cards in pixels',
      },
    },
  },
}

// ── Layout primitives ──────────────────────────────────────────────────────

/**
 * LAYOUT_PRIMITIVES — structural containers that take children, not a data value.
 *
 * Primitives have no input type. They compose other components. Anything more
 * specific that can be expressed declaratively as a composition of these
 * primitives belongs in userland as a derived component, not here.
 *
 * Exception: imperative rendering semantics. See docs/components.md.
 */
export const LAYOUT_PRIMITIVES: Record<string, ComponentDef> = {
  stack: {
    name: 'stack',
    kind: 'layout',
    description: 'Vertical flex container. Children are stacked top-to-bottom.',
    props: {
      gap: {
        type: { kind: 'scalar', type: 'number' },
        default: 8,
        description: 'Gap between children in pixels',
      },
      align: {
        type: { kind: 'scalar', type: 'string' },
        default: 'stretch',
        description: 'Cross-axis alignment: start, center, end, stretch',
      },
    },
  },

  row: {
    name: 'row',
    kind: 'layout',
    description: 'Horizontal flex container. Children are laid out left-to-right.',
    props: {
      gap: {
        type: { kind: 'scalar', type: 'number' },
        default: 8,
        description: 'Gap between children in pixels',
      },
      align: {
        type: { kind: 'scalar', type: 'string' },
        default: 'center',
        description: 'Cross-axis alignment: start, center, end, stretch',
      },
      wrap: {
        type: { kind: 'scalar', type: 'boolean' },
        default: false,
        description: 'Whether children wrap to the next line',
      },
    },
  },

  grid: {
    name: 'grid',
    kind: 'layout',
    description: 'CSS grid container. Children are placed into a fixed column grid.',
    props: {
      columns: {
        type: { kind: 'scalar', type: 'number' },
        default: 2,
        description: 'Number of equal-width columns',
      },
      gap: {
        type: { kind: 'scalar', type: 'number' },
        default: 8,
        description: 'Gap between cells in pixels',
      },
    },
  },

  overlay: {
    name: 'overlay',
    kind: 'layout',
    description:
      'Absolute-positioned stacking container. Children are placed on top of each ' +
      'other in z-order.',
  },

  scroll: {
    name: 'scroll',
    kind: 'layout',
    description: 'Scrollable overflow container. Children overflow and scroll rather than wrap.',
    props: {
      direction: {
        type: { kind: 'scalar', type: 'string' },
        default: 'vertical',
        description: 'Scroll axis: vertical, horizontal, both',
      },
    },
  },

  card: {
    name: 'card',
    kind: 'layout',
    description:
      'Elevated card container with background, border, and padding. The standard ' +
      'dashboard panel wrapper.',
    props: {
      title: {
        type: { kind: 'scalar', type: 'string' },
        description: 'Optional card header title',
      },
      padding: {
        type: { kind: 'scalar', type: 'number' },
        default: 16,
        description: 'Inner padding in pixels',
      },
    },
  },

  spacer: {
    name: 'spacer',
    kind: 'layout',
    description:
      'Flexible space filler. In a flex container, grows to consume available space.',
    props: {
      size: {
        type: { kind: 'scalar', type: 'number' },
        description:
          'Fixed size in pixels. If omitted, grows to fill available space (flex: 1).',
      },
    },
  },
}
