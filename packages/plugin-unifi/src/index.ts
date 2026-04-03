import type { MaisiePlugin } from '@maisie/shared'
import * as actionDefs from './actions'
import * as eventDefs from './events'
import { natalie } from './persona'
import { initClients, getClients } from './clients'

export { getClients }

const plugin: MaisiePlugin = {
  name: 'unifi',
  version: '0.1.0',
  description: 'UniFi network controller and Protect cameras',
  capabilities: ['network', 'camera'],
  envVars: [
    { name: 'UNIFI_HOST', required: true, description: 'UniFi controller hostname or IP' },
    { name: 'UNIFI_USERNAME', required: true, description: 'UniFi admin username' },
    { name: 'UNIFI_PASSWORD', required: true, description: 'UniFi admin password' },
    { name: 'UNIFI_SITE', required: false, description: 'UniFi site name', example: 'default' },
    { name: 'UNIFI_PROTECT_ENABLED', required: false, description: 'Enable Protect cameras', example: 'true' },
  ],
  actions: Object.values(actionDefs),
  events: Object.values(eventDefs),
  persona: natalie,

  async init(core) {
    const { unifi, protect } = initClients()
    if (!unifi) core.log('unifi', 'warn', 'UniFi not configured — network actions unavailable')
    if (!protect) core.log('unifi', 'warn', 'Protect not configured — camera actions unavailable')
  },

  async shutdown() {
    // UniFi client handles its own cleanup
  },

  async healthCheck() {
    const { unifi } = getClients()
    if (!unifi) return { status: 'offline', message: 'UNIFI_HOST not configured', lastCheck: new Date() }
    try {
      await unifi.getDevices()
      return { status: 'healthy', lastCheck: new Date() }
    } catch (err) {
      return {
        status: 'offline',
        message: err instanceof Error ? err.message : 'UniFi unreachable',
        lastCheck: new Date(),
      }
    }
  },
}

export default plugin
