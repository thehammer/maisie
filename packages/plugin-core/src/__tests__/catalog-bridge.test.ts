/**
 * catalog-bridge.test.ts
 *
 * Verifies that the Phase 2a bridge between PluginRegistry, EntityRegistry,
 * and getCardCatalog is wired correctly. Uses an isolated PluginRegistry
 * instance to avoid contaminating the singleton, and clears entityRegistry
 * before/after each test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { z } from 'zod'
import { defineAction } from '@maisie/shared'
import type { MaisiePlugin, PluginAction } from '@maisie/shared'
import { PluginRegistry } from '../registry'
import { entityRegistry } from '../entity-registry'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const dataAction: PluginAction = defineAction({
  name: 'list_switches',
  description: 'List all switches',
  input: z.object({}),
  output: z.array(z.object({
    id: z.string(),
    name: z.string(),
    state: z.string(),
  })),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Switches', section: 'smarthome' },
  async execute() { return [] },
})

const functionAction: PluginAction = defineAction({
  name: 'invoke_toggle',
  description: 'Toggle a switch',
  input: z.object({ id: z.string() }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST' },
  ai: { tier: 'advise' },
  ui: { label: 'Toggle Switch', section: 'smarthome' },
  async execute() { return { success: true } },
})

const hiddenAction: PluginAction = defineAction({
  name: 'get_internal_config',
  description: 'Internal only',
  input: z.object({}),
  output: z.object({ config: z.string() }),
  http: { method: 'GET' },
  ai: false,
  ui: false,
  async execute() { return { config: 'x' } },
})

const getStatusAction: PluginAction = defineAction({
  name: 'get_status',
  description: 'Get system status',
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Status', section: 'system' },
  async execute() { return { ok: true } },
})

const bridgePlugin: MaisiePlugin = {
  name: 'bridge-test',
  version: '1.0.0',
  description: 'Plugin for catalog bridge tests',
  capabilities: [],
  envVars: [],
  actions: [dataAction, functionAction, hiddenAction, getStatusAction],
  events: [],
  async init() {},
  async shutdown() {},
  async healthCheck() { return { status: 'healthy', lastCheck: new Date() } },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('catalog bridge: PluginRegistry → EntityRegistry', () => {
  let localRegistry: PluginRegistry

  beforeEach(() => {
    entityRegistry.clear()
    localRegistry = new PluginRegistry()
  })

  afterEach(() => {
    entityRegistry.clear()
  })

  it('registering a plugin synthesizes entities for all ui-enabled actions', () => {
    localRegistry.register(bridgePlugin, () => {})

    const entities = entityRegistry.list()
    // 3 actions have ui !== false (list_switches, invoke_toggle, get_status)
    expect(entities).toHaveLength(3)
  })

  it('synthesized entity names match {plugin}.{action} pattern', () => {
    localRegistry.register(bridgePlugin, () => {})

    const names = entityRegistry.list().map((e) => e.name)
    expect(names).toContain('bridge-test.list_switches')
    expect(names).toContain('bridge-test.invoke_toggle')
    expect(names).toContain('bridge-test.get_status')
    expect(names).not.toContain('bridge-test.get_internal_config')
  })

  it('data actions produce data-kind fields in the entity registry', () => {
    localRegistry.register(bridgePlugin, () => {})

    const entity = entityRegistry.get('bridge-test.list_switches')
    expect(entity).toBeDefined()
    expect(entity?.fields.result.kind).toBe('data')
    if (entity?.fields.result.kind === 'data') {
      expect(entity.fields.result.actionName).toBe('list_switches')
    }
  })

  it('function actions produce function-kind fields in the entity registry', () => {
    localRegistry.register(bridgePlugin, () => {})

    const entity = entityRegistry.get('bridge-test.invoke_toggle')
    expect(entity).toBeDefined()
    expect(entity?.fields.result.kind).toBe('function')
    if (entity?.fields.result.kind === 'function') {
      expect(entity.fields.result.actionName).toBe('invoke_toggle')
      expect(entity.fields.result.tier).toBe('advise')
    }
  })

  it('ui: false actions are not registered in the entity registry', () => {
    localRegistry.register(bridgePlugin, () => {})

    const entity = entityRegistry.get('bridge-test.get_internal_config')
    expect(entity).toBeUndefined()
  })

  it('all synthesized entities have source: plugin', () => {
    localRegistry.register(bridgePlugin, () => {})

    for (const entity of entityRegistry.list()) {
      expect(entity.source).toBe('plugin')
      expect(entity.pluginName).toBe('bridge-test')
    }
  })

  it('registering two plugins adds both sets of entities', () => {
    const secondPlugin: MaisiePlugin = {
      name: 'second-plugin',
      version: '1.0.0',
      description: 'Second plugin',
      capabilities: [],
      envVars: [],
      actions: [
        defineAction({
          name: 'list_items',
          description: 'List items',
          input: z.object({}),
          output: z.array(z.object({ id: z.string() })),
          http: { method: 'GET' },
          ai: { tier: 'inform' },
          ui: { label: 'Items', section: 'misc' },
          async execute() { return [] },
        }),
      ],
      events: [],
      async init() {},
      async shutdown() {},
      async healthCheck() { return { status: 'healthy', lastCheck: new Date() } },
    }

    localRegistry.register(bridgePlugin, () => {})
    localRegistry.register(secondPlugin, () => {})

    const entities = entityRegistry.list()
    expect(entities.length).toBeGreaterThanOrEqual(4) // 3 from bridge + 1 from second
    const names = entities.map((e) => e.name)
    expect(names).toContain('second-plugin.list_items')
  })
})

describe('catalog bridge: getCardCatalog reads from entityRegistry', () => {
  const { getCardCatalog, setPlugins, setDb } = require('../actions')
  const { Database } = require('bun:sqlite')
  const { drizzle } = require('drizzle-orm/bun-sqlite')

  const noopCtx = { log: () => {}, emit: () => {} }

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

  beforeEach(() => {
    const db = makeTestDb()
    setDb(db)
    setPlugins([bridgePlugin])
  })

  afterEach(() => {
    entityRegistry.clear()
  })

  it('getCardCatalog returns one entry per ui-enabled action', async () => {
    const catalog = await getCardCatalog.execute({}, noopCtx)

    // bridge-test has 3 ui-enabled actions (list_switches, invoke_toggle, get_status)
    // plus any other plugins registered via setPlugins
    const bridgeEntries = catalog.filter((d: any) => d.pluginName === 'bridge-test')
    expect(bridgeEntries).toHaveLength(3)
  })

  it('getCardCatalog ids match {plugin}.{action} shape', async () => {
    const catalog = await getCardCatalog.execute({}, noopCtx)
    const bridgeEntries = catalog.filter((d: any) => d.pluginName === 'bridge-test')
    const ids = bridgeEntries.map((d: any) => d.id)

    expect(ids).toContain('bridge-test.list_switches')
    expect(ids).toContain('bridge-test.invoke_toggle')
    expect(ids).toContain('bridge-test.get_status')
    expect(ids).not.toContain('bridge-test.get_internal_config')
  })

  it('getCardCatalog output fields are introspected from the action schema', async () => {
    const catalog = await getCardCatalog.execute({}, noopCtx)
    const switchesDesc = catalog.find((d: any) => d.id === 'bridge-test.list_switches')

    expect(switchesDesc).toBeDefined()
    expect(switchesDesc.schemaType).toBe('collection')
    expect(switchesDesc.outputFields.length).toBeGreaterThan(0)

    const idField = switchesDesc.outputFields.find((f: any) => f.key === 'id')
    const nameField = switchesDesc.outputFields.find((f: any) => f.key === 'name')
    expect(idField?.type).toBe('string')
    expect(nameField?.type).toBe('string')
  })

  it('getCardCatalog preserves label and section from action.ui', async () => {
    const catalog = await getCardCatalog.execute({}, noopCtx)
    const entry = catalog.find((d: any) => d.id === 'bridge-test.list_switches')

    expect(entry?.label).toBe('Switches')
    expect(entry?.section).toBe('smarthome')
  })

  it('backward compat: CardDescriptor shape is preserved (id, pluginName, actionName, label, section, schemaType, outputFields)', async () => {
    const catalog = await getCardCatalog.execute({}, noopCtx)
    expect(catalog.length).toBeGreaterThan(0)

    for (const desc of catalog) {
      expect(typeof desc.id).toBe('string')
      expect(typeof desc.pluginName).toBe('string')
      expect(typeof desc.actionName).toBe('string')
      expect(typeof desc.label).toBe('string')
      expect(typeof desc.section).toBe('string')
      expect(['scalar', 'record', 'collection', 'json']).toContain(desc.schemaType)
      expect(Array.isArray(desc.outputFields)).toBe(true)
    }
  })
})
