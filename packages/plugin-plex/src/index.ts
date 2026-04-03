import type { MaisiePlugin } from '@maisie/shared'
import * as actionDefs from './actions'
import * as eventDefs from './events'
import { initPlexClient, getPlexClient } from './client'

export { getPlexClient, initPlexClient }

const plugin: MaisiePlugin = {
  name: 'plex',
  version: '0.1.0',
  description: 'Plex Media Server integration for Maisie',
  capabilities: ['media-server'],
  envVars: [
    { name: 'PLEX_HOST', required: true, description: 'Plex server hostname or IP' },
    { name: 'PLEX_TOKEN', required: true, description: 'Plex authentication token' },
    {
      name: 'PLEX_PORT',
      required: false,
      description: 'Plex server port',
      example: '32400',
    },
  ],
  actions: Object.values(actionDefs),
  events: Object.values(eventDefs),

  async init(core) {
    const client = initPlexClient()
    if (!client) core.log('plex', 'warn', 'Plex not configured — media-server actions unavailable')
  },

  async shutdown() {
    // No persistent connections to clean up
  },

  async healthCheck() {
    const plex = getPlexClient()
    if (!plex) return { status: 'offline', message: 'PLEX_HOST not configured', lastCheck: new Date() }
    try {
      await plex.getServerInfo()
      return { status: 'healthy', lastCheck: new Date() }
    } catch (err) {
      return {
        status: 'offline',
        message: err instanceof Error ? err.message : 'Plex unreachable',
        lastCheck: new Date(),
      }
    }
  },
}

export default plugin
