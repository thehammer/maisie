import { describe, it, expect } from 'bun:test'
import { AnthropicLlmClient } from '../../pipeline/llm/anthropic-client'

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

function makeMockFetch(response: unknown, status = 200): typeof globalThis.fetch {
  return async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    })
}

function makeAnthropicResponse(text: string, inputTokens = 10, outputTokens = 20) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-20250514',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
}

function makeErrorResponse(type: string, message: string) {
  return { type: 'error', error: { type, message } }
}

const TEST_API_KEY = 'test-key-not-real'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnthropicLlmClient — constructor guard', () => {
  it('throws when ANTHROPIC_API_KEY is missing and no apiKey option provided', () => {
    const savedKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    expect(() => new AnthropicLlmClient()).toThrow(/ANTHROPIC_API_KEY/)

    if (savedKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedKey
    }
  })

  it('constructs successfully when apiKey is provided via options', () => {
    const client = new AnthropicLlmClient({
      apiKey: TEST_API_KEY,
      fetch: makeMockFetch(makeAnthropicResponse('hi')),
    })
    expect(client).toBeDefined()
  })
})

describe('AnthropicLlmClient — complete()', () => {
  it('returns concatenated text content from a successful response', async () => {
    const client = new AnthropicLlmClient({
      apiKey: TEST_API_KEY,
      fetch: makeMockFetch(makeAnthropicResponse('Hello world')),
    })

    const result = await client.complete('Say hi')
    expect(result).toBe('Hello world')
  })

  it('tracks input and output tokens', async () => {
    const client = new AnthropicLlmClient({
      apiKey: TEST_API_KEY,
      fetch: makeMockFetch(makeAnthropicResponse('Response', 100, 50)),
    })

    await client.complete('Test prompt')
    const usage = client.getUsage()
    expect(usage.input_tokens).toBe(100)
    expect(usage.output_tokens).toBe(50)
    expect(usage.cost_usd).toBeGreaterThan(0)
  })

  it('resets usage counters', async () => {
    const client = new AnthropicLlmClient({
      apiKey: TEST_API_KEY,
      fetch: makeMockFetch(makeAnthropicResponse('Result', 100, 50)),
    })

    await client.complete('Test')
    expect(client.getUsage().input_tokens).toBe(100)

    client.resetUsage()
    expect(client.getUsage().input_tokens).toBe(0)
    expect(client.getUsage().cost_usd).toBe(0)
  })

  it('uses claude-sonnet-4-20250514 as default model', async () => {
    let capturedBody: Record<string, unknown> | null = null
    const capturingFetch: typeof globalThis.fetch = async (_input, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>
      return new Response(JSON.stringify(makeAnthropicResponse('ok')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const client = new AnthropicLlmClient({ apiKey: TEST_API_KEY, fetch: capturingFetch })
    await client.complete('hello')

    expect(capturedBody?.model).toBe('claude-sonnet-4-20250514')
  })
})

describe('AnthropicLlmClient — retry on 429', () => {
  it('retries once on 429 then gives up on second failure', async () => {
    let callCount = 0
    const alwaysRateLimitFetch: typeof globalThis.fetch = async () => {
      callCount++
      return new Response(
        JSON.stringify(makeErrorResponse('rate_limit_error', 'rate limited')),
        { status: 429, headers: { 'content-type': 'application/json' } },
      )
    }

    const client = new AnthropicLlmClient({ apiKey: TEST_API_KEY, fetch: alwaysRateLimitFetch })
    await expect(client.complete('Test')).rejects.toThrow()
    // Original + 1 retry = 2 attempts minimum
    expect(callCount).toBeGreaterThanOrEqual(2)
  })

  it('succeeds on retry after an initial 429', async () => {
    let callCount = 0
    const retryFetch: typeof globalThis.fetch = async () => {
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify(makeErrorResponse('rate_limit_error', 'rate limited')),
          { status: 429, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify(makeAnthropicResponse('success on retry')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const client = new AnthropicLlmClient({ apiKey: TEST_API_KEY, fetch: retryFetch })
    const result = await client.complete('Test')
    expect(result).toBe('success on retry')
    expect(callCount).toBe(2)
  })
})
