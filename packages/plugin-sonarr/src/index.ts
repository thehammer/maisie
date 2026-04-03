import type { MaisiePlugin } from '@maisie/shared'
import * as actionDefs from './actions'
import * as eventDefs from './events'
import { initSonarrClient, getSonarrClient } from './client'

export { getSonarrClient, initSonarrClient }

const plugin: MaisiePlugin = {
  name: 'sonarr',
  version: '0.1.0',
  description: 'Sonarr TV show automation for Maisie',
  capabilities: [],
  envVars: [
    { name: 'SONARR_HOST', required: true, description: 'Sonarr server hostname or IP' },
    { name: 'SONARR_API_KEY', required: true, description: 'Sonarr API key' },
    { name: 'SONARR_PORT', required: false, description: 'Sonarr server port', example: '8989' },
    {
      name: 'SONARR_URL_BASE',
      required: false,
      description: 'Sonarr URL base path if behind a reverse proxy',
    },
  ],
  actions: Object.values(actionDefs),
  events: Object.values(eventDefs),

  async init(core) {
    const client = initSonarrClient()
    if (!client) core.log('sonarr', 'warn', 'Sonarr not configured — TV show actions unavailable')
  },

  async shutdown() {
    // No persistent connections to clean up
  },

  async healthCheck() {
    const sonarr = getSonarrClient()
    if (!sonarr)
      return { status: 'offline', message: 'SONARR_HOST not configured', lastCheck: new Date() }
    try {
      await sonarr.getSystemStatus()
      return { status: 'healthy', lastCheck: new Date() }
    } catch (err) {
      return {
        status: 'offline',
        message: err instanceof Error ? err.message : 'Sonarr unreachable',
        lastCheck: new Date(),
      }
    }
  },
}

export default plugin
