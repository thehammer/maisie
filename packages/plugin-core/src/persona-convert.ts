/**
 * Converters between PersonaConfig and EntityDef.
 *
 * Persona entities follow this convention:
 *   name:    "personas.{persona.name}"    (e.g. "personas.natalie")
 *   section: "personas"
 *   source:  "derived"
 *
 * All fields are data-kind with a literal expression so the entity registry
 * accepts them (derived entities require expressions on data fields). We use
 * a string literal node whose value is the JSON-serialized field content.
 * The entity is used as a query surface (lookup / list) — the actual runtime
 * values are always re-read from PersonaConfig, not from expression eval.
 */

import type { EntityDef } from '@maisie/shared'
import type { PersonaConfig } from './types'

// A minimal literal ExprNode — satisfies the derived-entity contract without
// pulling the full MEL parser.
function strLiteral(value: string) {
  return { kind: 'literal' as const, value }
}

/**
 * Convert a PersonaConfig into an EntityDef suitable for registration.
 * The entity name is "personas.{persona.name}".
 */
export function personaToEntity(persona: PersonaConfig): EntityDef {
  return {
    name: `personas.${persona.name}`,
    description: `Persona: ${persona.role}`,
    source: 'derived',
    section: 'personas',
    fields: {
      name: {
        kind: 'data',
        type: 'string',
        expression: strLiteral(persona.name),
      },
      role: {
        kind: 'data',
        type: 'string',
        expression: strLiteral(persona.role),
      },
      avatar: {
        kind: 'data',
        type: 'string',
        expression: strLiteral(persona.avatar ?? ''),
      },
      default_tier: {
        kind: 'data',
        type: 'string',
        expression: strLiteral(persona.defaultTier),
      },
      event_subscriptions: {
        kind: 'data',
        type: 'collection',
        expression: strLiteral(JSON.stringify(persona.eventSubscriptions)),
      },
      tool_scopes: {
        kind: 'data',
        type: 'collection',
        expression: strLiteral(JSON.stringify(persona.toolScopes)),
      },
      system_prompt: {
        kind: 'data',
        type: 'string',
        expression: strLiteral(persona.systemPrompt),
      },
      is_custom: {
        kind: 'data',
        type: 'boolean',
        expression: strLiteral(String(persona.isCustom)),
      },
    },
  }
}

/**
 * Recover a PersonaConfig from an EntityDef.
 * Returns null if the entity is missing required fields or is malformed.
 */
export function entityToPersona(entity: EntityDef): PersonaConfig | null {
  try {
    const get = (field: string): string => {
      const f = entity.fields[field]
      if (!f || f.kind !== 'data' || !f.expression) return ''
      // LiteralNode shape: { kind: 'literal', value: MaisieScalar }
      const expr = f.expression as { kind?: string; value?: unknown }
      if (expr.kind !== 'literal') return ''
      return String(expr.value ?? '')
    }

    const name = get('name')
    const role = get('role')
    if (!name || !role) return null

    const avatar = get('avatar') || undefined
    const defaultTier = (get('default_tier') || 'advise') as PersonaConfig['defaultTier']
    const systemPrompt = get('system_prompt')
    const isCustom = get('is_custom') === 'true'

    let eventSubscriptions: string[] = []
    let toolScopes: string[] = []
    try {
      eventSubscriptions = JSON.parse(get('event_subscriptions')) as string[]
    } catch { /* malformed — leave as empty */ }
    try {
      toolScopes = JSON.parse(get('tool_scopes')) as string[]
    } catch { /* malformed — leave as empty */ }

    // Recover the id from the entity name: "personas.{name}" → id is best-effort
    // (built-ins used "builtin:{name}", DB rows have a UUID). We reconstruct a
    // stable id from the entity name so round-trips through the registry work.
    const id = isCustom ? name : `builtin:${name}`

    return {
      id,
      name,
      role,
      avatar,
      defaultTier,
      eventSubscriptions,
      toolScopes,
      systemPrompt,
      isCustom,
    }
  } catch {
    return null
  }
}
