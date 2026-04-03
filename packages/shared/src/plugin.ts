import type { PluginAction } from './action'
import type { PluginEvent } from './event'
import type { CapabilityType } from './capabilities'
import type { AgentPersona } from './persona'

export interface EnvVarSpec {
  name: string
  required: boolean
  description: string
  example?: string
}

export interface PluginHealth {
  status: 'healthy' | 'degraded' | 'offline'
  message?: string
  lastCheck: Date
}

export interface MaisieCore {
  db: unknown
  mqtt: {
    publish(topic: string, payload: unknown): void
    subscribe(topic: string, handler: (payload: unknown) => void): void
    unsubscribe(topic: string): void
  }
  /** Returns the first plugin implementing the given capability, or null. */
  getCapability<T = unknown>(type: CapabilityType): T | null
  ai: unknown | null  // typed as AiClient once Phase 1C completes
  log(plugin: string, level: 'info' | 'warn' | 'error', message: string, data?: unknown): void
}

export interface MaisiePlugin {
  name: string
  version: string
  description: string
  capabilities: CapabilityType[]
  envVars: EnvVarSpec[]

  /**
   * All plugin functionality expressed as PluginActions.
   * The framework generates HTTP endpoints, AI tools, and React hooks from these.
   */
  actions: PluginAction[]

  /**
   * Events this plugin observes from the world and emits to MQTT.
   * The framework uses these to configure the event router.
   */
  events: PluginEvent[]

  persona?: AgentPersona

  init(core: MaisieCore): Promise<void>
  shutdown(): Promise<void>
  healthCheck(): Promise<PluginHealth>

  /**
   * Escape hatch for routes that don't fit the action model:
   * OAuth callbacks, streaming endpoints, webhook receivers.
   * Mount path: /api/{plugin.name}/...
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customRoutes?: any
}
