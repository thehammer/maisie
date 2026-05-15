import Anthropic from '@anthropic-ai/sdk'
import type { LlmClient } from '../../adapter/contract'

// Pricing constants for claude-sonnet-4-20250514 (update when rates change)
const PRICING = {
  input_per_million: 3.0,
  output_per_million: 15.0,
} as const

export interface AnthropicLlmClientOptions {
  model?: string
  apiKey?: string
  /** Override fetch implementation — used in tests to avoid real HTTP calls */
  fetch?: typeof globalThis.fetch
}

export interface LlmUsage {
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic
  private readonly defaultModel: string
  private inputTokens = 0
  private outputTokens = 0

  constructor(opts: AnthropicLlmClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. ' +
          'Set the environment variable or pass apiKey in the constructor options.',
      )
    }
    this.client = new Anthropic({ apiKey, ...(opts.fetch ? { fetch: opts.fetch } : {}) })
    this.defaultModel = opts.model ?? 'claude-sonnet-4-20250514'
  }

  async complete(
    prompt: string,
    opts?: { model?: string; max_tokens?: number; chunk_id?: string },
  ): Promise<string> {
    const model = opts?.model ?? this.defaultModel
    const max_tokens = opts?.max_tokens ?? 1500

    const attempt = async (): Promise<Anthropic.Message> => {
      return this.client.messages.create({
        model,
        max_tokens,
        messages: [{ role: 'user', content: prompt }],
      })
    }

    let response: Anthropic.Message
    try {
      response = await attempt()
    } catch (err) {
      // One retry on 429 / 500-class errors
      if (isRetryableError(err)) {
        await sleep(300)
        try {
          response = await attempt()
        } catch (err2) {
          await sleep(1200)
          throw enrichError(err2, opts?.chunk_id)
        }
      } else {
        throw enrichError(err, opts?.chunk_id)
      }
    }

    // Track usage
    if (response.usage) {
      this.inputTokens += response.usage.input_tokens
      this.outputTokens += response.usage.output_tokens
    }

    // Extract text content
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
  }

  getUsage(): LlmUsage {
    const cost_usd =
      (this.inputTokens / 1_000_000) * PRICING.input_per_million +
      (this.outputTokens / 1_000_000) * PRICING.output_per_million
    return {
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
      cost_usd,
    }
  }

  resetUsage(): void {
    this.inputTokens = 0
    this.outputTokens = 0
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRetryableError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    const status = err.status
    return status === 429 || (status !== undefined && status >= 500 && status < 600)
  }
  return false
}

function enrichError(err: unknown, chunkId?: string): Error {
  const base = err instanceof Error ? err : new Error(String(err))
  if (chunkId) {
    return new Error(`[chunk ${chunkId}] ${base.message}`, { cause: base })
  }
  return base
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
