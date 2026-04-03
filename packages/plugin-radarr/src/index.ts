import type { MaisiePlugin } from '@maisie/shared'
import * as actionDefs from './actions'
import * as eventDefs from './events'
import { initRadarrClient, getRadarrClient } from './client'

export { getRadarrClient, initRadarrClient }

const plugin: MaisiePlugin = {
  name: 'radarr',
  version: '0.1.0',
  description: 'Radarr movie automation for Maisie',
  capabilities: [],
  envVars: [
    { name: 'RADARR_HOST', required: true, description: 'Radarr server hostname or IP' },
    { name: 'RADARR_API_KEY', required: true, description: 'Radarr API key' },
    { name: 'RADARR_PORT', required: false, description: 'Radarr server port', example: '7878' },
    {
      name: 'RADARR_URL_BASE',
      required: false,
      description: 'Radarr URL base path if behind a reverse proxy',
    },
  ],
  actions: Object.values(actionDefs),
  events: Object.values(eventDefs),

  async init(core) {
    const client = initRadarrClient()
    if (!client) core.log('radarr', 'warn', 'Radarr not configured — movie actions unavailable')
  },

  async shutdown() {
    // No persistent connections to clean up
  },

  async healthCheck() {
    const radarr = getRadarrClient()
    if (!radarr)
      return { status: 'offline', message: 'RADARR_HOST not configured', lastCheck: new Date() }
    try {
      await radarr.getSystemStatus()
      return { status: 'healthy', lastCheck: new Date() }
    } catch (err) {
      return {
        status: 'offline',
        message: err instanceof Error ? err.message : 'Radarr unreachable',
        lastCheck: new Date(),
      }
    }
  },
}

export default plugin
