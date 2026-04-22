import { z } from 'zod'
import { defineAction } from '@maisie/shared'
import type { MaisiePlugin, MaisieCore } from '@maisie/shared'
import { introspectSchema } from './schema-introspector'
import type { CardDescriptor, CardPlacement, CardConfig, PersonaConfig } from './types'
import { createLayoutService } from './layout-service'
import type { LayoutService } from './layout-service'
import { entityRegistry } from './entity-registry'
import { registry } from './registry'

// ----------------------------------------------------------------
// Module-level state — injected by plugin init()
// ----------------------------------------------------------------

let _db: import('drizzle-orm/bun-sqlite').BunSQLiteDatabase<Record<string, never>> | null = null
let _loadedPlugins: MaisiePlugin[] = []
let _layout: LayoutService | null = null
let _core: MaisieCore | null = null

export function setDb(db: unknown) {
  _db = db as typeof _db
  _layout = createLayoutService(_db as any)
}

export function setPlugins(plugins: MaisiePlugin[]) {
  _loadedPlugins = plugins
  // Phase 2a bridge: register all plugins into the singleton PluginRegistry so that
  // getCardCatalog (which now queries entityRegistry + registry) works whether plugins
  // were loaded via the real boot path or injected directly in tests.
  for (const plugin of plugins) {
    registry.register(plugin, () => {})
  }
}

export function setCore(core: MaisieCore) {
  _core = core
}

// ----------------------------------------------------------------
// Zod schemas for outputs
// ----------------------------------------------------------------

const pluginSummarySchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  capabilities: z.array(z.string()),
  actionCount: z.number(),
  health: z.object({
    status: z.enum(['healthy', 'degraded', 'offline']),
    message: z.string().optional(),
    lastCheck: z.string(),
  }),
})

const personaConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  avatar: z.string().optional(),
  defaultTier: z.enum(['inform', 'advise', 'act']),
  eventSubscriptions: z.array(z.string()),
  toolScopes: z.array(z.string()),
  systemPrompt: z.string(),
  isCustom: z.boolean(),
})

const cardFieldSchema = z.object({
  key: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object', 'unknown']),
  maisieType: z.string().nullable(),
  label: z.string(),
  optional: z.boolean(),
})

const cardDescriptorSchema = z.object({
  id: z.string(),
  pluginName: z.string().optional(),  // undefined for derived entities
  actionName: z.string(),
  label: z.string(),
  section: z.string(),
  schemaType: z.enum(['scalar', 'record', 'collection', 'json']),
  outputFields: z.array(cardFieldSchema),
})

const cardPlacementSchema = z.object({
  cardId: z.string(),
  position: z.object({ row: z.number(), col: z.number() }),
  size: z.object({ rows: z.number(), cols: z.number() }),
  config: z.object({
    visibleFields: z.array(z.string()),
    refreshInterval: z.number().optional(),
    title: z.string().optional(),
  }),
})

const cardConfigSchema = z.object({
  id: z.string(),
  visible: z.boolean(),
  col_span: z.union([z.literal(1), z.literal(2)]),
  order: z.number().int().min(0),
})

// ----------------------------------------------------------------
// Helpers — DB access with lazy import to avoid circular deps
// ----------------------------------------------------------------

async function getSchema() {
  const { personaConfigs, dashboardLayouts, pluginConfigs, cardTemplates } = await import(
    '../../../packages/agent/src/services/schema'
  )
  return { personaConfigs, dashboardLayouts, pluginConfigs, cardTemplates }
}

function requireDb() {
  if (!_db) throw new Error('plugin-core: database not initialized')
  return _db
}

function requireLayout() {
  if (!_layout) throw new Error('plugin-core: layout service not initialized')
  return _layout
}

// ----------------------------------------------------------------
// Plugin Management
// ----------------------------------------------------------------

export const listPlugins = defineAction({
  name: 'list_plugins',
  description: 'List all discovered Maisie plugins with their version, capabilities, and health status.',
  input: z.object({}),
  output: z.array(pluginSummarySchema),
  http: { method: 'GET', path: '/api/plugins' },
  ai: { tier: 'inform' },
  ui: { label: 'Installed Plugins', section: 'system' },
  async execute(_input, _ctx) {
    const results = await Promise.all(
      _loadedPlugins.map(async (p) => {
        let health: z.infer<typeof pluginSummarySchema>['health']
        try {
          const h = await p.healthCheck()
          health = {
            status: h.status,
            message: h.message,
            lastCheck: h.lastCheck.toISOString(),
          }
        } catch {
          health = { status: 'offline', message: 'healthCheck() threw', lastCheck: new Date().toISOString() }
        }
        return {
          name: p.name,
          version: p.version,
          description: p.description,
          capabilities: p.capabilities as string[],
          actionCount: p.actions.length,
          health,
        }
      }),
    )
    return results
  },
})

export const installPlugin = defineAction({
  name: 'install_plugin',
  description: 'Install a new Maisie plugin from npm by package name. Requires a restart to take effect.',
  input: z.object({
    packageName: z.string().min(1),
  }),
  output: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  http: { method: 'POST', path: '/api/plugins/install' },
  ai: { tier: 'advise', description: 'Install a new Maisie plugin from npm' },
  ui: { label: 'Install Plugin', section: 'system' },
  async execute(input, _ctx) {
    // Validate package name looks sane — no shell injection
    const valid = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@.+)?$/.test(
      input.packageName,
    )
    if (!valid) {
      throw new Error(`Invalid package name: ${input.packageName}`)
    }

    // TODO: implement subprocess install via `bun add {packageName}` followed
    // by plugin rediscovery. Marked as TODO because the subprocess interaction
    // (stdout/stderr streaming, restart coordination) is out of scope for the
    // initial plugin-core implementation.
    return {
      success: false,
      message: `install_plugin is not yet implemented. Run: bun add ${input.packageName} then restart the agent.`,
    }
  },
})

export const configurePlugin = defineAction({
  name: 'configure_plugin',
  description: 'Store environment variable overrides or enable/disable a plugin by name.',
  input: z.object({
    name: z.string(),
    envOverrides: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
  }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'PATCH', path: '/api/plugins/:name' },
  ai: { tier: 'advise' },
  ui: { label: 'Configure Plugin', section: 'system' },
  async execute(input, _ctx) {
    const db = requireDb()
    const { pluginConfigs } = await getSchema()
    const { eq } = await import('drizzle-orm')
    const { randomUUID } = await import('crypto')

    const existing = await db
      .select()
      .from(pluginConfigs)
      .where(eq(pluginConfigs.packageName, input.name))
      .get()

    if (existing) {
      await db
        .update(pluginConfigs)
        .set({
          ...(input.envOverrides !== undefined && {
            envOverrides: JSON.stringify(input.envOverrides),
          }),
          ...(input.enabled !== undefined && { enabled: input.enabled }),
          updatedAt: new Date(),
        })
        .where(eq(pluginConfigs.packageName, input.name))
    } else {
      await db.insert(pluginConfigs).values({
        id: randomUUID(),
        packageName: input.name,
        enabled: input.enabled ?? true,
        envOverrides: JSON.stringify(input.envOverrides ?? {}),
        updatedAt: new Date(),
      })
    }

    // Apply env overrides immediately and reinit the plugin live so no restart required.
    if (input.envOverrides && _core) {
      const plugin = _loadedPlugins.find((p) => p.name === input.name)
      if (plugin) {
        for (const [k, v] of Object.entries(input.envOverrides)) {
          if (v) process.env[k] = v
        }
        try {
          if (plugin.shutdown) await plugin.shutdown()
        } catch {
          // ignore shutdown errors during reinit
        }
        try {
          await plugin.init(_core)
        } catch (err) {
          _core.log(input.name, 'warn', `Reinit after configure failed: ${err instanceof Error ? err.message : err}`)
        }
      }
    }

    return { success: true }
  },
})

export const uninstallPlugin = defineAction({
  name: 'uninstall_plugin',
  description: 'Remove a plugin by name. This only removes its config record — the package must be removed manually.',
  input: z.object({ name: z.string() }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'DELETE', path: '/api/plugins/:name' },
  ai: { tier: 'advise' },
  ui: false,
  async execute(input, _ctx) {
    const db = requireDb()
    const { pluginConfigs } = await getSchema()
    const { eq } = await import('drizzle-orm')
    await db.delete(pluginConfigs).where(eq(pluginConfigs.packageName, input.name))
    return { success: true }
  },
})

export const checkPluginHealth = defineAction({
  name: 'check_plugin_health',
  description: 'Run the healthCheck() for a loaded plugin by name and return the result.',
  input: z.object({ name: z.string() }),
  output: z.object({
    status: z.enum(['healthy', 'degraded', 'offline']),
    message: z.string().optional(),
    lastCheck: z.string(),
  }),
  http: { method: 'GET', path: '/api/plugins/:name/health' },
  ai: { tier: 'inform' },
  ui: false,
  async execute(input, _ctx) {
    const plugin = _loadedPlugins.find((p) => p.name === input.name)
    if (!plugin) throw new Error(`Plugin not found: ${input.name}`)
    const h = await plugin.healthCheck()
    return {
      status: h.status,
      message: h.message,
      lastCheck: h.lastCheck.toISOString(),
    }
  },
})

// ----------------------------------------------------------------
// Persona Management
// ----------------------------------------------------------------

function builtInPersonas(): PersonaConfig[] {
  const seen = new Set<string>()
  const personas: PersonaConfig[] = []
  for (const plugin of _loadedPlugins) {
    if (plugin.persona && !seen.has(plugin.persona.name)) {
      seen.add(plugin.persona.name)
      personas.push({
        id: `builtin:${plugin.persona.name}`,
        name: plugin.persona.name,
        role: plugin.persona.role,
        avatar: plugin.persona.avatar,
        defaultTier: plugin.persona.defaultTier,
        eventSubscriptions: plugin.persona.eventSubscriptions,
        toolScopes: plugin.persona.toolScopes,
        systemPrompt: plugin.persona.systemPrompt,
        isCustom: false,
      })
    }
  }
  return personas
}

async function dbPersonas(): Promise<PersonaConfig[]> {
  const db = requireDb()
  const { personaConfigs } = await getSchema()
  const rows = await db.select().from(personaConfigs).all()
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    avatar: r.avatar ?? undefined,
    defaultTier: r.defaultTier as PersonaConfig['defaultTier'],
    eventSubscriptions: JSON.parse(r.eventSubscriptions),
    toolScopes: JSON.parse(r.toolScopes),
    systemPrompt: r.systemPrompt,
    isCustom: Boolean(r.isCustom),
  }))
}

export const listPersonas = defineAction({
  name: 'list_personas',
  description: 'List all personas — built-in ones from loaded plugins and custom ones stored in the database.',
  input: z.object({}),
  output: z.array(personaConfigSchema),
  http: { method: 'GET', path: '/api/personas' },
  ai: { tier: 'inform' },
  ui: { label: 'Personas', section: 'ai' },
  async execute(_input, _ctx) {
    const builtIn = builtInPersonas()
    const custom = await dbPersonas()
    // Custom personas can override built-in ones by name
    const builtInFiltered = builtIn.filter(
      (b) => !custom.some((c) => c.name === b.name),
    )
    return [...builtInFiltered, ...custom]
  },
})

export const getPersona = defineAction({
  name: 'get_persona',
  description: 'Get a single persona by name — built-in or custom.',
  input: z.object({ name: z.string() }),
  output: personaConfigSchema,
  http: { method: 'GET', path: '/api/personas/:name' },
  ai: { tier: 'inform' },
  ui: false,
  async execute(input, _ctx) {
    const custom = await dbPersonas()
    const found = custom.find((p) => p.name === input.name)
    if (found) return found

    const builtIn = builtInPersonas().find((p) => p.name === input.name)
    if (builtIn) return builtIn

    throw new Error(`Persona not found: ${input.name}`)
  },
})

export const createPersona = defineAction({
  name: 'create_persona',
  description: 'Create a new custom persona and persist it to the database.',
  input: z.object({
    name: z.string().min(1),
    role: z.string().min(1),
    avatar: z.string().optional(),
    defaultTier: z.enum(['inform', 'advise', 'act']),
    eventSubscriptions: z.array(z.string()),
    toolScopes: z.array(z.string()),
    systemPrompt: z.string().min(1),
  }),
  output: personaConfigSchema,
  http: { method: 'POST', path: '/api/personas' },
  ai: { tier: 'advise' },
  ui: { label: 'Create Persona', section: 'ai' },
  async execute(input, _ctx) {
    const db = requireDb()
    const { personaConfigs } = await getSchema()
    const { randomUUID } = await import('crypto')

    const id = randomUUID()
    const now = new Date()

    await db.insert(personaConfigs).values({
      id,
      name: input.name,
      role: input.role,
      avatar: input.avatar,
      defaultTier: input.defaultTier,
      eventSubscriptions: JSON.stringify(input.eventSubscriptions),
      toolScopes: JSON.stringify(input.toolScopes),
      systemPrompt: input.systemPrompt,
      isCustom: true,
      createdAt: now,
      updatedAt: now,
    })

    return {
      id,
      name: input.name,
      role: input.role,
      avatar: input.avatar,
      defaultTier: input.defaultTier,
      eventSubscriptions: input.eventSubscriptions,
      toolScopes: input.toolScopes,
      systemPrompt: input.systemPrompt,
      isCustom: true,
    }
  },
})

export const updatePersona = defineAction({
  name: 'update_persona',
  description: "Customize a persona's behavior, system prompt, or tool access. Works on both built-in and custom personas (built-ins are copied to DB on first update).",
  input: z.object({
    name: z.string(),
    role: z.string().optional(),
    avatar: z.string().optional(),
    defaultTier: z.enum(['inform', 'advise', 'act']).optional(),
    eventSubscriptions: z.array(z.string()).optional(),
    toolScopes: z.array(z.string()).optional(),
    systemPrompt: z.string().optional(),
  }),
  output: personaConfigSchema,
  http: { method: 'PATCH', path: '/api/personas/:name' },
  ai: { tier: 'advise', description: "Customize a persona's behavior, prompt, or tool access" },
  ui: { label: 'Edit Persona', section: 'ai' },
  async execute(input, _ctx) {
    const db = requireDb()
    const { personaConfigs } = await getSchema()
    const { eq } = await import('drizzle-orm')
    const { randomUUID } = await import('crypto')

    // Find existing custom record or seed from built-in
    const custom = await dbPersonas()
    let existing = custom.find((p) => p.name === input.name)

    if (!existing) {
      // Check built-ins — copy to DB so it becomes an overridable record
      const builtIn = builtInPersonas().find((p) => p.name === input.name)
      if (!builtIn) throw new Error(`Persona not found: ${input.name}`)
      const id = randomUUID()
      const now = new Date()
      await db.insert(personaConfigs).values({
        id,
        name: builtIn.name,
        role: builtIn.role,
        avatar: builtIn.avatar,
        defaultTier: builtIn.defaultTier,
        eventSubscriptions: JSON.stringify(builtIn.eventSubscriptions),
        toolScopes: JSON.stringify(builtIn.toolScopes),
        systemPrompt: builtIn.systemPrompt,
        isCustom: false, // preserve built-in status
        createdAt: now,
        updatedAt: now,
      })
      existing = { ...builtIn, id }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (input.role !== undefined) updates.role = input.role
    if (input.avatar !== undefined) updates.avatar = input.avatar
    if (input.defaultTier !== undefined) updates.defaultTier = input.defaultTier
    if (input.eventSubscriptions !== undefined)
      updates.eventSubscriptions = JSON.stringify(input.eventSubscriptions)
    if (input.toolScopes !== undefined) updates.toolScopes = JSON.stringify(input.toolScopes)
    if (input.systemPrompt !== undefined) updates.systemPrompt = input.systemPrompt

    await db.update(personaConfigs).set(updates).where(eq(personaConfigs.name, input.name))

    // Re-read the updated record
    const fresh = await db
      .select()
      .from(personaConfigs)
      .where(eq(personaConfigs.name, input.name))
      .get()

    if (!fresh) throw new Error('Update failed — record not found after write')

    return {
      id: fresh.id,
      name: fresh.name,
      role: fresh.role,
      avatar: fresh.avatar ?? undefined,
      defaultTier: fresh.defaultTier as PersonaConfig['defaultTier'],
      eventSubscriptions: JSON.parse(fresh.eventSubscriptions),
      toolScopes: JSON.parse(fresh.toolScopes),
      systemPrompt: fresh.systemPrompt,
      isCustom: Boolean(fresh.isCustom),
    }
  },
})

export const deletePersona = defineAction({
  name: 'delete_persona',
  description: 'Delete a custom persona. Built-in personas (isCustom: false) cannot be deleted.',
  input: z.object({ name: z.string() }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'DELETE', path: '/api/personas/:name' },
  ai: { tier: 'advise' },
  ui: false,
  async execute(input, _ctx) {
    const db = requireDb()
    const { personaConfigs } = await getSchema()
    const { eq } = await import('drizzle-orm')

    const existing = await db
      .select()
      .from(personaConfigs)
      .where(eq(personaConfigs.name, input.name))
      .get()

    if (!existing) {
      // Check if it's a built-in persona (not stored in DB)
      const isBuiltIn = builtInPersonas().some((p) => p.name === input.name)
      if (isBuiltIn) throw new Error('cannot delete built-in persona')
      throw new Error(`Persona not found: ${input.name}`)
    }
    if (!existing.isCustom) throw new Error('cannot delete built-in persona')

    await db.delete(personaConfigs).where(eq(personaConfigs.name, input.name))
    return { success: true }
  },
})

// ----------------------------------------------------------------
// Layout Management
// ----------------------------------------------------------------

export const getCardCatalog = defineAction({
  name: 'get_card_catalog',
  description: 'List all available dashboard cards — one per plugin action where ui is enabled — with their configurable output fields.',
  input: z.object({}),
  output: z.array(cardDescriptorSchema),
  http: { method: 'GET', path: '/api/cards/catalog' },
  ai: { tier: 'inform', description: 'List all available dashboard cards and their configurable fields' },
  ui: { label: 'Card Catalog', section: 'dashboard' },
  async execute(_input, _ctx) {
    const descriptors: CardDescriptor[] = []

    for (const entity of entityRegistry.list()) {
      if (entity.source === 'plugin') {
        const field = entity.fields.result
        const actionName = field?.actionName
        if (!actionName || !entity.pluginName) continue

        const registered = registry.getAction(entity.pluginName, actionName)
        if (!registered) continue

        const action = registered.action
        if (action.ui === false) continue

        const { schemaType, fields } = introspectSchema(action.output)
        descriptors.push({
          id: entity.name,
          pluginName: entity.pluginName,
          actionName,
          label: action.ui.label,
          section: action.ui.section,
          schemaType,
          outputFields: fields,
        })
      } else if (entity.source === 'derived') {
        // Find the primary data field (first data-kind field)
        const primaryEntry = Object.entries(entity.fields).find(([, f]) => f.kind === 'data')
        if (!primaryEntry) continue  // derived entity with only function fields — skip for now

        const [primaryFieldName, primaryField] = primaryEntry
        if (primaryField.kind !== 'data') continue  // type narrowing

        // Map the field's type to a schemaType
        let schemaType: 'scalar' | 'record' | 'collection' | 'json'
        if (primaryField.type === 'collection') {
          schemaType = 'collection'
        } else if (primaryField.type === 'record') {
          schemaType = 'record'
        } else {
          schemaType = 'scalar'
        }

        descriptors.push({
          id: entity.name,
          pluginName: undefined,
          actionName: primaryFieldName,
          label: entity.description ?? entity.name,
          section: entity.section ?? 'entities',
          schemaType,
          outputFields: [],  // enriched at render time from live evaluation
        })
      }
    }

    return descriptors
  },
})

export const getLayout = defineAction({
  name: 'get_layout',
  description: 'Get the ordered card config for a dashboard page. Returns the default order if no custom layout has been saved.',
  input: z.object({ page: z.string().default('home') }),
  output: z.array(cardConfigSchema),
  http: { method: 'GET', path: '/api/layout/:page' },
  ai: { tier: 'inform', description: 'Read the current dashboard widget order and visibility' },
  ui: false,
  async execute(input, _ctx) {
    return requireLayout().getLayout(input.page)
  },
})

export const updateLayout = defineAction({
  name: 'update_layout',
  description: 'Replace the full card layout for a dashboard page. Prefer set_widget_visibility or reorder_widgets for targeted changes.',
  input: z.object({
    page: z.string().default('home'),
    widgets: z.array(cardConfigSchema),
  }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST', path: '/api/layout/:page' },
  ai: { tier: 'act', description: 'Set the complete dashboard layout for a page' },
  ui: false,
  async execute(input, _ctx) {
    await requireLayout().updateLayout(input.page, input.widgets)
    return { success: true }
  },
})

export const resetLayout = defineAction({
  name: 'reset_layout',
  description: 'Delete the stored layout for a dashboard page, reverting it to the default order.',
  input: z.object({ page: z.string().default('home') }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'DELETE', path: '/api/layout/:page' },
  ai: { tier: 'advise', description: 'Reset the dashboard layout to factory defaults' },
  ui: false,
  async execute(input, _ctx) {
    requireDb() // ensure initialized
    const { dashboardLayouts } = await getSchema()
    const { eq } = await import('drizzle-orm')
    await requireDb().delete(dashboardLayouts).where(eq(dashboardLayouts.page, input.page))
    return { success: true }
  },
})

export const setWidgetVisibility = defineAction({
  name: 'set_widget_visibility',
  description: 'Show or hide a specific dashboard card by its ID.',
  input: z.object({
    page: z.string().default('home'),
    cardId: z.string().describe(
      'Stable card ID. Valid values: ServiceStatus, NetworkCard, NasCard, PlexCard, MediaCard, HdhrCard, DakboardCard, BambuCard, CalibreCard, CalibreEnrichmentCard, NightlyCard, YouTubeCleanupCard, PackagesCard, RecentlyAddedCard, SmartHomeCard',
    ),
    visible: z.boolean().describe('true = show, false = hide'),
  }),
  output: z.array(cardConfigSchema),
  http: { method: 'PATCH', path: '/api/layout/:page/cards/:cardId/visibility' },
  ai: {
    tier: 'act',
    description: 'Show or hide a named dashboard card. Use this when the user says "hide the X card" or "show the Y card".',
  },
  ui: false,
  async execute(input, _ctx) {
    return requireLayout().patchWidget(input.page, input.cardId, { visible: input.visible })
  },
})

export const reorderWidgets = defineAction({
  name: 'reorder_widgets',
  description: 'Reorder dashboard cards by providing the desired order of card IDs. Unlisted cards are appended after the listed ones.',
  input: z.object({
    page: z.string().default('home'),
    orderedIds: z.array(z.string()).min(1).describe('Card IDs in the desired display order'),
  }),
  output: z.array(cardConfigSchema),
  http: { method: 'PATCH', path: '/api/layout/:page/order' },
  ai: {
    tier: 'act',
    description: 'Reorder dashboard widgets. To move NetworkCard to the top, pass orderedIds: ["NetworkCard"]. You can pass a partial list — only those widgets are repositioned, the rest stay after them.',
  },
  ui: false,
  async execute(input, _ctx) {
    return requireLayout().reorderWidgets(input.page, input.orderedIds)
  },
})

export const patchWidget = defineAction({
  name: 'patch_widget',
  description: 'Change a single card\'s width (col_span) or visibility.',
  input: z.object({
    page: z.string().default('home'),
    cardId: z.string(),
    visible: z.boolean().optional(),
    col_span: z.union([z.literal(1), z.literal(2)]).optional().describe('1 = normal width, 2 = full-width'),
  }),
  output: z.array(cardConfigSchema),
  http: { method: 'PATCH', path: '/api/layout/:page/cards/:cardId' },
  ai: {
    tier: 'act',
    description: 'Change a card\'s width (col_span: 1=normal, 2=full-width) or visibility',
  },
  ui: false,
  async execute(input, _ctx) {
    const { cardId, page, ...patch } = input
    return requireLayout().patchWidget(page, cardId, patch)
  },
})

// ----------------------------------------------------------------
// Card Templates
// ----------------------------------------------------------------

const cardTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  descriptorId: z.string(),
  config: z.record(z.string(), z.unknown()),
})

export const listCardTemplates = defineAction({
  name: 'list_card_templates',
  description: 'List all saved card templates.',
  input: z.object({}),
  output: z.array(cardTemplateSchema),
  http: { method: 'GET', path: '/api/cards/templates' },
  ai: { tier: 'inform' },
  ui: false,
  async execute(_input, _ctx) {
    const db = requireDb()
    const { cardTemplates } = await getSchema()
    const rows = await db.select().from(cardTemplates).all()
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      descriptorId: r.descriptorId,
      config: JSON.parse(r.config) as Record<string, unknown>,
    }))
  },
})

export const createCardTemplate = defineAction({
  name: 'create_card_template',
  description: 'Save the current card configuration as a reusable template.',
  input: z.object({
    name: z.string().min(1),
    descriptorId: z.string(),
    config: z.record(z.string(), z.unknown()),
  }),
  output: cardTemplateSchema,
  http: { method: 'POST', path: '/api/cards/templates' },
  ai: { tier: 'act' },
  ui: false,
  async execute(input, _ctx) {
    const db = requireDb()
    const { cardTemplates } = await getSchema()
    const { randomUUID } = await import('crypto')
    const id = randomUUID()
    await db.insert(cardTemplates).values({
      id,
      name: input.name,
      descriptorId: input.descriptorId,
      config: JSON.stringify(input.config),
    })
    return {
      id,
      name: input.name,
      descriptorId: input.descriptorId,
      config: input.config,
    }
  },
})

export const deleteCardTemplate = defineAction({
  name: 'delete_card_template',
  description: 'Delete a card template by ID.',
  input: z.object({ id: z.string() }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'DELETE', path: '/api/cards/templates/:id' },
  ai: { tier: 'act' },
  ui: false,
  async execute(input, _ctx) {
    const db = requireDb()
    const { cardTemplates } = await getSchema()
    const { eq } = await import('drizzle-orm')
    await db.delete(cardTemplates).where(eq(cardTemplates.id, input.id))
    return { success: true }
  },
})
