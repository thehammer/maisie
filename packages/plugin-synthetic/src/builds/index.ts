import type { MaisiePlugin, PluginAction } from '@maisie/shared'
import * as actionDefs from './actions'

const plugin: MaisiePlugin = {
  name: 'synthetic-builds',
  version: '0.1.0',
  description: 'Fake CI/CD build system — domain-agnostic three-layer proof',
  capabilities: [],
  envVars: [],
  actions: Object.values(actionDefs).filter(
    (v): v is PluginAction => typeof v === 'object' && v !== null && 'execute' in v
  ),
  events: [],
  async init(_core) {},
  async shutdown() {},
  async healthCheck() { return { status: 'healthy', lastCheck: new Date() } },
}

export default plugin
