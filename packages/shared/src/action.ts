import { z } from 'zod'

export type HttpMethod = 'GET' | 'POST' | 'DELETE' | 'PATCH'
export type ActionTier = 'inform' | 'advise' | 'act'

export interface ActionContext {
  log: (level: 'info' | 'warn' | 'error', message: string, data?: unknown) => void
  emit: (topic: string, payload: unknown) => void
}

/**
 * A PluginAction is the atomic unit of plugin capability in Maisie.
 *
 * The framework generates three surfaces from a single PluginAction definition:
 * 1. HTTP endpoint at /api/{plugin-name}/{action.name}
 * 2. AI tool registered with the agent runtime
 * 3. React hook for dashboard components
 *
 * Every action MUST explicitly declare http, ai, AND ui.
 * Setting a surface to `false` is a valid opt-out. Leaving it undefined is a bug.
 */
export interface PluginAction<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny
> {
  /** snake_case. Used as HTTP path segment and AI tool name. */
  name: string

  /**
   * Written for both humans and LLMs. Used in API docs, AI tool description,
   * and dashboard tooltips. Be precise about what the action returns.
   */
  description: string

  input: TInput
  output: TOutput

  /**
   * HTTP surface. Required — set to an object to expose, or note: there is no
   * http: false because all actions must be HTTP-accessible. Only ai and ui can
   * be false.
   */
  http: {
    method: HttpMethod
    /** Defaults to /api/{plugin-name}/{action-name} */
    path?: string
  }

  /**
   * AI agent surface. false = not available to AI agents.
   * Explicit false is required — undefined is rejected at boot.
   */
  ai:
    | {
        tier: ActionTier
        /** Override description for AI context if needed. Usually not required. */
        description?: string
      }
    | false

  /**
   * Dashboard surface. false = not shown in the dashboard UI.
   * Explicit false is required — undefined is rejected at boot.
   */
  ui:
    | {
        label: string
        section: string
        icon?: string
        /**
         * MQTT topic pattern. When a matching message arrives, dashboard
         * components using this action's hook will re-fetch.
         */
        realtimeTopic?: string
      }
    | false

  execute(input: z.infer<TInput>, context: ActionContext): Promise<z.infer<TOutput>>
}

/** Type helper to define an action with full inference. Always use this. */
export function defineAction<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny
>(action: PluginAction<TInput, TOutput>): PluginAction<TInput, TOutput> {
  return action
}
