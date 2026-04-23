import type { MaisiePlugin, ActionTier, ActionContext } from '@maisie/shared'
import { tool } from 'ai'
import { z } from 'zod'
import { createGenericTools } from './generic-tools'

export function createToolRegistry(plugins: MaisiePlugin[]) {
  // Collect all actions with ai config from all plugins
  const allActions = plugins.flatMap(plugin =>
    plugin.actions
      .filter(action => action.ai !== false)
      .map(action => ({ plugin: plugin.name, action }))
  )

  /**
   * Convert plugin actions to Vercel AI SDK tool format.
   * Optionally filter to only actions in the provided scopes.
   *
   * @param scopes — optional allowlist of action names. When provided, only
   *   matching plugin actions are returned (generic tools are always included).
   * @param actionContext — context used to construct the address resolver for
   *   generic tools. Defaults to a minimal no-op context if omitted.
   * @param permittedTier — the caller's tier cap for generic tool enforcement.
   *   Defaults to 'inform'.
   */
  function toSdkTools(
    scopes?: string[],
    actionContext?: ActionContext,
    permittedTier: ActionTier = 'inform',
  ): Record<string, unknown> {
    const filtered = scopes
      ? allActions.filter(({ action }) => scopes.includes(action.name))
      : allActions

    const pluginTools = Object.fromEntries(
      filtered.map(({ plugin, action }) => {
        const aiConfig = action.ai as Exclude<typeof action.ai, false>
        return [
          action.name,
          tool({
            description: aiConfig.description ?? action.description,
            inputSchema: action.input as z.ZodTypeAny,
            execute: async (args: unknown) => {
              try {
                return await action.execute(
                  action.input.parse(args),
                  { log: (level, msg) => console.log(`[${plugin}:${action.name}]`, msg), emit: () => {}, plugin, requestId: crypto.randomUUID() }
                )
              } catch (err) {
                return { error: err instanceof Error ? err.message : String(err) }
              }
            },
          }),
        ]
      })
    )

    // Build a minimal ActionContext for the resolver if none provided.
    const ctx: ActionContext = actionContext ?? {
      plugin: 'agent',
      requestId: crypto.randomUUID(),
      log: (level, msg) => console.log(`[agent:generic]`, msg),
      emit: () => {},
    }

    const genericTools = createGenericTools(ctx, permittedTier)

    return { ...genericTools, ...pluginTools }
  }

  function getActionsByTier(tier: ActionTier) {
    return allActions.filter(({ action }) => {
      if (action.ai === false) return false
      return (action.ai as { tier: ActionTier }).tier === tier
    })
  }

  return { toSdkTools, allActions, getActionsByTier }
}

export type ToolRegistry = ReturnType<typeof createToolRegistry>
