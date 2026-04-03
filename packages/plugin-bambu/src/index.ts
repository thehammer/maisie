import type { MaisiePlugin } from '@maisie/shared'
import * as actionDefs from './actions'
import * as eventDefs from './events'
import { setClient } from './actions'
import { createBambuClientFromEnv } from './client'

export { setClient }

const plugin: MaisiePlugin = {
  name: 'bambu',
  version: '0.1.0',
  description: 'Bambu Lab 3D printer integration for Maisie',
  capabilities: ['printer'],
  envVars: [
    { name: 'BAMBU_HOST', required: true, description: 'Bambu printer IP address', example: '192.168.1.200' },
    { name: 'BAMBU_SERIAL', required: true, description: 'Printer serial number (from Settings > Device)' },
    { name: 'BAMBU_ACCESS_CODE', required: true, description: 'LAN access code (from Settings > Network)' },
  ],
  actions: Object.values(actionDefs).filter(v => typeof v === 'object' && 'name' in v) as any,
  events: Object.values(eventDefs),

  async init(core) {
    const client = createBambuClientFromEnv()
    if (!client) {
      core.log('bambu', 'warn', 'BAMBU_HOST/SERIAL/ACCESS_CODE not configured — printer actions unavailable')
      return
    }
    setClient(client)
    try {
      await client.connect()
      client.requestFullStatus()
    } catch (err) {
      core.log('bambu', 'warn', `Failed to connect to Bambu printer: ${err instanceof Error ? err.message : err}`)
    }
  },

  async shutdown() {
    const client = createBambuClientFromEnv()
    if (client) client.disconnect()
    setClient(null)
  },

  async healthCheck() {
    try {
      const result = await actionDefs.getStatus.execute({}, { log: () => {}, emit: () => {} })
      return { status: result ? 'healthy' : 'degraded', lastCheck: new Date() }
    } catch (err) {
      return {
        status: 'offline',
        message: err instanceof Error ? err.message : 'Bambu printer unreachable',
        lastCheck: new Date(),
      }
    }
  },
}

export default plugin
