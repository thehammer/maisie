import type { MaisiePlugin } from '@maisie/shared'
import * as actionDefs from './actions'
import * as eventDefs from './events'
import { channing } from './persona'

export const syntheticHdhrPlugin: MaisiePlugin = {
  name: 'synthetic-hdhr',
  version: '0.1.0',
  description: 'HDHomeRun emulator — unified lineup of cable, camera, and library channels',
  capabilities: [],
  envVars: [
    { name: 'LAN_IP', required: true, description: 'LAN IP of this host' },
    { name: 'HDHR_HOST', required: false, description: 'Real HDHomeRun PRIME host for cable channels' },
  ],
  actions: Object.values(actionDefs),
  events: Object.values(eventDefs),
  persona: channing,
  async init(core) {
    // synthetic-hdhr self-initializes its HTTP server
    // This plugin wrapper registers it with the Maisie plugin system
    core.log('synthetic-hdhr', 'info', 'Synthetic HDHR plugin registered')
  },
  async shutdown() {},
  async healthCheck() {
    try {
      const res = await fetch('http://localhost:5004/lineup_status.json')
      if (res.ok) return { status: 'healthy', lastCheck: new Date() }
      return { status: 'degraded', message: 'Lineup status check failed', lastCheck: new Date() }
    } catch {
      return { status: 'offline', message: 'Synthetic HDHR not reachable', lastCheck: new Date() }
    }
  },
}

export default syntheticHdhrPlugin
