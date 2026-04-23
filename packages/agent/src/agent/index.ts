import type { MaisiePlugin } from '@maisie/shared'
import type { AiClient } from '../services/ai'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { createMemoryStore } from './memory'
import { createToolRegistry } from './tool-registry'
import { createEventRouter } from './event-router'
import { createPersonaRouter } from './persona-router'
import { createAgentLoop } from './loop'
import { createDerivedEntityStore } from '@maisie/plugin-core/src/derived-entity-store'
import { createDerivedComponentStore } from '@maisie/plugin-core/src/derived-component-store'

interface AgentConfig {
  plugins: MaisiePlugin[]
  ai: AiClient
  db: BunSQLiteDatabase<any>
  mqtt: {
    subscribe(topic: string, handler: (topic: string, payload: unknown) => void): void
  }
}

export function createAgent(config: AgentConfig) {
  const memory = createMemoryStore(config.db)

  // Build authoring stores from the same db used by the HTTP entity routes.
  // This ensures saves via agent tools and saves via the REST API go to the
  // same SQLite tables and the same in-process registries.
  const authoringDeps = {
    entityStore: createDerivedEntityStore(config.db),
    componentStore: createDerivedComponentStore(config.db),
  }

  const toolRegistry = createToolRegistry(config.plugins, authoringDeps)
  const eventRouter = createEventRouter(config.plugins)
  const personaRouter = createPersonaRouter(config.plugins)

  const loop = createAgentLoop({
    ai: config.ai,
    memory,
    toolRegistry,
    eventRouter,
    personaRouter,
  })

  function start() {
    config.mqtt.subscribe('home/#', async (topic: string, payload: unknown) => {
      await loop.runForEvent(topic, payload)
    })
    console.log('[agent] Maisie agent runtime started')
    console.log(`[agent] Monitoring ${eventRouter.rules.length} event types from ${config.plugins.length} plugins`)
    console.log(`[agent] ${personaRouter.personas.length} personas active: ${personaRouter.personas.map(p => p.persona.name).join(', ')}`)
  }

  return { start, loop, memory, toolRegistry, eventRouter, personaRouter }
}

export type Agent = ReturnType<typeof createAgent>
