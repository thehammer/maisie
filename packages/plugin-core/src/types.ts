export interface WidgetDescriptor {
  id: string           // "{pluginName}.{actionName}"
  pluginName: string
  actionName: string
  label: string
  section: string
  outputFields: WidgetField[]
}

export interface WidgetField {
  key: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown'
  label: string        // prettified from key
  optional: boolean
}

export interface WidgetPlacement {
  widgetId: string     // matches WidgetDescriptor.id
  position: { row: number; col: number }
  size: { rows: number; cols: number }
  config: {
    visibleFields: string[]   // subset of outputFields keys to display
    refreshInterval?: number  // seconds
    title?: string            // override label
  }
}

// Simplified layout model used by the home dashboard.
// An ordered array of these replaces the complex WidgetPlacement grid model.
export interface WidgetConfig {
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
