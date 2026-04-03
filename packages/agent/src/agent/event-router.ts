import type { MaisiePlugin, ActionTier } from '@maisie/shared'

export type EventTier = ActionTier | 'ignore'

interface ClassifiedEvent {
  tier: EventTier
  context: string
  pluginName: string
  eventName: string
}

export function createEventRouter(plugins: MaisiePlugin[]) {
  // Build routing table from plugin event declarations
  const rules = plugins.flatMap(plugin =>
    plugin.events.map(event => ({
      topic: event.topic ?? `home/${plugin.name}/${event.name}`,
      tier: event.ai.tier as EventTier,
      context: event.ai.context,
      pluginName: plugin.name,
      eventName: event.name,
    }))
  )

  const lastFired = new Map<string, number>()
  const COOLDOWN_MS = 30_000  // 30 seconds between same-topic agent invocations

  function classify(topic: string): ClassifiedEvent | null {
    const rule = rules.find(r => topicMatches(r.topic, topic))
    if (!rule || rule.tier === 'ignore') return null

    // Cooldown: don't trigger agent too frequently for the same topic
    const now = Date.now()
    const last = lastFired.get(topic) ?? 0
    if (now - last < COOLDOWN_MS) return null
    lastFired.set(topic, now)

    return { tier: rule.tier, context: rule.context, pluginName: rule.pluginName, eventName: rule.eventName }
  }

  return { classify, rules }
}

/** MQTT topic pattern matching with + (single level) and # (multi level) wildcards */
export function topicMatches(pattern: string, topic: string): boolean {
  const patternParts = pattern.split('/')
  const topicParts = topic.split('/')

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] === '#') return true
    if (patternParts[i] === '+') continue
    if (patternParts[i] !== topicParts[i]) return false
    if (i === patternParts.length - 1 && i < topicParts.length - 1) return false
  }

  return patternParts.length === topicParts.length
}

export type EventRouter = ReturnType<typeof createEventRouter>
