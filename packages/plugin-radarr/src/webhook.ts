/**
 * Radarr webhook receiver.
 *
 * Radarr sends JSON POST to Connect webhook endpoints.
 * Register in Radarr Settings → Connect → Add → Webhook:
 *   URL: http://<maisie-host>:3001/api/radarr/webhook
 *   Method: POST
 *   Events: On Grab, On Import, On Upgrade, On Rename, On Movie Delete
 *
 * Events we handle:
 *   Grab    → movie grabbed from indexer
 *   Download/Import → movie downloaded and imported
 *   MovieDelete → movie removed
 */

import { Hono } from 'hono'
import type { MaisieCore } from '@maisie/shared'

export function createRadarrWebhookRouter(getCore: () => MaisieCore | null) {
  const router = new Hono()

  router.post('/webhook', async (c) => {
    const core = getCore()
    if (!core) return c.json({ error: 'not initialized' }, 503)

    try {
      const payload = await c.req.json() as Record<string, unknown>
      const eventType = String(payload.eventType ?? '')

      core.log('radarr', 'info', `Webhook: ${eventType}`)

      const movie = payload.movie as Record<string, unknown> | undefined
      const remoteMovie = payload.remoteMovie as Record<string, unknown> | undefined

      switch (eventType) {
        case 'Grab': {
          const title = String(movie?.title ?? remoteMovie?.title ?? 'Unknown')
          const year = Number(movie?.year ?? remoteMovie?.year ?? 0)
          const quality = String((payload.release as Record<string, unknown>)?.quality ?? '')
          core.mqtt.publish('home/media/radarr/grabbed', { title, year, quality })
          break
        }

        case 'Download': {
          const title = String(movie?.title ?? 'Unknown')
          const year = Number(movie?.year ?? 0)
          const quality = String((payload.movieFile as Record<string, unknown>)?.quality ?? '')
          core.mqtt.publish('home/media/radarr/downloaded', { title, year, quality })
          break
        }

        case 'MovieDelete': {
          core.mqtt.publish('home/media/radarr/movie_deleted', {
            title: String(movie?.title ?? 'Unknown'),
          })
          break
        }

        case 'Test': {
          core.log('radarr', 'info', 'Webhook test received — connection verified')
          break
        }
      }

      return c.json({ ok: true })
    } catch (err) {
      core.log('radarr', 'warn', `Webhook error: ${err instanceof Error ? err.message : err}`)
      return c.json({ error: 'parse error' }, 400)
    }
  })

  return router
}
