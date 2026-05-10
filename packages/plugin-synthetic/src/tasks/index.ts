import type { MaisiePlugin } from '@maisie/shared'
import * as actionDefs from './actions'

const plugin: MaisiePlugin = {
  name: 'synthetic-tasks',
  version: '0.1.0',
  description: 'Fake task tracker — domain-agnostic three-layer proof',
  capabilities: [],
  envVars: [],
  actions: Object.values(actionDefs).filter(
    (v): v is typeof actionDefs.listTasks => typeof v === 'object' && v !== null && 'execute' in v
  ),
  events: [],

  async init(_core) {
    // No setup needed — stub data only
  },

  async shutdown() {},

  async healthCheck() {
    return { status: 'healthy', lastCheck: new Date() }
  },
}

export default plugin
