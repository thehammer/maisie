import { Hono } from 'hono'
import type { MaisiePlugin } from '@maisie/shared'

export function createPluginsRouter(plugins: MaisiePlugin[]) {
  const router = new Hono()

  router.get('/plugins', (c) => {
    return c.json({
      plugins: plugins.map((p) => ({
        name: p.name,
        version: p.version,
        description: p.description,
        capabilities: p.capabilities,
        envVars: p.envVars,
      })),
    })
  })

  return router
}
