/**
 * Tests for Phase 4a generic address-based agent tools.
 *
 * Mocking strategy: we register entities directly into the entityRegistry
 * singleton (same as address-resolver tests). This tests the tools at the
 * boundary — from tool input to tool output — without mocking internals.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { createGenericTools } from '../generic-tools'
import { entityRegistry } from '@maisie/plugin-core'
import { componentRegistry } from '@maisie/plugin-core'
import { registry as pluginRegistry } from '@maisie/plugin-core/src/registry'
import type { EntityDef, ActionContext } from '@maisie/shared'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_CONTEXT: ActionContext = {
  plugin: 'test',
  requestId: 'test-request',
  log: () => {},
  emit: () => {},
}

/** Build a minimal plugin that returns a fixed value from one action. */
function makeMockPlugin(
  pluginName: string,
  actionName: string,
  returnValue: unknown,
  tier: 'inform' | 'act' | 'advise' = 'inform',
) {
  return {
    name: pluginName,
    version: '1.0.0',
    description: 'mock',
    capabilities: [] as never[],
    envVars: [],
    events: [],
    actions: [
      {
        name: actionName,
        description: 'mock action',
        input: { parse: () => ({}) } as any,
        output: { parse: () => ({}) } as any,
        http: { method: 'GET' as const },
        ai: { tier },
        ui: { label: 'Mock', section: 'test' },
        async execute() { return returnValue },
      },
    ],
    async init() {},
    async shutdown() {},
    async healthCheck() { return { status: 'healthy' as const, lastCheck: new Date() } },
  }
}

/** Execute a tool by calling its execute function directly. */
async function execTool(tools: ReturnType<typeof createGenericTools>, name: keyof ReturnType<typeof createGenericTools>, args: Record<string, unknown>) {
  const t = tools[name] as any
  return t.execute(args)
}

beforeEach(() => {
  entityRegistry.clear()
  // Note: componentRegistry keeps base/layout components — clear() removes derived only.
  componentRegistry.clear()
})

// ── resolve_address ───────────────────────────────────────────────────────────

describe('resolve_address', () => {
  test('returns live value for a plugin entity data field', async () => {
    const entity: EntityDef = {
      name: 'mock-plugin.list_switches',
      source: 'plugin',
      pluginName: 'mock-plugin',
      section: 'smart-home',
      fields: {
        result: { kind: 'data', type: 'collection', actionName: 'list_switches' },
      },
    }
    entityRegistry.register(entity)
    pluginRegistry.register(
      makeMockPlugin('mock-plugin', 'list_switches', [{ name: 'front light', state: 'on' }]),
      () => {},
    )

    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'resolve_address', { address: 'mock-plugin.list_switches.result' })
    expect(result).toEqual([{ name: 'front light', state: 'on' }])
  })

  test('returns evaluated value for a derived entity data field', async () => {
    const entity: EntityDef = {
      name: 'computed-entity',
      source: 'derived',
      fields: {
        count: { kind: 'data', type: 'number', expression: { kind: 'literal', value: 99 } },
      },
    }
    entityRegistry.register(entity)

    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'resolve_address', { address: 'computed-entity.count' })
    expect(result).toBe(99)
  })

  test('returns error for an unknown address', async () => {
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'resolve_address', { address: 'nonexistent.entity.field' })
    expect(result).toMatchObject({ error: expect.stringContaining('Unresolved address') })
  })
})

// ── invoke_address ────────────────────────────────────────────────────────────

describe('invoke_address', () => {
  test('calls a function field and returns its result', async () => {
    // Use a function verb prefix (invoke_) so the synthesized entity has a function field.
    // Register plugin first (it synthesizes entity), then the act tier is set via ai config.
    pluginRegistry.register(
      makeMockPlugin('test-plugin', 'invoke_toggle', { success: true }, 'act'),
      () => {},
    )
    // The synthesized entity is now test-plugin.invoke_toggle with a function field, tier: act.

    const tools = createGenericTools(MOCK_CONTEXT, 'act')
    const result = await execTool(tools, 'invoke_address', { address: 'test-plugin.invoke_toggle.result' })
    expect(result).toEqual({ success: true })
  })

  test('blocks invocation when field tier exceeds permitted tier', async () => {
    // Register the entity manually only — no pluginRegistry call needed because
    // the error happens before invocation (tier check is pre-flight).
    // This avoids the synthesized entity overwriting our function field.
    const entity: EntityDef = {
      name: 'isolated-entity.advise_op',
      source: 'plugin',
      pluginName: 'isolated-entity',
      fields: {
        result: { kind: 'function', params: [], returnType: 'record', actionName: 'advise_op', tier: 'advise' },
      },
    }
    entityRegistry.register(entity)

    // Caller only has 'inform' tier — cannot invoke 'advise' tier.
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'invoke_address', { address: 'isolated-entity.advise_op.result' })
    expect(result).toMatchObject({ error: expect.stringContaining('exceeds permitted tier') })
  })

  test('returns error when address points to a data field (not callable)', async () => {
    // Register entity manually — data field, no plugin call needed.
    const entity: EntityDef = {
      name: 'data-only-entity',
      source: 'plugin',
      pluginName: 'data-only',
      fields: {
        result: { kind: 'data', type: 'string', actionName: 'get_status' },
      },
    }
    entityRegistry.register(entity)

    const tools = createGenericTools(MOCK_CONTEXT, 'advise')
    const result = await execTool(tools, 'invoke_address', { address: 'data-only-entity.result' })
    expect(result).toMatchObject({ error: expect.stringContaining('not a callable function field') })
  })

  test('returns error for unknown address', async () => {
    const tools = createGenericTools(MOCK_CONTEXT, 'advise')
    const result = await execTool(tools, 'invoke_address', { address: 'does-not-exist.fn' })
    expect(result).toMatchObject({ error: expect.any(String) })
  })
})

// ── run_pipeline ──────────────────────────────────────────────────────────────

describe('run_pipeline', () => {
  test('evaluates a simple literal expression', async () => {
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'run_pipeline', { expression: '42' })
    expect(result).toBe(42)
  })

  test('evaluates a string expression', async () => {
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'run_pipeline', { expression: '"hello world"' })
    expect(result).toBe('hello world')
  })

  test('evaluates a pipeline expression against a plugin entity', async () => {
    // Use a plugin entity (with mock action) to provide collection data.
    pluginRegistry.register(
      makeMockPlugin('lights-plugin', 'list_switches', [
        { name: 'front', state: 'on' },
        { name: 'back', state: 'off' },
      ]),
      () => {},
    )
    // The synthesized entity is lights-plugin.list_switches with a data field 'result'.

    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'run_pipeline', {
      expression: 'lights-plugin.list_switches.result | filter: state == "on"',
    })
    expect(result).toEqual([{ name: 'front', state: 'on' }])
  })

  test('rejects a define block with a clear error', async () => {
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'run_pipeline', {
      expression: 'define my-entity { count: number = 42 }',
    })
    expect(result).toMatchObject({ error: expect.stringContaining('define blocks') })
  })

  test('rejects a component define block with a clear error', async () => {
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'run_pipeline', {
      expression: 'define MyTile { render: text(value: "hi") }',
    })
    expect(result).toMatchObject({ error: expect.stringContaining('define blocks') })
  })

  test('rejects expression whose inferred tier exceeds permitted tier', async () => {
    // Register a function field with 'act' tier.
    const entity: EntityDef = {
      name: 'ha-plugin.toggle_all',
      source: 'plugin',
      pluginName: 'ha-plugin',
      fields: {
        result: { kind: 'function', params: [], returnType: 'record', actionName: 'toggle_all', tier: 'act' },
      },
    }
    entityRegistry.register(entity)

    // Caller has only 'inform' tier — cannot run a pipeline that invokes 'act'.
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'run_pipeline', {
      expression: 'ha-plugin.toggle_all.result',
    })
    expect(result).toMatchObject({ error: expect.stringContaining('exceeds permitted tier') })
  })

  test('returns parse error for invalid MEL', async () => {
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'run_pipeline', { expression: '||| broken' })
    expect(result).toMatchObject({ error: expect.any(String) })
  })
})

// ── list_entities ─────────────────────────────────────────────────────────────

describe('list_entities', () => {
  function registerTestEntities() {
    entityRegistry.register({
      name: 'ha.list_switches',
      source: 'plugin',
      pluginName: 'ha',
      section: 'smart-home',
      fields: {
        result: { kind: 'data', type: 'collection', actionName: 'list_switches' },
      },
    })
    entityRegistry.register({
      name: 'plex.list_movies',
      source: 'plugin',
      pluginName: 'plex',
      section: 'media',
      fields: {
        result: { kind: 'data', type: 'collection', actionName: 'list_movies' },
        search: { kind: 'function', params: [], returnType: 'collection', actionName: 'search_movies', tier: 'inform' },
      },
    })
    entityRegistry.register({
      name: 'exterior-lights',
      source: 'derived',
      section: 'smart-home',
      fields: {
        switches: { kind: 'data', type: 'collection', expression: { kind: 'literal', value: null } },
      },
    })
  }

  test('without filter returns all entities and components', async () => {
    registerTestEntities()
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'list_entities', {}) as any[]
    // Should include our 3 registered entities
    const names = result.map((r: any) => r.name)
    expect(names).toContain('ha.list_switches')
    expect(names).toContain('plex.list_movies')
    expect(names).toContain('exterior-lights')
    // All items have required summary fields
    for (const item of result) {
      expect('name' in item).toBe(true)
      expect('kind' in item).toBe(true)
      expect('description' in item).toBe(true)
      expect('section' in item).toBe(true)
    }
  })

  test('filter by section returns only matching entities', async () => {
    registerTestEntities()
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'list_entities', {
      filter: { section: 'smart-home' },
    }) as any[]
    const names = result.map((r: any) => r.name)
    expect(names).toContain('ha.list_switches')
    expect(names).toContain('exterior-lights')
    expect(names).not.toContain('plex.list_movies')
  })

  test('filter by fieldNames returns only entities with ALL specified fields', async () => {
    registerTestEntities()
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'list_entities', {
      filter: { fieldNames: ['result', 'search'] },
    }) as any[]
    const names = result.map((r: any) => r.name)
    // Only plex.list_movies has both 'result' and 'search'
    expect(names).toContain('plex.list_movies')
    expect(names).not.toContain('ha.list_switches')
    expect(names).not.toContain('exterior-lights')
  })

  test('filter by section + fieldNames is intersected', async () => {
    registerTestEntities()
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'list_entities', {
      filter: { section: 'media', fieldNames: ['search'] },
    }) as any[]
    const names = result.map((r: any) => r.name)
    expect(names).toContain('plex.list_movies')
    expect(names).not.toContain('ha.list_switches')
  })

  test('empty filter returns all entities', async () => {
    registerTestEntities()
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'list_entities', { filter: {} }) as any[]
    expect(result.length).toBeGreaterThanOrEqual(3)
  })

  test('includes components when no filter is applied', async () => {
    registerTestEntities()
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'list_entities', {}) as any[]
    // Base components from ComponentRegistry (text, badge, etc.) should appear
    const componentItems = result.filter((r: any) => r.kind === 'component')
    expect(componentItems.length).toBeGreaterThan(0)
  })

  test('section filter excludes components (components have no section)', async () => {
    registerTestEntities()
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'list_entities', {
      filter: { section: 'smart-home' },
    }) as any[]
    const componentItems = result.filter((r: any) => r.kind === 'component')
    expect(componentItems).toHaveLength(0)
  })

  test('returns correct summary shape', async () => {
    registerTestEntities()
    const tools = createGenericTools(MOCK_CONTEXT, 'inform')
    const result = await execTool(tools, 'list_entities', {
      filter: { section: 'media' },
    }) as any[]
    const plexEntry = result.find((r: any) => r.name === 'plex.list_movies')
    expect(plexEntry).toBeDefined()
    expect(plexEntry.kind).toBe('entity')
    expect(plexEntry.section).toBe('media')
    expect('name' in plexEntry).toBe(true)
    expect('description' in plexEntry).toBe(true)
  })
})

// ── tier-enforcement integration ──────────────────────────────────────────────

describe('tier enforcement', () => {
  test('canInvoke: inform permits inform', async () => {
    const { canInvoke } = await import('../tier-enforcement')
    expect(canInvoke('inform', 'inform')).toBe(true)
  })

  test('canInvoke: inform blocks act', async () => {
    const { canInvoke } = await import('../tier-enforcement')
    expect(canInvoke('act', 'inform')).toBe(false)
  })

  test('canInvoke: act permits act and inform', async () => {
    const { canInvoke } = await import('../tier-enforcement')
    expect(canInvoke('inform', 'act')).toBe(true)
    expect(canInvoke('act', 'act')).toBe(true)
  })

  test('canInvoke: advise permits everything', async () => {
    const { canInvoke } = await import('../tier-enforcement')
    expect(canInvoke('inform', 'advise')).toBe(true)
    expect(canInvoke('act', 'advise')).toBe(true)
    expect(canInvoke('advise', 'advise')).toBe(true)
  })

  test('requireTier throws on blocked tier', async () => {
    const { requireTier } = await import('../tier-enforcement')
    expect(() => requireTier('act', 'inform')).toThrow('exceeds permitted tier')
  })

  test('requireTier does not throw on allowed tier', async () => {
    const { requireTier } = await import('../tier-enforcement')
    expect(() => requireTier('inform', 'inform')).not.toThrow()
    expect(() => requireTier('act', 'act')).not.toThrow()
    expect(() => requireTier('advise', 'advise')).not.toThrow()
  })
})
