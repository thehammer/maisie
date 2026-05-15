import type { LlmClient } from '../../adapter/contract'
import type { LlmUsage } from './anthropic-client'

/**
 * No-op LlmClient used in --dry-run / --offline mode and in tests.
 * Returns canned responses without hitting the network.
 */
export class DryRunLlmClient implements LlmClient {
  async complete(
    prompt: string,
    _opts?: { model?: string; max_tokens?: number; chunk_id?: string },
  ): Promise<string> {
    // Detect extraction-shaped prompts (contain "entities" keyword)
    if (prompt.toLowerCase().includes('entit')) {
      return '{"entities":[],"summary_text":"[dry-run]"}'
    }
    return '[dry-run summary]'
  }

  getUsage(): LlmUsage {
    return { input_tokens: 0, output_tokens: 0, cost_usd: 0 }
  }

  resetUsage(): void {
    // no-op
  }
}
