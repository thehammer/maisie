import { describe, test, expect } from 'bun:test'
import { createToolRegistry } from '../tool-registry'
import type { MaisiePlugin } from '@maisie/shared'
import { z } from 'zod'

const searchAction = {
  name: 'search_books',
  description: 'Search the book library',
  input: z.object({ query: z.string() }),
  output: z.object({ books: z.array(z.string()) }),
  http: { method: 'GET' as const },
  ai: { tier: 'inform' as const, description: 'Search books by title or author' },
  ui: { label: 'Search Books', section: 'library' },
  execute: async (input: { query: string }) => ({ books: [`Book matching: ${input.query}`] }),
}

const countAction = {
  name: 'get_book_count',
  description: 'Get total book count',
  input: z.object({}),
  output: z.object({ count: z.number() }),
  http: { method: 'GET' as const },
  ai: { tier: 'inform' as const },
  ui: { label: 'Book Count', section: 'library' },
  execute: async () => ({ count: 42 }),
}

const noAiAction = {
  name: 'internal_sync',
  description: 'Internal sync — not exposed to AI',
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  http: { method: 'POST' as const },
  ai: false as const,
  ui: false as const,
  execute: async () => ({ ok: true }),
}

const calibrePlugin: MaisiePlugin = {
  name: 'calibre',
  version: '0.1.0',
  description: 'Calibre library',
  capabilities: ['book-library'],
  envVars: [],
  actions: [searchAction, countAction, noAiAction],
  events: [],
  async init() {},
  async shutdown() {},
  async healthCheck() { return { status: 'healthy', lastCheck: new Date() } },
}

describe('ToolRegistry', () => {
  test('assembles tools from plugin actions with ai config', () => {
    const registry = createToolRegistry([calibrePlugin])
    expect(registry.allActions).toHaveLength(2)  // noAiAction excluded

    const names = registry.allActions.map(a => a.action.name)
    expect(names).toContain('search_books')
    expect(names).toContain('get_book_count')
    expect(names).not.toContain('internal_sync')
  })

  test('excludes actions with ai: false', () => {
    const registry = createToolRegistry([calibrePlugin])
    const toolNames = Object.keys(registry.toSdkTools())
    expect(toolNames).not.toContain('internal_sync')
  })

  // The 4 generic tools (resolve_address, invoke_address, run_pipeline, list_entities)
  // are always included alongside plugin-action tools.
  const GENERIC_TOOL_COUNT = 4

  test('toSdkTools returns executable tools', () => {
    const registry = createToolRegistry([calibrePlugin])
    const tools = registry.toSdkTools()
    // 2 plugin actions + 4 generic tools
    expect(Object.keys(tools)).toHaveLength(2 + GENERIC_TOOL_COUNT)
    expect(tools['search_books']).toBeDefined()
    expect(tools['get_book_count']).toBeDefined()
    expect(tools['resolve_address']).toBeDefined()
    expect(tools['invoke_address']).toBeDefined()
    expect(tools['run_pipeline']).toBeDefined()
    expect(tools['list_entities']).toBeDefined()
  })

  test('filters by toolScopes (generic tools always included)', () => {
    const registry = createToolRegistry([calibrePlugin])
    const tools = registry.toSdkTools(['search_books'])
    // scope filter applies to plugin actions; generic tools always present
    expect(Object.keys(tools)).toHaveLength(1 + GENERIC_TOOL_COUNT)
    expect(tools['search_books']).toBeDefined()
    expect(tools['get_book_count']).toBeUndefined()
    expect(tools['resolve_address']).toBeDefined()
  })

  test('empty scopes array returns only generic tools', () => {
    const registry = createToolRegistry([calibrePlugin])
    const tools = registry.toSdkTools([])
    // No plugin actions, but generic tools remain
    expect(Object.keys(tools)).toHaveLength(GENERIC_TOOL_COUNT)
    expect(tools['resolve_address']).toBeDefined()
  })

  test('getActionsByTier filters correctly', () => {
    const registry = createToolRegistry([calibrePlugin])
    const informActions = registry.getActionsByTier('inform')
    expect(informActions).toHaveLength(2)

    const actActions = registry.getActionsByTier('act')
    expect(actActions).toHaveLength(0)
  })

  test('works with zero plugins (generic tools still present)', () => {
    const registry = createToolRegistry([])
    expect(registry.allActions).toHaveLength(0)
    const tools = registry.toSdkTools()
    expect(Object.keys(tools)).toHaveLength(GENERIC_TOOL_COUNT)
    expect(tools['resolve_address']).toBeDefined()
    expect(tools['invoke_address']).toBeDefined()
    expect(tools['run_pipeline']).toBeDefined()
    expect(tools['list_entities']).toBeDefined()
  })

  test('merges actions from multiple plugins', () => {
    const unifiPlugin: MaisiePlugin = {
      name: 'unifi',
      version: '0.1.0',
      description: 'UniFi',
      capabilities: ['network'],
      envVars: [],
      actions: [{
        name: 'get_devices',
        description: 'Get devices',
        input: z.object({}),
        output: z.array(z.string()),
        http: { method: 'GET' as const },
        ai: { tier: 'inform' as const },
        ui: false as const,
        execute: async () => [],
      }],
      events: [],
      async init() {},
      async shutdown() {},
      async healthCheck() { return { status: 'healthy', lastCheck: new Date() } },
    }

    const registry = createToolRegistry([calibrePlugin, unifiPlugin])
    expect(registry.allActions).toHaveLength(3)  // 2 from calibre + 1 from unifi

    const tools = registry.toSdkTools()
    expect(tools['get_devices']).toBeDefined()
    expect(tools['search_books']).toBeDefined()
  })
})
