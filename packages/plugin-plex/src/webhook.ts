/**
 * Plex webhook receiver.
 *
 * Plex sends webhooks as multipart/form-data with a `payload` field
 * containing JSON. Register the webhook URL in Plex Settings →
 * Webhooks → Add Webhook: http://<maisie-host>:3001/api/plex/webhook
 *
 * Events we handle:
 *   library.new     → publish to home/media/plex/new
 *   playback.started, playback.stopped → publish to home/media/plex/now_playing
 */

import { Hono } from 'hono'
import type { MaisieCore } from '@maisie/shared'

export function createPlexWebhookRouter(getCore: () => MaisieCore | null) {
  const router = new Hono()

  router.post('/webhook', async (c) => {
    const core = getCore()
    if (!core) return c.json({ error: 'not initialized' }, 503)

    try {
      // Plex sends multipart/form-data; payload is in the 'payload' field
      const contentType = c.req.header('content-type') ?? ''
      let payload: Record<string, unknown>

      if (contentType.includes('multipart/form-data')) {
        const form = await c.req.formData()
        const raw = form.get('payload')
        payload = raw ? JSON.parse(String(raw)) : {}
      } else {
        payload = await c.req.json()
      }

      const event = String(payload.event ?? '')
      const metadata = payload.Metadata as Record<string, unknown> | undefined
      const account = payload.Account as Record<string, unknown> | undefined

      core.log('plex', 'info', `Webhook: ${event}`)

      switch (event) {
        case 'library.new': {
          const title = String(metadata?.title ?? 'Unknown')
          const type = String(metadata?.type ?? 'unknown')
          const libraryId = String(metadata?.librarySectionID ?? '')
          core.mqtt.publish('home/media/plex/new', { title, type, libraryId })
          break
        }

        case 'media.play':
        case 'media.resume':
        case 'media.stop':
        case 'media.pause':
        case 'media.scrobble': {
          const user = String(account?.title ?? 'Unknown')
          const title = String(metadata?.title ?? 'Unknown')
          core.mqtt.publish('home/media/plex/now_playing', {
            event,
            user,
            title,
            type: String(metadata?.type ?? 'unknown'),
          })
          break
        }
      }

      return c.json({ ok: true })
    } catch (err) {
      core.log('plex', 'warn', `Webhook error: ${err instanceof Error ? err.message : err}`)
      return c.json({ error: 'parse error' }, 400)
    }
  })

  return router
}
