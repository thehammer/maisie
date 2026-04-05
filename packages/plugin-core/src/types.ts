export interface CardDescriptor {
  id: string           // "{pluginName}.{actionName}"
  pluginName: string
  actionName: string
  label: string
  section: string
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
