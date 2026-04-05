import type { MaisiePlugin, AgentPersona } from '@maisie/shared'
import { topicMatches } from './event-router'

export function createPersonaRouter(plugins: MaisiePlugin[]) {
  const seen = new Set<string>()
  const personas = plugins
    .filter(p => p.persona != null)
    .map(p => ({ plugin: p.name, persona: p.persona! }))
    .filter(({ persona }) => {
      if (seen.has(persona.name)) return false
      seen.add(persona.name)
      return true
    })

  function routeEvent(topic: string): AgentPersona | null {
    for (const { persona } of personas) {
      if (persona.eventSubscriptions.some(pattern => topicMatches(pattern, topic))) {
        return persona
      }
    }
    return null  // Maisie handles it
  }

  function routeMessage(message: string): AgentPersona | null {
    const atMatch = message.match(/^@(\w+)\s/i)
    if (atMatch) {
      const name = atMatch[1].toLowerCase()
      const found = personas.find(p => p.persona.name.toLowerCase() === name)
      return found?.persona ?? null
    }
    return null  // Maisie handles unaddressed messages
  }

  return { routeEvent, routeMessage, personas }
}

export type PersonaRouter = ReturnType<typeof createPersonaRouter>
