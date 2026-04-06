import { Hono } from 'hono'
import type { MaisiePlugin } from '@maisie/shared'
import { configurePlugin } from '@maisie/plugin-core'
import { randomUUID } from 'crypto'

export function createPluginsRouter(plugins: MaisiePlugin[]) {
  const router = new Hono()

  // GET /api/plugins — list all plugins with env var specs and current values
  router.get('/plugins', (c) => {
    return c.json({
      plugins: plugins.map((p) => ({
        name: p.name,
        version: p.version,
        description: p.description,
        capabilities: p.capabilities,
        envVars: p.envVars.map((v) => ({
          ...v,
          currentValue: process.env[v.name] ?? null,
        })),
      })),
    })
  })

  // PATCH /api/plugins/:name — update env overrides or enabled state
  router.patch('/plugins/:name', async (c) => {
    const name = c.req.param('name')
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    try {
      const ctx = {
        plugin: 'core',
        requestId: randomUUID(),
        log: (level: string, message: string) => console[level as 'info' | 'warn' | 'error'](`[core] ${message}`),
        emit: (_topic: string, _payload: unknown) => {},
        db: null,
      }
      const result = await configurePlugin.execute(
        { name, ...(body.envOverrides !== undefined && { envOverrides: body.envOverrides as Record<string, string> }), ...(body.enabled !== undefined && { enabled: body.enabled as boolean }) },
        ctx as any,
      )
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  return router
}
