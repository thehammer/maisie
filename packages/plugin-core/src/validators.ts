import type { PluginAction, MaisiePlugin, CapabilityType } from '@maisie/shared'
import { CAPABILITIES } from '@maisie/shared'

export const VERB_PREFIXES = [
  'list_',
  'get_',
  'set_',
  'create_',
  'delete_',
  'invoke_',
  'stream_',
  'subscribe_',
] as const

/**
 * Validate a single action name against the verb prefix convention.
 * Returns an error message, or null if valid.
 */
export function validateActionName(name: string): string | null {
  if (!VERB_PREFIXES.some((p) => name.startsWith(p))) {
    return `Action name "${name}" must start with one of: ${VERB_PREFIXES.join(', ')}`
  }
  return null
}

/**
 * Validate the three-surface contract for a single action.
 * Every action must explicitly declare http, ai, AND ui (false is a valid opt-out).
 * Returns an array of error messages (empty if valid).
 */
export function validateActionSurfaces(action: PluginAction): string[] {
  const errors: string[] = []
  if (action.ai === undefined) {
    errors.push(`Action "${action.name}": ai surface must be declared (use false to opt out)`)
  }
  if (action.ui === undefined) {
    errors.push(`Action "${action.name}": ui surface must be declared (use false to opt out)`)
  }
  if (action.ui !== false && action.ui !== undefined && action.ui.type === undefined) {
    // Not a hard error — many existing actions predate the type field. Warn only.
    // errors.push(`Action "${action.name}": ui.type should be 'data', 'action', or 'both'`)
  }
  return errors
}

/**
 * Validate a plugin's capability declarations: every required action for each
 * declared capability must be present in the plugin's action list.
 * Returns an array of error messages (empty if valid).
 */
export function validateCapabilities(plugin: MaisiePlugin): string[] {
  const errors: string[] = []
  const actionNames = new Set(plugin.actions.map((a) => a.name))

  for (const cap of plugin.capabilities) {
    const def = CAPABILITIES[cap as CapabilityType]
    if (!def) {
      errors.push(`Plugin "${plugin.name}" declares unknown capability "${cap}"`)
      continue
    }
    for (const required of def.requiredActions) {
      if (!actionNames.has(required)) {
        errors.push(
          `Plugin "${plugin.name}" declares capability "${cap}" but is missing required action "${required}"`,
        )
      }
    }
  }

  return errors
}

/**
 * Run all validations for a plugin.
 *
 * @param plugin  The plugin to validate
 * @param strict  If true, throw on any error. If false (default), log warnings only.
 */
export function validatePlugin(
  plugin: MaisiePlugin,
  strict = false,
): { warnings: string[]; errors: string[] } {
  const warnings: string[] = []
  const errors: string[] = []

  for (const action of plugin.actions) {
    // Verb prefix — warn on legacy plugins, don't hard-fail
    const nameError = validateActionName(action.name)
    if (nameError) warnings.push(nameError)

    // Three-surface contract — this is always enforced
    const surfaceErrors = validateActionSurfaces(action)
    errors.push(...surfaceErrors)
  }

  // Capability contracts
  const capErrors = validateCapabilities(plugin)
  // Capability errors are warnings for now — will become errors in Phase 3
  warnings.push(...capErrors)

  if (strict && errors.length > 0) {
    throw new Error(
      `Plugin "${plugin.name}" failed validation:\n${errors.map((e) => `  • ${e}`).join('\n')}`,
    )
  }

  return { warnings, errors }
}
