import type { MaisiePlugin } from '@maisie/shared'
import * as actionDefs from './actions'
import * as eventDefs from './events'
import { setClient } from './actions'
import { createHaClientFromEnv } from './client'

export { setClient }

const plugin: MaisiePlugin = {
  name: 'home-assistant',
  version: '0.1.0',
  description: 'Home Assistant integration for Maisie',
  capabilities: ['smart-home'],
  envVars: [
    { name: 'HA_HOST', required: true, description: 'Home Assistant hostname or IP', example: '192.168.1.100' },
    { name: 'HA_TOKEN', required: true, description: 'Long-lived access token from Home Assistant' },
    { name: 'HA_PORT', required: false, description: 'Home Assistant HTTP port', example: '8123' },
  ],
  actions: Object.values(actionDefs).filter(v => typeof v === 'object' && 'name' in v) as any,
  events: Object.values(eventDefs),

  async init(core) {
    const client = createHaClientFromEnv()
    if (!client) {
      core.log('home-assistant', 'warn', 'HA_HOST or HA_TOKEN not configured — smart-home actions unavailable')
      return
    }
    setClient(client)
  },

  async shutdown() {
    setClient(null)
  },

  async healthCheck() {
    const client = createHaClientFromEnv()
    if (!client) return { status: 'offline', message: 'HA_HOST not configured', lastCheck: new Date() }
    try {
      await client.ping()
      return { status: 'healthy', lastCheck: new Date() }
    } catch (err) {
      return {
        status: 'offline',
        message: err instanceof Error ? err.message : 'Home Assistant unreachable',
        lastCheck: new Date(),
      }
    }
  },
}

export default plugin
