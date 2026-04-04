import type { MaisiePlugin, ActionTier } from '@maisie/shared'
import { tool } from 'ai'
import { z } from 'zod'

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
   */
  function toSdkTools(scopes?: string[]): Record<string, unknown> {
    const filtered = scopes
      ? allActions.filter(({ action }) => scopes.includes(action.name))
      : allActions

    return Object.fromEntries(
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
