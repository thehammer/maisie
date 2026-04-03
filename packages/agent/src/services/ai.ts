import { generateText, generateObject, streamText, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

type Provider = "anthropic" | "openai" | "ollama";

interface AiConfig {
  provider: Provider;
  apiKey?: string;
  model?: string;
  baseURL?: string; // for ollama
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface CompleteOptions {
  messages: Message[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

interface CompleteResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

interface GenerateOptions<T> extends CompleteOptions {
  schema: z.ZodSchema<T>;
  schemaName?: string;
  thinking?: boolean;
  thinkingBudget?: number;
}

export function createAiClient(config: AiConfig) {
  function getModel(modelOverride?: string) {
    const modelId = modelOverride ?? config.model;

    if (config.provider === "anthropic") {
      const anthropic = createAnthropic({ apiKey: config.apiKey });
      return anthropic(modelId ?? "claude-haiku-4-5-20251001");
    }

    if (config.provider === "openai") {
      const openai = createOpenAI({ apiKey: config.apiKey });
      return openai(modelId ?? "gpt-4o-mini");
    }

    // ollama — use openai-compatible endpoint
    const ollama = createOpenAI({
      baseURL: config.baseURL ?? "http://localhost:11434/v1",
      apiKey: "ollama",
    });
    return ollama(modelId ?? "llama3");
  }

  async function complete(options: CompleteOptions): Promise<CompleteResult> {
    const messages = options.messages.filter((m) => m.role !== "system");
    const system =
      options.system ?? options.messages.find((m) => m.role === "system")?.content;

    const result = await generateText({
      model: getModel(options.model),
      messages: messages as any,
      system,
      maxOutputTokens: options.maxTokens ?? 1024,
      temperature: options.temperature,
    });

    return {
      content: result.text,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    };
  }

  async function generate<T>(options: GenerateOptions<T>): Promise<T> {
    const messages = options.messages.filter((m) => m.role !== "system");
    const system =
      options.system ?? options.messages.find((m) => m.role === "system")?.content;

    const modelId = options.model ?? config.model;

    // Extended thinking: only works with Anthropic, requires temperature=1
    // and a Sonnet/Opus model. Build params explicitly to keep TS happy.
    if (options.thinking && config.provider === "anthropic") {
      const thinkingModel = getModel(
        modelId?.includes("haiku") ? "claude-sonnet-4-5-20251001" : modelId
      );
      const result = await (generateObject as any)({
        model: thinkingModel,
        messages,
        system,
        schema: options.schema,
        schemaName: options.schemaName,
        maxOutputTokens: options.maxTokens ?? 2048,
        temperature: 1,
        providerOptions: {
          anthropic: {
            thinking: {
              type: "enabled",
              budgetTokens: options.thinkingBudget ?? 8000,
            },
          },
        },
      });
      return result.object;
    }

    const result = await (generateObject as any)({
      model: getModel(modelId),
      messages,
      system,
      schema: options.schema,
      schemaName: options.schemaName,
      maxOutputTokens: options.maxTokens ?? 2048,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    });

    return result.object;
  }

  async function* stream(
    options: CompleteOptions & {
      tools?: Record<string, unknown>;
      maxSteps?: number;
    }
  ): AsyncGenerator<string> {
    const messages = options.messages.filter((m) => m.role !== "system");
    const system =
      options.system ?? options.messages.find((m) => m.role === "system")?.content;

    const result = streamText({
      model: getModel(options.model),
      messages: messages as any,
      system,
      maxOutputTokens: options.maxTokens,
      temperature: options.temperature,
      tools: options.tools as any,
      ...(options.maxSteps !== undefined
        ? { stopWhen: stepCountIs(options.maxSteps) }
        : {}),
    });

    for await (const chunk of result.textStream) {
      yield chunk;
    }
  }

  return { complete, generate, stream, getModel };
}

export type AiClient = ReturnType<typeof createAiClient>;

export function createAiClientFromEnv(): AiClient | null {
  const provider = (process.env.AI_PROVIDER ?? "anthropic") as Provider;

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return createAiClient({ provider, apiKey, model: process.env.AI_MODEL });
  }

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    return createAiClient({ provider, apiKey, model: process.env.AI_MODEL });
  }

  if (provider === "ollama") {
    return createAiClient({
      provider,
      baseURL: process.env.OLLAMA_HOST ?? "http://localhost:11434/v1",
      model: process.env.AI_MODEL ?? "llama3",
    });
  }

  return null;
}
