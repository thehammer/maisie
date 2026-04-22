import type { MaisiePlugin, PluginAction } from '@maisie/shared'
import { validatePlugin } from './validators'
import { entityRegistry, synthesizeEntitiesForPlugin } from './entity-registry'

export interface RegisteredAction {
  plugin: string
  action: PluginAction
  /** Derived HTTP path segment, e.g. "/devices" from "list_devices" */
  httpPath: string
}

/**
 * The plugin registry tracks all loaded plugins and their actions.
 * It validates plugins at registration time and provides the action catalog
 * used by the generic HTTP router.
 */
export class PluginRegistry {
  private plugins = new Map<string, MaisiePlugin>()
  private actions = new Map<string, RegisteredAction>()

  /**
   * Register a plugin. Validates all actions and logs warnings.
   * @param plugin The plugin to register
   * @param log    Logger function — called for warnings and errors
   */
  register(plugin: MaisiePlugin, log: (msg: string) => void): void {
    const { warnings, errors } = validatePlugin(plugin)

    for (const warning of warnings) {
      log(`[registry] warn: ${warning}`)
    }
    for (const error of errors) {
      log(`[registry] error: ${error}`)
    }

    this.plugins.set(plugin.name, plugin)

    for (const action of plugin.actions) {
      const key = `${plugin.name}.${action.name}`
      this.actions.set(key, {
        plugin: plugin.name,
        action,
        httpPath: deriveHttpPath(action),
      })
    }

    // Also register in the entity registry (Phase 2a bridge)
    for (const entity of synthesizeEntitiesForPlugin(plugin)) {
      entityRegistry.register(entity)
    }
  }

  /** Get all registered actions for a plugin */
  getPluginActions(pluginName: string): RegisteredAction[] {
    return [...this.actions.values()].filter((r) => r.plugin === pluginName)
  }

  /** Get all registered actions across all plugins */
  getAllActions(): RegisteredAction[] {
    return [...this.actions.values()]
  }

  /** Get a specific action by plugin name + action name */
  getAction(pluginName: string, actionName: string): RegisteredAction | undefined {
    return this.actions.get(`${pluginName}.${actionName}`)
  }

  /** Get all registered plugins */
  getPlugins(): MaisiePlugin[] {
    return [...this.plugins.values()]
  }

  /** Get a specific plugin by name */
  getPlugin(name: string): MaisiePlugin | undefined {
    return this.plugins.get(name)
  }

  /**
   * Produce the action catalog — a summary of all registered actions
   * suitable for the agent's tool registry and the dashboard widget catalog.
   */
  getCatalog() {
    return this.getAllActions().map((r) => ({
      id: `${r.plugin}.${r.action.name}`,
      plugin: r.plugin,
      name: r.action.name,
      description: r.action.description,
      httpPath: r.httpPath,
      httpMethod: r.action.http.method,
      aiTier: r.action.ai !== false ? r.action.ai.tier : null,
      ui: r.action.ui !== false ? r.action.ui : null,
    }))
  }
}

/**
 * Derive the HTTP path from an action name.
 *
 * Rules:
 * 1. Strip the verb prefix (list_, get_, set_, etc.)
 * 2. Convert remaining underscores to hyphens
 *
 * Examples:
 *   list_devices        → /devices
 *   get_wan_health      → /wan-health
 *   invoke_block_device → /block-device
 *   stream_camera       → /camera
 *
 * Override with action.http.path when the default is wrong.
 */
export function deriveHttpPath(action: PluginAction): string {
  if (action.http.path) return action.http.path

  const prefixes = ['list_', 'get_', 'set_', 'create_', 'delete_', 'invoke_', 'stream_', 'subscribe_']
  let name = action.name
  for (const prefix of prefixes) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length)
      break
    }
  }

  return '/' + name.replace(/_/g, '-')
}

// Singleton registry instance
export const registry = new PluginRegistry()
