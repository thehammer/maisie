import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { Agent } from '../agent/index'

export function createChatRouter(agent: Agent) {
  const router = new Hono()

  // POST /api/chat — streaming SSE response
  router.post('/chat', async (c) => {
    const body = await c.req.json()
    const message: string = body.message ?? ''
    const history = body.history ?? []

    if (!message.trim()) {
      return c.json({ error: 'message is required' }, 400)
    }

    return streamSSE(c, async (stream) => {
      for await (const chunk of agent.loop.runForMessage(message, history)) {
        await stream.writeSSE({ data: chunk })
      }
      await stream.writeSSE({ data: '[DONE]' })
    })
  })

  // GET /api/agent/notifications — pending advise-tier notifications
  router.get('/agent/notifications', (c) => {
    return c.json(agent.loop.getNotifications())
  })

  // POST /api/agent/notifications/:id/dismiss
  router.post('/agent/notifications/:id/dismiss', (c) => {
    const id = c.req.param('id')
    agent.loop.dismissNotification(id)
    return c.json({ success: true })
  })

  // GET /api/agent/facts — current memory facts
  router.get('/agent/facts', async (c) => {
    const facts = await agent.memory.getAllFacts()
    return c.json(facts)
  })

  // GET /api/agent/episodes — recent episode history
  router.get('/agent/episodes', async (c) => {
    const limit = Number(c.req.query('limit') ?? 20)
    const persona = c.req.query('persona')
    const episodes = await agent.memory.getRecentEpisodes(limit, persona)
    return c.json(episodes)
  })

  // GET /api/agent/status — agent health and persona list
  router.get('/agent/status', (c) => {
    return c.json({
      status: 'active',
      personas: agent.personaRouter.personas.map(({ persona }) => ({
        name: persona.name,
        role: persona.role,
        avatar: persona.avatar,
        defaultTier: persona.defaultTier,
      })),
      eventRules: agent.eventRouter.rules.length,
      tools: agent.toolRegistry.allActions.length,
    })
  })

  return router
}
