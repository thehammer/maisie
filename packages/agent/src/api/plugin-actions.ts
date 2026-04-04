/**
 * Generic action router — auto-registers HTTP routes for all plugin actions.
 *
 * Route pattern: /api/{plugin.name}/{derived-path}
 *
 * Input handling:
 *   GET  → query params (all values are strings — coerce booleans/numbers)
 *   POST/PATCH/DELETE → JSON body
 *
 * This runs AFTER hand-written domain routers so existing routes take precedence
 * during the migration period. New plugins built against the protocol get their
 * routes for free here.
 */

import { Hono } from 'hono'
import type { MaisiePlugin, ActionContext } from '@maisie/shared'
import { registry, deriveHttpPath } from '@maisie/plugin-core'
import type { Services } from './types'
import { randomUUID } from 'crypto'

function makeContext(pluginName: string, services: Services): ActionContext {
  return {
    plugin: pluginName,
    requestId: randomUUID(),
    log(level, message, data) {
      const tag = `[${pluginName}]`
      if (level === 'error') console.error(tag, message, data ?? '')
      else if (level === 'warn') console.warn(tag, message, data ?? '')
      else console.log(tag, message, data ?? '')
    },
    emit(topic, payload) {
      services.db // access db to satisfy linter (unused otherwise)
      // MQTT publish — imported lazily to avoid circular dep
      try {
        const { publish } = require('../services/mqtt')
        publish(topic, payload)
      } catch {
        // mqtt not available in test environments
      }
    },
    db: services.db,
  }
}

/**
 * Coerce GET query param strings to the types the Zod schema expects.
 * Zod will handle actual validation — this just converts obvious primitives
 * so 'true'/'false' and numeric strings parse correctly.
 */
function coerceQueryParams(params: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === 'true') result[key] = true
    else if (value === 'false') result[key] = false
    else if (value !== '' && !isNaN(Number(value))) result[key] = Number(value)
    else result[key] = value
  }
  return result
}

export function createPluginActionRouter(plugins: MaisiePlugin[], services: Services) {
  // Register all plugins with the registry
  for (const plugin of plugins) {
    registry.register(plugin, (msg) => console.log(msg))
  }

  const app = new Hono()

  for (const plugin of plugins) {
    for (const action of plugin.actions) {
      const path = deriveHttpPath(action)
      const method = action.http.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'

      app[method](`/${plugin.name}${path}`, async (c) => {
        try {
          let rawInput: unknown
          if (action.http.method === 'GET') {
            rawInput = coerceQueryParams(c.req.query())
          } else {
            rawInput = await c.req.json().catch(() => ({}))
          }

          const parsed = action.input.safeParse(rawInput)
          if (!parsed.success) {
            return c.json({ error: 'Invalid input', issues: parsed.error.issues }, 400)
          }

          const ctx = makeContext(plugin.name, services)
          const result = await action.execute(parsed.data, ctx)
          return c.json(result)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const status = message.includes('not configured') ? 503 : 500
          return c.json({ error: message }, status)
        }
      })
    }
  }

  return app
}
