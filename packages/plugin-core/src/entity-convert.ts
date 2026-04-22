/**
 * Convert ParsedEntity (parser output) to EntityDef (runtime type).
 *
 * Used when accepting MEL `define` blocks via the CRUD API.
 * Type inference and safety-tier inference are deferred to Phase 3.
 */

import type { ParsedEntity, EntityDef } from '@maisie/shared'

export function parsedToEntityDef(parsed: ParsedEntity): EntityDef {
  const fields: EntityDef['fields'] = {}

  for (const field of parsed.fields) {
    if (field.kind === 'data') {
      fields[field.name] = {
        kind: 'data',
        // Default to 'record' if no type annotation was given; Phase 3 will
        // infer concrete types from the expression's return type.
        type: (field.type?.name as EntityDef['fields'][string] extends { type: infer T } ? T : never) ?? 'record',
        expression: field.expression,
      }
    } else if (field.kind === 'function') {
      fields[field.name] = {
        kind: 'function',
        params: field.params.map((p) => ({
          name: p.name,
          // Default to 'string' for untyped params; Phase 3 will infer.
          type: (p.type?.name as 'string' | 'number' | 'boolean') ?? 'string',
        })),
        // Default return type; Phase 3 will infer from expression.
        returnType: 'record',
        expression: field.body,
        // Conservative fallback tier. The entity registry (Phase 3) overrides this
        // at registration time by running inferTier against the field's expression.
        // 'advise' is intentionally the safe default — if inference cannot resolve
        // a reference, the function requires human approval.
        tier: 'advise',
      }
    }
  }

  return {
    name: parsed.name,
    description: parsed.description,
    source: 'derived',
    fields,
  }
}
