import type { MaisiePlugin } from '@maisie/shared'
import * as actionDefs from './actions'
import * as eventDefs from './events'
import { natalie } from './persona'
import { initClients, getClients } from './clients'

export { getClients }

const plugin: MaisiePlugin = {
  name: 'synology',
  version: '0.1.0',
  description: 'Synology DSM integration for Maisie',
  capabilities: ['storage'],
  envVars: [
    { name: 'SYNOLOGY_HOST', required: true, description: 'Synology NAS hostname or IP' },
    { name: 'SYNOLOGY_USERNAME', required: true, description: 'DSM admin username' },
    { name: 'SYNOLOGY_PASSWORD', required: true, description: 'DSM admin password' },
    { name: 'SYNOLOGY_PORT', required: false, description: 'DSM HTTPS port', example: '5001' },
    { name: 'SYNOLOGY_HTTPS', required: false, description: 'Use HTTPS (default true)', example: 'true' },
  ],
  actions: Object.values(actionDefs),
  events: Object.values(eventDefs),
  persona: natalie,

  async init(core) {
    const { dsm } = initClients()
    if (!dsm) {
      core.log('synology', 'warn', 'Synology not configured — storage actions unavailable')
      return
    }
    try {
      await dsm.login()
      core.log('synology', 'info', 'Synology DSM connected')
    } catch (err) {
      core.log('synology', 'warn', `Synology DSM login failed: ${err instanceof Error ? err.message : err}`)
    }
  },

  async shutdown() {
    // DSM client handles its own cleanup
  },

  async healthCheck() {
    const { dsm } = getClients()
    if (!dsm) return { status: 'offline', message: 'SYNOLOGY_HOST not configured', lastCheck: new Date() }
    try {
      await dsm.getSystemInfo()
      return { status: 'healthy', lastCheck: new Date() }
    } catch (err) {
      return {
        status: 'offline',
        message: err instanceof Error ? err.message : 'Synology unreachable',
        lastCheck: new Date(),
      }
    }
  },
}

export default plugin
