/**
 * Tests for Phase 4b MEL authoring agent tools.
 *
 * Mocking strategy: stores are mocked at the boundary (in-memory maps),
 * registries use the real singletons (cleared in beforeEach). This tests the
 * tools from input to output without reaching SQLite.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { createAuthoringTools } from '../authoring-tools'
import { entityRegistry } from '@maisie/plugin-core'
import { componentRegistry } from '@maisie/plugin-core'
import type { AuthoringToolDeps } from '../authoring-tools'
import type { EntityDef, ComponentDef } from '@maisie/shared'
import type { DerivedEntityStore } from '@maisie/plugin-core/src/derived-entity-store'
import type { DerivedComponentStore } from '@maisie/plugin-core/src/derived-component-store'

// ── Mock stores ───────────────────────────────────────────────────────────────

function makeMockEntityStore(): DerivedEntityStore & { _saved: Map<string, EntityDef> } {
  const _saved = new Map<string, EntityDef>()
  return {
    _saved,
    async save(entity) { _saved.set(entity.name, entity) },
    async loadAll() { return [..._saved.values()] },
    async delete(name) { _saved.delete(name) },
    async get(name) { return _saved.get(name) ?? null },
  }
}

function makeMockComponentStore(): DerivedComponentStore & { _saved: Map<string, ComponentDef> } {
  const _saved = new Map<string, ComponentDef>()
  return {
    _saved,
    async save(component) { _saved.set(component.name, component) },
    async loadAll() { return [..._saved.values()] },
    async delete(name) { _saved.delete(name) },
    async get(name) { return _saved.get(name) ?? null },
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Execute a tool by calling its execute function directly. */
async function execTool(
  tools: ReturnType<typeof createAuthoringTools>,
  name: keyof ReturnType<typeof createAuthoringTools>,
  args: Record<string, unknown>,
) {
  const t = tools[name] as any
  return t.execute(args)
}

function makeDeps(): { deps: AuthoringToolDeps; entityStore: ReturnType<typeof makeMockEntityStore>; componentStore: ReturnType<typeof makeMockComponentStore> } {
  const entityStore = makeMockEntityStore()
  const componentStore = makeMockComponentStore()
  return { deps: { entityStore, componentStore }, entityStore, componentStore }
}

beforeEach(() => {
  entityRegistry.clear()
  componentRegistry.clear()
})

// ── save_entity ───────────────────────────────────────────────────────────────

describe('save_entity', () => {
  test('valid MEL entity define block registers in registry and persists', async () => {
    const { deps, entityStore } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'save_entity', {
      source: 'define unwatched-movies { count: number = 42 }',
    }) as any

    expect(result.error).toBeUndefined()
    expect(result.name).toBe('unwatched-movies')
    expect(result.source).toBe('derived')
    expect(result.fields).toBeDefined()
    expect(result.fields.count).toBeDefined()

    // Registry was updated
    expect(entityRegistry.get('unwatched-movies')).toBeDefined()

    // Store was persisted
    expect(entityStore._saved.has('unwatched-movies')).toBe(true)
  })

  test('returns the created EntityDef fields', async () => {
    const { deps } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'save_entity', {
      source: 'define my-entity { title: string = "hello" }',
    }) as any

    expect(result.name).toBe('my-entity')
    expect(result.fields.title).toBeDefined()
    expect(result.fields.title.kind).toBe('data')
  })

  test('rejects a component-shaped source (with render: field)', async () => {
    const { deps } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'save_entity', {
      source: 'define MyTile { render: text(value: "hi") }',
    }) as any

    expect(result.error).toMatch(/component define block/)
    expect(result.error).toMatch(/save_component/)
  })

  test('rejects a plain expression (not a define block)', async () => {
    const { deps } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'save_entity', {
      source: '42 + 1',
    }) as any

    expect(result.error).toBeDefined()
    expect(typeof result.error).toBe('string')
  })

  test('rejects invalid MEL with a parse error', async () => {
    const { deps } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'save_entity', {
      source: '||| broken !!!',
    }) as any

    expect(result.error).toMatch(/parse error|MEL/)
  })

  test('rejects when permitted tier is below advise', async () => {
    const { deps } = makeDeps()

    // inform tier — too low for save_entity
    const informTools = createAuthoringTools(deps, 'inform')
    const informResult = await execTool(informTools, 'save_entity', {
      source: 'define test-entity { count: number = 1 }',
    }) as any
    expect(informResult.error).toMatch(/exceeds permitted tier/)

    // act tier — still too low for advise
    const actTools = createAuthoringTools(deps, 'act')
    const actResult = await execTool(actTools, 'save_entity', {
      source: 'define test-entity { count: number = 1 }',
    }) as any
    expect(actResult.error).toMatch(/exceeds permitted tier/)
  })

  test('rejects overwriting a plugin (base) entity', async () => {
    // Register a plugin entity manually.
    entityRegistry.register({
      name: 'existing-plugin-entity',
      source: 'plugin',
      pluginName: 'some-plugin',
      fields: {
        result: { kind: 'data', type: 'string', actionName: 'get_status' },
      },
    })

    const { deps } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'save_entity', {
      source: 'define existing-plugin-entity { count: number = 1 }',
    }) as any

    expect(result.error).toMatch(/read-only/)
  })
})

// ── save_component ────────────────────────────────────────────────────────────

describe('save_component', () => {
  test('valid MEL component define block registers and persists', async () => {
    const { deps, componentStore } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'save_component', {
      source: 'define MyCard { render: text(value: "hello") }',
    }) as any

    expect(result.error).toBeUndefined()
    expect(result.name).toBe('MyCard')
    expect(result.kind).toBe('derived')

    // Registry was updated
    expect(componentRegistry.get('MyCard')).toBeDefined()

    // Store was persisted
    expect(componentStore._saved.has('MyCard')).toBe(true)
  })

  test('returns the created ComponentDef', async () => {
    const { deps } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'save_component', {
      source: 'define StatusBadge { render: text(value: "ok") }',
    }) as any

    expect(result.name).toBe('StatusBadge')
    expect(result.kind).toBe('derived')
    expect(result.render).toBeDefined()
  })

  test('rejects an entity-shaped source (no render: field)', async () => {
    const { deps } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'save_component', {
      source: 'define my-entity { count: number = 42 }',
    }) as any

    expect(result.error).toMatch(/entity define block/)
    expect(result.error).toMatch(/save_entity/)
  })

  test('rejects a plain expression (not a define block)', async () => {
    const { deps } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'save_component', {
      source: '"just a string"',
    }) as any

    expect(result.error).toBeDefined()
    expect(typeof result.error).toBe('string')
  })

  test('rejects invalid MEL with a parse error', async () => {
    const { deps } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'save_component', {
      source: 'define { broken !!!',
    }) as any

    expect(result.error).toMatch(/parse error|MEL/)
  })

  test('rejects when permitted tier is below advise', async () => {
    const { deps } = makeDeps()

    const informTools = createAuthoringTools(deps, 'inform')
    const result = await execTool(informTools, 'save_component', {
      source: 'define MyTile { render: text(value: "hi") }',
    }) as any
    expect(result.error).toMatch(/exceeds permitted tier/)
  })
})

// ── delete_artifact ───────────────────────────────────────────────────────────

describe('delete_artifact', () => {
  test('removes a derived entity from registry and store', async () => {
    // First, register a derived entity directly in registry.
    const entityDef: EntityDef = {
      name: 'my-derived-entity',
      source: 'derived',
      fields: {
        count: { kind: 'data', type: 'number', expression: { kind: 'literal', value: 5 } },
      },
    }
    entityRegistry.register(entityDef)

    const { deps, entityStore } = makeDeps()
    // Prime the store so delete has a record to remove.
    await entityStore.save(entityDef)

    const tools = createAuthoringTools(deps, 'advise')
    const result = await execTool(tools, 'delete_artifact', {
      address: 'my-derived-entity',
    }) as any

    expect(result.deleted).toBe(true)
    expect(result.kind).toBe('entity')
    expect(result.name).toBe('my-derived-entity')

    // Registry was updated
    expect(entityRegistry.get('my-derived-entity')).toBeUndefined()

    // Store was updated
    expect(entityStore._saved.has('my-derived-entity')).toBe(false)
  })

  test('removes a derived component from registry and store', async () => {
    // Register a derived component.
    const componentDef: ComponentDef = {
      name: 'MyDerivedCard',
      kind: 'derived',
      render: { kind: 'literal', value: 'placeholder' } as any,
    }
    componentRegistry.register(componentDef)

    const { deps, componentStore } = makeDeps()
    await componentStore.save(componentDef)

    const tools = createAuthoringTools(deps, 'advise')
    const result = await execTool(tools, 'delete_artifact', {
      address: 'MyDerivedCard',
    }) as any

    expect(result.deleted).toBe(true)
    expect(result.kind).toBe('component')
    expect(result.name).toBe('MyDerivedCard')

    expect(componentRegistry.get('MyDerivedCard')).toBeUndefined()
    expect(componentStore._saved.has('MyDerivedCard')).toBe(false)
  })

  test('errors when trying to delete a base component', async () => {
    // Base components are pre-registered by the ComponentRegistry constructor.
    // Pick any known base component name.
    const baseComponents = componentRegistry.findByKind('base')
    expect(baseComponents.length).toBeGreaterThan(0)
    const baseComponentName = baseComponents[0].name

    const { deps } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'delete_artifact', {
      address: baseComponentName,
    }) as any

    expect(result.error).toMatch(/base/)
  })

  test('errors when trying to delete a plugin entity', async () => {
    // Register a plugin entity.
    entityRegistry.register({
      name: 'plugin-only-entity',
      source: 'plugin',
      pluginName: 'some-plugin',
      fields: {
        result: { kind: 'data', type: 'string', actionName: 'get_status' },
      },
    })

    const { deps } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'delete_artifact', {
      address: 'plugin-only-entity',
    }) as any

    expect(result.error).toMatch(/plugin entity/)
  })

  test('errors when address does not exist in either registry', async () => {
    const { deps } = makeDeps()
    const tools = createAuthoringTools(deps, 'advise')

    const result = await execTool(tools, 'delete_artifact', {
      address: 'does-not-exist',
    }) as any

    expect(result.error).toMatch(/No entity or component found/)
  })

  test('rejects when permitted tier is below advise', async () => {
    const { deps } = makeDeps()
    const informTools = createAuthoringTools(deps, 'inform')

    const result = await execTool(informTools, 'delete_artifact', {
      address: 'anything',
    }) as any

    expect(result.error).toMatch(/exceeds permitted tier/)
  })
})
