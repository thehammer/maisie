import { generateText, streamText, stepCountIs } from 'ai'
import type { AiClient } from '../services/ai'
import type { MemoryStore } from './memory'
import type { ToolRegistry } from './tool-registry'
import type { PersonaRouter } from './persona-router'
import type { EventRouter } from './event-router'
import type { AgentPersona } from '@maisie/shared'

export const MAISIE_SYSTEM_PROMPT = `You are Maisie, the AI operating system for this home.

You are named after "maison" — the French word for house. This is your home to understand, monitor, and operate.

You have a team of specialists: Natalie (network & infrastructure), Channing (TV & streaming), and Alexandria (books & library). You orchestrate them and handle everything that crosses domains.

You know the home's devices, routines, and patterns. You're proactive — you notice things before they become problems. You're concise and direct. You don't pad responses.

When an event occurs, you assess its importance, determine if action is needed, and either act (for clear, low-risk situations) or advise (when human judgment is needed).

You have access to tools from all installed plugins. Use them to give accurate, current answers rather than guessing.`

interface Notification {
  id: string
  message: string
  persona: string
  personaAvatar: string
  timestamp: Date
  dismissed: boolean
}

export function createAgentLoop(config: {
  ai: AiClient
  memory: MemoryStore
  toolRegistry: ToolRegistry
  personaRouter: PersonaRouter
  eventRouter: EventRouter
}) {
  const notifications: Notification[] = []

  async function runForEvent(topic: string, payload: unknown): Promise<void> {
    const classified = config.eventRouter.classify(topic)
    if (!classified) return

    const persona = config.personaRouter.routeEvent(topic)
    const systemPrompt = persona?.systemPrompt ?? MAISIE_SYSTEM_PROMPT
    const personaName = persona?.name ?? 'Maisie'
    const tools = config.toolRegistry.toSdkTools(persona?.toolScopes)

    const recentEpisodes = await config.memory.getRecentEpisodes(5, personaName.toLowerCase())
    const facts = await config.memory.getAllFacts()

    const userContent = buildEventContext(topic, payload, classified.context, recentEpisodes, facts)

    try {
      const useThinking = classified.tier === 'advise' || classified.tier === 'act'
      const modelId = useThinking ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'

      const result = await generateText({
        model: config.ai.getModel(modelId),
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
        tools: Object.keys(tools).length > 0 ? tools as any : undefined,
        stopWhen: stepCountIs(classified.tier === 'act' ? 5 : 2),
      })

      const episode = {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        trigger: topic,
        persona: personaName.toLowerCase(),
        summary: result.text,
        toolsUsed: result.toolCalls?.map((t: any) => t.toolName) ?? [],
        outcome: classified.tier as 'informed' | 'advised' | 'acted',
      }

      await config.memory.logEpisode(episode)

      if (classified.tier === 'advise') {
        notifications.push({
          id: episode.id,
          message: result.text,
          persona: personaName,
          personaAvatar: persona?.avatar ?? '🤖',
          timestamp: new Date(),
          dismissed: false,
        })
        // Keep max 50 notifications
        while (notifications.length > 50) notifications.shift()
      }
    } catch (err) {
      console.error(`[agent] Error processing event ${topic}:`, err)
    }
  }

  async function* runForMessage(
    userMessage: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): AsyncGenerator<string> {
    const persona = config.personaRouter.routeMessage(userMessage)
    const systemPrompt = persona?.systemPrompt ?? MAISIE_SYSTEM_PROMPT
    const personaName = persona?.name ?? 'Maisie'
    const tools = config.toolRegistry.toSdkTools(persona?.toolScopes)

    const facts = await config.memory.getAllFacts()
    const factContext = Object.keys(facts).length > 0
      ? `\n\nKnown facts about this home:\n${JSON.stringify(facts, null, 2)}`
      : ''

    const messages = [
      ...history,
      { role: 'user' as const, content: userMessage },
    ]

    try {
      const result = streamText({
        model: config.ai.getModel('claude-sonnet-4-5'),
        system: systemPrompt + factContext,
        messages,
        tools: Object.keys(tools).length > 0 ? tools as any : undefined,
        stopWhen: stepCountIs(5),
      })

      let fullResponse = ''
      for await (const chunk of result.textStream) {
        fullResponse += chunk
        yield chunk
      }

      await config.memory.logEpisode({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        trigger: 'user_message',
        persona: personaName.toLowerCase(),
        summary: fullResponse.slice(0, 500),
        toolsUsed: [],
        outcome: 'informed',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      yield `I encountered an error: ${msg}`
    }
  }

  function getNotifications() {
    return notifications.filter(n => !n.dismissed)
  }

  function dismissNotification(id: string) {
    const n = notifications.find(n => n.id === id)
    if (n) n.dismissed = true
  }

  return { runForEvent, runForMessage, getNotifications, dismissNotification, notifications }
}

function buildEventContext(
  topic: string,
  payload: unknown,
  context: string,
  recentEpisodes: any[],
  facts: Record<string, unknown>
): string {
  const parts = [`Event: ${topic}`, `Context: ${context}`]

  if (payload && typeof payload === 'object') {
    parts.push(`Payload: ${JSON.stringify(payload)}`)
  }

  if (recentEpisodes.length > 0) {
    parts.push(`\nRecent history (last ${recentEpisodes.length} episodes):`)
    recentEpisodes.forEach(e => {
      parts.push(`- [${e.timestamp.toISOString()}] ${e.summary.slice(0, 100)}`)
    })
  }

  if (Object.keys(facts).length > 0) {
    parts.push(`\nKnown facts: ${JSON.stringify(facts)}`)
  }

  return parts.join('\n')
}

export type AgentLoop = ReturnType<typeof createAgentLoop>
