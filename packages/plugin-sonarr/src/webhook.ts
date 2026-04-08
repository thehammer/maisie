/**
 * Sonarr webhook receiver.
 *
 * Sonarr sends JSON POST to Connect webhook endpoints.
 * Register in Sonarr Settings → Connect → Add → Webhook:
 *   URL: http://<maisie-host>:3001/api/sonarr/webhook
 *   Method: POST
 *   Events: On Grab, On Import, On Upgrade, On Rename, On Series Delete
 *
 * Events we handle:
 *   Grab    → episode grabbed from indexer
 *   Download/Import → episode downloaded and imported
 *   Rename  → episode files renamed
 *   SeriesDelete → series removed
 */

import { Hono } from 'hono'
import type { MaisieCore } from '@maisie/shared'

export function createSonarrWebhookRouter(getCore: () => MaisieCore | null) {
  const router = new Hono()

  router.post('/webhook', async (c) => {
    const core = getCore()
    if (!core) return c.json({ error: 'not initialized' }, 503)

    try {
      const payload = await c.req.json() as Record<string, unknown>
      const eventType = String(payload.eventType ?? '')

      core.log('sonarr', 'info', `Webhook: ${eventType}`)

      const series = payload.series as Record<string, unknown> | undefined
      const episodes = (payload.episodes ?? []) as Array<Record<string, unknown>>

      switch (eventType) {
        case 'Grab': {
          const show = String(series?.title ?? 'Unknown')
          for (const ep of episodes) {
            core.mqtt.publish('home/media/sonarr/grabbed', {
              show,
              season: Number(ep.seasonNumber ?? 0),
              episode: Number(ep.episodeNumber ?? 0),
              title: String(ep.title ?? ''),
              quality: String((payload.release as Record<string, unknown>)?.quality ?? ''),
            })
          }
          break
        }

        case 'Download':
        case 'EpisodeFileDelete': {
          const show = String(series?.title ?? 'Unknown')
          for (const ep of episodes) {
            core.mqtt.publish('home/media/sonarr/downloaded', {
              show,
              season: Number(ep.seasonNumber ?? 0),
              episode: Number(ep.episodeNumber ?? 0),
              title: String(ep.title ?? ''),
            })
          }
          break
        }

        case 'SeriesDelete': {
          core.mqtt.publish('home/media/sonarr/series_deleted', {
            show: String(series?.title ?? 'Unknown'),
          })
          break
        }

        case 'Test': {
          core.log('sonarr', 'info', 'Webhook test received — connection verified')
          break
        }
      }

      return c.json({ ok: true })
    } catch (err) {
      core.log('sonarr', 'warn', `Webhook error: ${err instanceof Error ? err.message : err}`)
      return c.json({ error: 'parse error' }, 400)
    }
  })

  return router
}
