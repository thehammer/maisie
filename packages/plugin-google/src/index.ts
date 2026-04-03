import type { MaisiePlugin } from '@maisie/shared'
import { Hono } from 'hono'
import * as actionDefs from './actions'
import { setAuth } from './actions'
import { setEmit } from './youtube-cleanup'
import { createGoogleAuth, createGoogleAuthFromEnv } from './auth'

export { setAuth }

const plugin: MaisiePlugin = {
  name: 'google',
  version: '0.1.0',
  description: 'Google Workspace integration for Maisie (Gmail, Calendar, YouTube)',
  capabilities: [],
  envVars: [
    { name: 'GOOGLE_CLIENT_ID', required: true, description: 'Google OAuth client ID' },
    { name: 'GOOGLE_CLIENT_SECRET', required: true, description: 'Google OAuth client secret' },
    { name: 'GOOGLE_REDIRECT_URI', required: false, description: 'OAuth redirect URI', example: 'http://localhost:3001/api/google/callback' },
  ],
  actions: Object.values(actionDefs).filter(v => typeof v === 'object' && 'name' in v) as any,
  events: [],

  async init(core) {
    const auth = createGoogleAuthFromEnv()
    if (!auth) {
      core.log('google', 'warn', 'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured — Google actions unavailable')
      return
    }
    setAuth(auth)
    setEmit((topic, payload) => core.mqtt.publish(topic, payload))
  },

  async shutdown() {
    setAuth(null)
  },

  async healthCheck() {
    if (!createGoogleAuthFromEnv()) {
      return { status: 'offline', message: 'GOOGLE_CLIENT_ID not configured', lastCheck: new Date() }
    }
    try {
      const result = await actionDefs.getAuthStatus.execute({}, { log: () => {}, emit: () => {} })
      return {
        status: result.isAuthenticated ? 'healthy' : 'degraded',
        message: result.isAuthenticated ? undefined : 'Not authorized — visit /api/google/auth',
        lastCheck: new Date(),
      }
    } catch (err) {
      return {
        status: 'offline',
        message: err instanceof Error ? err.message : 'Google unavailable',
        lastCheck: new Date(),
      }
    }
  },

  customRoutes: (() => {
    const router = new Hono()

    // Redirect to Google OAuth consent screen
    router.get('/auth', (c) => {
      const auth = createGoogleAuthFromEnv()
      if (!auth) return c.json({ error: 'Google not configured' }, 500)
      return c.redirect(auth.getAuthUrl())
    })

    // OAuth callback — exchange code for tokens
    router.get('/callback', async (c) => {
      const code = c.req.query('code')
      if (!code) return c.json({ error: 'Missing code parameter' }, 400)

      const auth = createGoogleAuthFromEnv()
      if (!auth) return c.json({ error: 'Google not configured' }, 500)

      try {
        await auth.exchangeCode(code)
        setAuth(auth)
        return c.text('Google account connected successfully. You can close this tab.')
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : 'Token exchange failed' }, 500)
      }
    })

    return router
  })(),
}

export default plugin
