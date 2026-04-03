interface AnthropicConfig {
  apiKey: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface CompletionOptions {
  model?: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

interface CompletionResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export function createAnthropicClient(config: AnthropicConfig) {
  async function complete(options: CompletionOptions): Promise<CompletionResponse> {
    const body: Record<string, unknown> = {
      model: options.model || "claude-haiku-4-5-20251001",
      max_tokens: options.maxTokens || 1024,
      messages: options.messages,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.system) body.system = options.system;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${text}`);
    }

    const json = await res.json() as any;
    const textBlock = json.content?.find((b: any) => b.type === "text");

    return {
      content: textBlock?.text || "",
      model: json.model,
      inputTokens: json.usage?.input_tokens || 0,
      outputTokens: json.usage?.output_tokens || 0,
    };
  }

  return { complete };
}

export type AnthropicClient = ReturnType<typeof createAnthropicClient>;

export function createAnthropicClientFromEnv() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return createAnthropicClient({ apiKey });
}
