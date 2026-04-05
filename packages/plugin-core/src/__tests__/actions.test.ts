import { describe, it, expect, beforeAll, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { z } from 'zod'
import type { MaisiePlugin, PluginAction, AgentPersona } from '@maisie/shared'
import { defineAction } from '@maisie/shared'
import * as actionDefs from '../actions'
import { setDb, setPlugins } from '../actions'

// ----------------------------------------------------------------
// Helpers — in-memory DB that mirrors the real schema
// ----------------------------------------------------------------

function makeTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS persona_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      avatar TEXT,
      default_tier TEXT NOT NULL DEFAULT 'advise',
      event_subscriptions TEXT NOT NULL DEFAULT '[]',
      tool_scopes TEXT NOT NULL DEFAULT '[]',
      system_prompt TEXT NOT NULL,
      is_custom INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dashboard_layouts (
      id TEXT PRIMARY KEY,
      page TEXT NOT NULL UNIQUE,
      widgets TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plugin_configs (
      id TEXT PRIMARY KEY,
      package_name TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      env_overrides TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
  `)
  const { personaConfigs, dashboardLayouts, pluginConfigs } = require(
    '../../../../packages/agent/src/services/schema',
  )
  return drizzle(sqlite, { schema: { personaConfigs, dashboardLayouts, pluginConfigs } })
}

const noopCtx = {
  log: () => {},
  emit: () => {},
}

// ----------------------------------------------------------------
// Fake plugin for injection
// ----------------------------------------------------------------

const fakeOutputSchema = z.object({
  name: z.string(),
  count: z.number(),
  active: z.boolean().optional(),
})

const fakeAction: PluginAction = defineAction({
  name: 'fake_action',
  description: 'A fake action for testing',
  input: z.object({}),
  output: fakeOutputSchema,
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Fake Widget', section: 'test' },
  async execute() {
    return { name: 'test', count: 42 }
  },
})

const fakePersona: AgentPersona = {
  name: 'TestBot',
  role: 'Test specialist',
  defaultTier: 'inform',
  eventSubscriptions: ['home/test/#'],
  toolScopes: ['fake_action'],
  systemPrompt: 'You are a test bot.',
}

const fakePlugin: MaisiePlugin = {
  name: 'fake',
  version: '1.0.0',
  description: 'Fake plugin for tests',
  capabilities: [],
  envVars: [],
  actions: [fakeAction],
  events: [],
  persona: fakePersona,
  async init() {},
  async shutdown() {},
  async healthCheck() {
    return { status: 'healthy', lastCheck: new Date() }
  },
}

// ----------------------------------------------------------------
// Setup
// ----------------------------------------------------------------

let db: ReturnType<typeof makeTestDb>

beforeAll(() => {
  db = makeTestDb()
  setDb(db)
  setPlugins([fakePlugin])
})

beforeEach(async () => {
  // Clean persona and layout tables between tests
  const { personaConfigs, dashboardLayouts, pluginConfigs } = await import(
    '../../../../packages/agent/src/services/schema'
  )
  await db.delete(personaConfigs)
  await db.delete(dashboardLayouts)
  await db.delete(pluginConfigs)
})

// ----------------------------------------------------------------
// list_plugins
// ----------------------------------------------------------------

describe('list_plugins', () => {
  it('returns an array with the fake plugin', async () => {
    const result = await actionDefs.listPlugins.execute({}, noopCtx)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('fake')
    expect(result[0].version).toBe('1.0.0')
    expect(result[0].health.status).toBe('healthy')
  })
})

// ----------------------------------------------------------------
// install_plugin
// ----------------------------------------------------------------

describe('install_plugin', () => {
  it('rejects clearly invalid package names', async () => {
    await expect(
      actionDefs.installPlugin.execute({ packageName: 'rm -rf /' }, noopCtx),
    ).rejects.toThrow('Invalid package name')
  })

  it('returns not-yet-implemented message for valid package name', async () => {
    const result = await actionDefs.installPlugin.execute(
      { packageName: '@maisie/plugin-unifi' },
      noopCtx,
    )
    expect(result.success).toBe(false)
    expect(result.message).toContain('not yet implemented')
  })
})

// ----------------------------------------------------------------
// list_personas
// ----------------------------------------------------------------

describe('list_personas', () => {
  it('returns at least the built-in TestBot persona', async () => {
    const result = await actionDefs.listPersonas.execute({}, noopCtx)
    expect(Array.isArray(result)).toBe(true)
    const testBot = result.find((p) => p.name === 'TestBot')
    expect(testBot).toBeDefined()
    expect(testBot?.isCustom).toBe(false)
  })
})

// ----------------------------------------------------------------
// create_persona + list_personas round-trip
// ----------------------------------------------------------------

describe('create_persona', () => {
  it('saves to DB and is retrievable via list_personas', async () => {
    await actionDefs.createPersona.execute(
      {
        name: 'Hiro',
        role: 'Kitchen assistant',
        defaultTier: 'advise',
        eventSubscriptions: ['home/kitchen/#'],
        toolScopes: [],
        systemPrompt: 'You manage the kitchen.',
      },
      noopCtx,
    )

    const personas = await actionDefs.listPersonas.execute({}, noopCtx)
    const hiro = personas.find((p) => p.name === 'Hiro')
    expect(hiro).toBeDefined()
    expect(hiro?.role).toBe('Kitchen assistant')
    expect(hiro?.isCustom).toBe(true)
  })
})

// ----------------------------------------------------------------
// update_persona
// ----------------------------------------------------------------

describe('update_persona', () => {
  it('modifies only the specified fields', async () => {
    await actionDefs.createPersona.execute(
      {
        name: 'Yuki',
        role: 'Garden bot',
        defaultTier: 'inform',
        eventSubscriptions: [],
        toolScopes: [],
        systemPrompt: 'You tend the garden.',
      },
      noopCtx,
    )

    const updated = await actionDefs.updatePersona.execute(
      { name: 'Yuki', role: 'Updated garden bot' },
      noopCtx,
    )

    expect(updated.role).toBe('Updated garden bot')
    expect(updated.systemPrompt).toBe('You tend the garden.')
    expect(updated.defaultTier).toBe('inform')
  })

  it('can override a built-in persona prompt', async () => {
    const updated = await actionDefs.updatePersona.execute(
      { name: 'TestBot', systemPrompt: 'Custom override prompt.' },
      noopCtx,
    )
    expect(updated.systemPrompt).toBe('Custom override prompt.')
    expect(updated.name).toBe('TestBot')
  })
})

// ----------------------------------------------------------------
// delete_persona
// ----------------------------------------------------------------

describe('delete_persona', () => {
  it('deletes a custom persona', async () => {
    await actionDefs.createPersona.execute(
      {
        name: 'Temp',
        role: 'Temporary',
        defaultTier: 'advise',
        eventSubscriptions: [],
        toolScopes: [],
        systemPrompt: 'Temp.',
      },
      noopCtx,
    )

    await actionDefs.deletePersona.execute({ name: 'Temp' }, noopCtx)
    const personas = await actionDefs.listPersonas.execute({}, noopCtx)
    expect(personas.find((p) => p.name === 'Temp')).toBeUndefined()
  })

  it('throws when trying to delete a built-in persona', async () => {
    // TestBot is built-in (isCustom: false)
    await expect(
      actionDefs.deletePersona.execute({ name: 'TestBot' }, noopCtx),
    ).rejects.toThrow('cannot delete built-in persona')
  })

  it('throws when persona does not exist', async () => {
    await expect(
      actionDefs.deletePersona.execute({ name: 'DoesNotExist' }, noopCtx),
    ).rejects.toThrow('Persona not found')
  })
})

// ----------------------------------------------------------------
// get_card_catalog
// ----------------------------------------------------------------

describe('get_card_catalog', () => {
  it('returns a descriptor for the fake action (ui !== false)', async () => {
    const catalog = await actionDefs.getCardCatalog.execute({}, noopCtx)
    expect(Array.isArray(catalog)).toBe(true)
    const desc = catalog.find((d) => d.id === 'fake.fake_action')
    expect(desc).toBeDefined()
    expect(desc?.label).toBe('Fake Widget')
    expect(desc?.section).toBe('test')
    expect(desc?.outputFields.length).toBeGreaterThan(0)
  })

  it('introspects output fields correctly from the fake action schema', async () => {
    const catalog = await actionDefs.getCardCatalog.execute({}, noopCtx)
    const desc = catalog.find((d) => d.id === 'fake.fake_action')!
    const nameField = desc.outputFields.find((f) => f.key === 'name')
    const countField = desc.outputFields.find((f) => f.key === 'count')
    const activeField = desc.outputFields.find((f) => f.key === 'active')

    expect(nameField?.type).toBe('string')
    expect(countField?.type).toBe('number')
    expect(activeField?.type).toBe('boolean')
    expect(activeField?.optional).toBe(true)
  })
})

// ----------------------------------------------------------------
// get_layout / update_layout round-trip
// ----------------------------------------------------------------

describe('get_layout / update_layout', () => {
  it('round-trips a layout through SQLite', async () => {
    // CardConfig format: id, visible, col_span, order
    const widgets = [
      { id: 'NetworkCard', visible: true, col_span: 1, order: 0 },
      { id: 'NasCard',     visible: false, col_span: 2, order: 1 },
    ]

    await actionDefs.updateLayout.execute({ page: 'roundtrip-test', widgets }, noopCtx)

    const result = await actionDefs.getLayout.execute({ page: 'roundtrip-test' }, noopCtx)
    // getLayout merges stored with defaults — stored widgets come first, sorted by order
    const networkCard = result.find((w: any) => w.id === 'NetworkCard')
    const nasCard     = result.find((w: any) => w.id === 'NasCard')
    expect(networkCard).toBeDefined()
    expect(networkCard.visible).toBe(true)
    expect(networkCard.col_span).toBe(1)
    expect(nasCard).toBeDefined()
    expect(nasCard.visible).toBe(false)
    expect(nasCard.col_span).toBe(2)
  })

  it('returns defaults for a page with no stored layout', async () => {
    const result = await actionDefs.getLayout.execute({ page: 'nonexistent-page-xyz' }, noopCtx)
    // getLayout always returns defaults — never empty for a fresh page
    expect(result.length).toBeGreaterThan(0)
    for (const w of result) {
      expect(w.id).toBeDefined()
      expect(typeof w.visible).toBe('boolean')
      expect([1, 2]).toContain(w.col_span)
      expect(typeof w.order).toBe('number')
    }
  })

  it('overwrites an existing layout on update', async () => {
    const first  = [{ id: 'PlexCard', visible: true,  col_span: 1, order: 0 }]
    const second = [{ id: 'PlexCard', visible: false, col_span: 2, order: 0 }]

    await actionDefs.updateLayout.execute({ page: 'overwrite-test', widgets: first  }, noopCtx)
    await actionDefs.updateLayout.execute({ page: 'overwrite-test', widgets: second }, noopCtx)

    const result = await actionDefs.getLayout.execute({ page: 'overwrite-test' }, noopCtx)
    const plexCard = result.find((w: any) => w.id === 'PlexCard')
    expect(plexCard?.visible).toBe(false)
    expect(plexCard?.col_span).toBe(2)
  })
})

// ----------------------------------------------------------------
// reset_layout
// ----------------------------------------------------------------

describe('reset_layout', () => {
  it('clears stored layout and returns defaults', async () => {
    await actionDefs.updateLayout.execute(
      { page: 'reset-test', widgets: [{ id: 'BambuCard', visible: false, col_span: 1, order: 0 }] },
      noopCtx,
    )

    await actionDefs.resetLayout.execute({ page: 'reset-test' }, noopCtx)

    // After reset, getLayout returns defaults again (all visible, default order)
    const result = await actionDefs.getLayout.execute({ page: 'reset-test' }, noopCtx)
    expect(result.length).toBeGreaterThan(0)
    const bambu = result.find((w: any) => w.id === 'BambuCard')
    // Should be back to default (visible = true)
    expect(bambu?.visible).toBe(true)
  })
})

// ----------------------------------------------------------------
// Plugin structure: all actions have explicit http/ai/ui declarations
// ----------------------------------------------------------------

describe('plugin structure', () => {
  it('all actions have http explicitly set', () => {
    for (const action of Object.values(actionDefs).filter(
      (v) => typeof v === 'object' && v !== null && 'http' in (v as object),
    ) as PluginAction[]) {
      expect(action.http).toBeDefined()
      expect(action.http.method).toBeDefined()
    }
  })

  it('all actions have ai explicitly declared (object or false)', () => {
    for (const [name, value] of Object.entries(actionDefs)) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'ai' in (value as object)
      ) {
        const action = value as PluginAction
        expect(action.ai, `${name} must have ai declared`).toBeDefined()
      }
    }
  })

  it('all actions have ui explicitly declared (object or false)', () => {
    for (const [name, value] of Object.entries(actionDefs)) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'ui' in (value as object)
      ) {
        const action = value as PluginAction
        expect(action.ui, `${name} must have ui declared`).toBeDefined()
      }
    }
  })
})
