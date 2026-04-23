import type { MaisiePlugin } from '@maisie/shared'
import * as actionDefs from './actions'
import { setDb, setPlugins, setCore } from './actions'
import { registry } from './registry'

const plugin: MaisiePlugin = {
  name: 'core',
  version: '0.1.0',
  description: 'Core platform management — plugins, personas, and dashboard layout',
  capabilities: [],
  envVars: [],
  actions: [
    actionDefs.listPlugins,
    actionDefs.installPlugin,
    actionDefs.configurePlugin,
    actionDefs.uninstallPlugin,
    actionDefs.checkPluginHealth,
    actionDefs.listPersonas,
    actionDefs.getPersona,
    actionDefs.createPersona,
    actionDefs.updatePersona,
    actionDefs.deletePersona,
    actionDefs.getCardCatalog,
    actionDefs.getLayout,
    actionDefs.updateLayout,
    actionDefs.resetLayout,
    actionDefs.setWidgetVisibility,
    actionDefs.reorderWidgets,
    actionDefs.patchWidget,
    actionDefs.listCardTemplates,
    actionDefs.createCardTemplate,
    actionDefs.deleteCardTemplate,
    actionDefs.getComponentCatalog,
  ],
  events: [],

  async init(core) {
    setDb(core.db)
    core.log('core', 'info', 'plugin-core initialized')
  },

  async shutdown() {
    // No persistent connections to clean up
  },

  async healthCheck() {
    return { status: 'healthy', lastCheck: new Date() }
  },
}

export { setPlugins, setCore, registry }
export { configurePlugin } from './actions'
export { validatePlugin, validateActionName, VERB_PREFIXES } from './validators'
export { deriveHttpPath } from './registry'
export { EntityRegistry, entityRegistry, synthesizeEntityFromAction, synthesizeEntitiesForPlugin } from './entity-registry'
export { ComponentRegistry, componentRegistry } from './component-registry'
export { createEvalRouter } from './eval-routes'
export default plugin
