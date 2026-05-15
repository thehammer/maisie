import { describe, it, expect } from 'bun:test'

// ---------------------------------------------------------------------------
// register-tools tests
//
// NOTE: @modelcontextprotocol/sdk types are used as `any` here because the
// package will be added when the MCP transport is implemented. The test
// verifies behavior through a minimal stub server and stub QueryService.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stub MCP server — captures handlers registered via setRequestHandler
// ---------------------------------------------------------------------------

type HandlerMap = Record<string, (request: unknown) => Promise<unknown>>

function makeStubServer(): { server: { setRequestHandler(schema: { name?: string; $id?: string }, handler: (req: unknown) => Promise<unknown>): void }; handlers: HandlerMap } {
  const handlers: HandlerMap = {}
  const server = {
    setRequestHandler(schema: { name?: string; $id?: string }, handler: (req: unknown) => Promise<unknown>): void {
      // Use schema name or $id as the key
      const key = (schema as Record<string, unknown>).method as string ?? schema.name ?? schema.$id ?? JSON.stringify(schema)
      handlers[key] = handler
    },
  }
  return { server, handlers }
}

// ---------------------------------------------------------------------------
// Stub QueryService — returns preset ToolResult values
// ---------------------------------------------------------------------------

const MOCK_SUCCESS = {
  ok: true as const,
  data: { items: [] },
  scope_applied: {},
  generated_at: '2025-01-15T12:00:00.000Z',
}

const MOCK_NOT_FOUND = {
  ok: false as const,
  kind: 'not_found' as const,
  suggestions: ['try something else'],
}

const MOCK_ERROR = {
  ok: false as const,
  kind: 'error' as const,
  code: 'corpus_not_found',
  message: 'not found',
  retriable: false,
}

function makeStubQueryService(overrides: Record<string, unknown> = {}): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const defaults: Record<string, () => Promise<unknown>> = {
    corpus_list: async () => MOCK_SUCCESS,
    corpus_overview: async () => MOCK_SUCCESS,
    search: async () => MOCK_SUCCESS,
    entity: async () => MOCK_SUCCESS,
    entity_edges: async () => MOCK_SUCCESS,
    entity_meet: async () => MOCK_SUCCESS,
    read: async () => MOCK_SUCCESS,
    summarize: async () => MOCK_SUCCESS,
    related: async () => MOCK_SUCCESS,
  }
  return { ...defaults, ...overrides } as Record<string, (...args: unknown[]) => Promise<unknown>>
}

// ---------------------------------------------------------------------------
// Import the real implementation (will fail until it's built — that's correct)
// ---------------------------------------------------------------------------

import { registerTools } from '../../mcp/register-tools'

// ---------------------------------------------------------------------------
// Tool registration shape
// ---------------------------------------------------------------------------

const EXPECTED_TOOL_NAMES = [
  'corpus_list',
  'corpus_overview',
  'search',
  'entity',
  'entity_edges',
  'entity_meet',
  'read',
  'summarize',
  'related',
]

describe('registerTools — ListToolsRequest handler', () => {
  it('registers a handler for tools/list', async () => {
    const { server, handlers } = makeStubServer()
    const queryService = makeStubQueryService()
    registerTools(server as unknown as Parameters<typeof registerTools>[0], queryService as unknown as Parameters<typeof registerTools>[1])

    expect('tools/list' in handlers).toBe(true)
  })

  it('returns exactly 9 tools', async () => {
    const { server, handlers } = makeStubServer()
    const queryService = makeStubQueryService()
    registerTools(server as unknown as Parameters<typeof registerTools>[0], queryService as unknown as Parameters<typeof registerTools>[1])

    const listHandler = handlers['tools/list']
    const response = await listHandler({}) as { tools: unknown[] }
    expect(response.tools).toHaveLength(9)
  })

  it('each tool has a non-empty name, description, and inputSchema', async () => {
    const { server, handlers } = makeStubServer()
    const queryService = makeStubQueryService()
    registerTools(server as unknown as Parameters<typeof registerTools>[0], queryService as unknown as Parameters<typeof registerTools>[1])

    const listHandler = handlers['tools/list']
    const response = await listHandler({}) as { tools: Array<{ name: string; description: string; inputSchema: unknown }> }

    for (const tool of response.tools) {
      expect(typeof tool.name).toBe('string')
      expect(tool.name.length).toBeGreaterThan(0)
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.inputSchema).toBeDefined()
    }
  })

  it('includes all 9 expected tool names', async () => {
    const { server, handlers } = makeStubServer()
    const queryService = makeStubQueryService()
    registerTools(server as unknown as Parameters<typeof registerTools>[0], queryService as unknown as Parameters<typeof registerTools>[1])

    const listHandler = handlers['tools/list']
    const response = await listHandler({}) as { tools: Array<{ name: string }> }
    const names = response.tools.map((t) => t.name)

    for (const expected of EXPECTED_TOOL_NAMES) {
      expect(names).toContain(expected)
    }
  })
})

describe('registerTools — CallToolRequest routing', () => {
  it('routes corpus_list call to queryService.corpus_list', async () => {
    let called = false
    const queryService = makeStubQueryService({
      corpus_list: async () => {
        called = true
        return MOCK_SUCCESS
      },
    })
    const { server, handlers } = makeStubServer()
    registerTools(server as unknown as Parameters<typeof registerTools>[0], queryService as unknown as Parameters<typeof registerTools>[1])

    const callHandler = handlers['tools/call']
    await callHandler({ params: { name: 'corpus_list', arguments: {} } })
    expect(called).toBe(true)
  })

  it('routes each tool name to the corresponding QueryService method', async () => {
    const callLog: string[] = []
    const queryService = makeStubQueryService(
      Object.fromEntries(
        EXPECTED_TOOL_NAMES.map((name) => [
          name,
          async (..._args: unknown[]) => {
            callLog.push(name)
            return MOCK_SUCCESS
          },
        ]),
      ),
    )
    const { server, handlers } = makeStubServer()
    registerTools(server as unknown as Parameters<typeof registerTools>[0], queryService as unknown as Parameters<typeof registerTools>[1])

    const callHandler = handlers['tools/call']
    for (const name of EXPECTED_TOOL_NAMES) {
      await callHandler({ params: { name, arguments: {} } })
    }

    for (const name of EXPECTED_TOOL_NAMES) {
      expect(callLog).toContain(name)
    }
  })

  it('returns isError:false and text content for a Success result', async () => {
    const { server, handlers } = makeStubServer()
    const queryService = makeStubQueryService()
    registerTools(server as unknown as Parameters<typeof registerTools>[0], queryService as unknown as Parameters<typeof registerTools>[1])

    const callHandler = handlers['tools/call']
    const response = await callHandler({ params: { name: 'corpus_list', arguments: {} } }) as {
      content: Array<{ type: string; text: string }>
      isError: boolean
    }

    expect(response.isError).toBe(false)
    expect(response.content).toHaveLength(1)
    expect(response.content[0].type).toBe('text')
    const parsed = JSON.parse(response.content[0].text)
    expect(parsed.ok).toBe(true)
  })

  it('returns isError:true for a NotFound result', async () => {
    const queryService = makeStubQueryService({
      entity: async () => MOCK_NOT_FOUND,
    })
    const { server, handlers } = makeStubServer()
    registerTools(server as unknown as Parameters<typeof registerTools>[0], queryService as unknown as Parameters<typeof registerTools>[1])

    const callHandler = handlers['tools/call']
    const response = await callHandler({ params: { name: 'entity', arguments: {} } }) as { isError: boolean }
    expect(response.isError).toBe(true)
  })

  it('returns isError:true for an ErrorResult', async () => {
    const queryService = makeStubQueryService({
      search: async () => MOCK_ERROR,
    })
    const { server, handlers } = makeStubServer()
    registerTools(server as unknown as Parameters<typeof registerTools>[0], queryService as unknown as Parameters<typeof registerTools>[1])

    const callHandler = handlers['tools/call']
    const response = await callHandler({ params: { name: 'search', arguments: {} } }) as { isError: boolean }
    expect(response.isError).toBe(true)
  })

  it('serializes the full ToolResult as JSON in the text content field', async () => {
    const { server, handlers } = makeStubServer()
    const queryService = makeStubQueryService({
      corpus_overview: async () => MOCK_NOT_FOUND,
    })
    registerTools(server as unknown as Parameters<typeof registerTools>[0], queryService as unknown as Parameters<typeof registerTools>[1])

    const callHandler = handlers['tools/call']
    const response = await callHandler({ params: { name: 'corpus_overview', arguments: {} } }) as {
      content: Array<{ text: string }>
    }

    const parsed = JSON.parse(response.content[0].text)
    expect(parsed.ok).toBe(false)
    expect(parsed.kind).toBe('not_found')
  })
})
