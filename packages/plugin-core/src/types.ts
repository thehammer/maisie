export interface CardDescriptor {
  id: string           // "{pluginName}.{actionName}" for plugin entities; entity name for derived
  pluginName?: string  // undefined for derived entities
  actionName: string
  label: string
  section: string
  /** Overall shape of the action output — drives card builder affordances. */
  schemaType: import('@maisie/shared').MaisieSchemaType
  outputFields: CardField[]
}

export interface CardField {
  key: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown'
  /** Semantic rendering hint from the field() annotation. null if unannotated. */
  maisieType: import('@maisie/shared').MaisieFieldType | null
  label: string        // prettified from key
  optional: boolean
}

export interface CardPlacement {
  cardId: string       // matches CardDescriptor.id
  position: { row: number; col: number }
  size: { rows: number; cols: number }
  config: {
    visibleFields: string[]   // subset of outputFields keys to display
    refreshInterval?: number  // seconds
    title?: string            // override label
  }
}

// Simplified layout model used by the home dashboard.
// An ordered array of these replaces the complex CardPlacement grid model.
export interface CardConfig {
  id: string          // stable card ID, e.g. "NetworkCard", "BambuCard"
  visible: boolean
  col_span: 1 | 2    // 1 = normal, 2 = full-width (.card.wide)
  order: number       // 0-based sort position; array kept sorted by this
  // ── Card configurator fields (optional — absent until user configures) ────
  /** Override the card's default title. */
  title?: string
  /** Ordered subset of output field keys to display. If omitted, show all. */
  visibleFields?: string[]
  /** OpConfig pipeline — applied to collection data before rendering. */
  ops?: import('@maisie/shared').OpConfig[]
  /** Per-field renderer overrides. */
  rendererConfigs?: import('@maisie/shared').CardRendererConfig
  /** Compound card — sections that each render a field from the response. */
  sections?: import('@maisie/shared').SectionConfig[]
  /** Collection display layout chosen by the wizard. */
  displayStyle?: 'table' | 'card-list' | 'simple-list'
  /** Component name to use for rendering. If set, delegates to ComponentRenderer. */
  component?: string
  /** Props passed to the component when `component` is set. */
  componentProps?: Record<string, unknown>
}

export interface PersonaConfig {
  id: string
  name: string
  role: string
  avatar?: string
  defaultTier: 'inform' | 'advise' | 'act'
  eventSubscriptions: string[]
  toolScopes: string[]
  systemPrompt: string
  isCustom: boolean
}
