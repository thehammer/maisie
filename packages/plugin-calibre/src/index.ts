import type { MaisiePlugin } from '@maisie/shared'
import * as actionDefs from './actions'
import * as eventDefs from './events'
import { alexandria } from './persona'
import { initClients, getClients } from './clients'

export { getClients }

const plugin: MaisiePlugin = {
  name: 'calibre',
  version: '0.1.0',
  description: 'Calibre library management and AI metadata enrichment',
  capabilities: ['book-library'],
  envVars: [
    { name: 'CALIBRE_HOST', required: true, description: 'Calibre Content Server hostname or IP', example: '192.168.1.10' },
    { name: 'CALIBRE_PORT', required: false, description: 'Calibre Content Server port', example: '8081' },
    { name: 'CALIBRE_CONTAINER_NAME', required: false, description: 'Docker container name for calibredb exec', example: 'calibre' },
    { name: 'CALIBRE_LIBRARY_PATH', required: false, description: 'Library path inside the Calibre container', example: '/config/Calibre Library' },
    { name: 'AA_API_KEY', required: false, description: "Anna's Archive API key for fast book downloads" },
  ],
  actions: Object.values(actionDefs),
  events: Object.values(eventDefs),
  persona: alexandria,

  async init(core) {
    // Store the AI client from core for the enrichment classifier
    // TODO: core.ai will be typed as AiClient once Phase 1C completes
    initClients(core.ai, core.db)

    const { calibre, ai } = getClients()
    if (!calibre) core.log('calibre', 'warn', 'Calibre not configured — CALIBRE_HOST not set')
    if (!ai) core.log('calibre', 'warn', 'AI not configured — enrichment classification unavailable')
  },

  async shutdown() {
    // No persistent connections to clean up
  },

  async healthCheck() {
    const { calibre } = getClients()
    if (!calibre) return { status: 'offline', message: 'CALIBRE_HOST not configured', lastCheck: new Date() }
    try {
      await calibre.getLibraryInfo()
      return { status: 'healthy', lastCheck: new Date() }
    } catch (err) {
      return {
        status: 'offline',
        message: err instanceof Error ? err.message : 'Calibre unreachable',
        lastCheck: new Date(),
      }
    }
  },
}

export default plugin
