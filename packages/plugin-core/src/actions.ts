import { z } from 'zod'
import { defineAction } from '@maisie/shared'
import type { MaisiePlugin } from '@maisie/shared'
import { introspectSchema } from './schema-introspector'
import type { WidgetDescriptor, WidgetPlacement, PersonaConfig } from './types'

// ----------------------------------------------------------------
// Module-level state — injected by plugin init()
// ----------------------------------------------------------------

let _db: import('drizzle-orm/bun-sqlite').BunSQLiteDatabase<Record<string, never>> | null = null
let _loadedPlugins: MaisiePlugin[] = []

export function setDb(db: unknown) {
  _db = db as typeof _db
}

export function setPlugins(plugins: MaisiePlugin[]) {
  _loadedPlugins = plugins
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

const widgetFieldSchema = z.object({
  key: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object', 'unknown']),
  label: z.string(),
  optional: z.boolean(),
})

const widgetDescriptorSchema = z.object({
  id: z.string(),
  pluginName: z.string(),
  actionName: z.string(),
  label: z.string(),
  section: z.string(),
  outputFields: z.array(widgetFieldSchema),
})

const widgetPlacementSchema = z.object({
  widgetId: z.string(),
  position: z.object({ row: z.number(), col: z.number() }),
  size: z.object({ rows: z.number(), cols: z.number() }),
  config: z.object({
    visibleFields: z.array(z.string()),
    refreshInterval: z.number().optional(),
    title: z.string().optional(),
  }),
})

// ----------------------------------------------------------------
// Helpers — DB access with lazy import to avoid circular deps
// ----------------------------------------------------------------

async function getSchema() {
  const { personaConfigs, dashboardLayouts, pluginConfigs } = await import(
    '../../../packages/agent/src/services/schema'
  )
  return { personaConfigs, dashboardLayouts, pluginConfigs }
}

function requireDb() {
  if (!_db) throw new Error('plugin-core: database not initialized')
  return _db
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

export const getWidgetCatalog = defineAction({
  name: 'get_widget_catalog',
  description: 'List all available dashboard widgets — one per plugin action where ui is enabled — with their configurable output fields.',
  input: z.object({}),
  output: z.array(widgetDescriptorSchema),
  http: { method: 'GET', path: '/api/widgets/catalog' },
  ai: { tier: 'inform', description: 'List all available dashboard widgets and their configurable fields' },
  ui: { label: 'Widget Catalog', section: 'dashboard' },
  async execute(_input, _ctx) {
    const descriptors: WidgetDescriptor[] = []

    for (const plugin of _loadedPlugins) {
      for (const action of plugin.actions) {
        if (action.ui === false) continue

        const outputFields = introspectSchema(action.output)
        descriptors.push({
          id: `${plugin.name}.${action.name}`,
          pluginName: plugin.name,
          actionName: action.name,
          label: action.ui.label,
          section: action.ui.section,
          outputFields,
        })
      }
    }

    return descriptors
  },
})

export const getLayout = defineAction({
  name: 'get_layout',
  description: 'Get the widget layout for a dashboard page.',
  input: z.object({ page: z.string() }),
  output: z.array(widgetPlacementSchema),
  http: { method: 'GET', path: '/api/layout/:page' },
  ai: { tier: 'inform' },
  ui: false,
  async execute(input, _ctx) {
    const db = requireDb()
    const { dashboardLayouts } = await getSchema()
    const { eq } = await import('drizzle-orm')

    const row = await db
      .select()
      .from(dashboardLayouts)
      .where(eq(dashboardLayouts.page, input.page))
      .get()

    if (!row) return []
    return JSON.parse(row.widgets) as WidgetPlacement[]
  },
})

export const updateLayout = defineAction({
  name: 'update_layout',
  description: 'Set the widget layout for a dashboard page, replacing any existing layout.',
  input: z.object({
    page: z.string(),
    widgets: z.array(widgetPlacementSchema),
  }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST', path: '/api/layout/:page' },
  ai: { tier: 'act', description: 'Rearrange or configure dashboard widgets on a page' },
  ui: { label: 'Edit Layout', section: 'dashboard' },
  async execute(input, _ctx) {
    const db = requireDb()
    const { dashboardLayouts } = await getSchema()
    const { eq } = await import('drizzle-orm')
    const { randomUUID } = await import('crypto')

    const existing = await db
      .select()
      .from(dashboardLayouts)
      .where(eq(dashboardLayouts.page, input.page))
      .get()

    const now = new Date()
    const widgetsJson = JSON.stringify(input.widgets)

    if (existing) {
      await db
        .update(dashboardLayouts)
        .set({ widgets: widgetsJson, updatedAt: now })
        .where(eq(dashboardLayouts.page, input.page))
    } else {
      await db.insert(dashboardLayouts).values({
        id: randomUUID(),
        page: input.page,
        widgets: widgetsJson,
        updatedAt: now,
      })
    }

    return { success: true }
  },
})

export const resetLayout = defineAction({
  name: 'reset_layout',
  description: 'Delete the stored layout for a dashboard page, reverting it to the default.',
  input: z.object({ page: z.string() }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'DELETE', path: '/api/layout/:page' },
  ai: { tier: 'advise' },
  ui: false,
  async execute(input, _ctx) {
    const db = requireDb()
    const { dashboardLayouts } = await getSchema()
    const { eq } = await import('drizzle-orm')
    await db.delete(dashboardLayouts).where(eq(dashboardLayouts.page, input.page))
    return { success: true }
  },
})
