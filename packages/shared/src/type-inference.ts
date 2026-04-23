/**
 * Runtime type inference — infer a TypeExpr from a MaisieValue.
 *
 * Used at render-time validation when only the value is known, not its declared
 * type. Inference is best-effort; some specializations (url, timestamp) are
 * detected by heuristics.
 */

import type { TypeExpr } from './component'
import type { MaisieValue } from './ops'

// ── URL heuristic ─────────────────────────────────────────────────────────────

const URL_PREFIXES = ['http://', 'https://', 'ftp://', '//', 'data:']
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/

/**
 * Infer whether a string looks like a URL.
 */
function looksLikeUrl(s: string): boolean {
  return URL_PREFIXES.some(prefix => s.startsWith(prefix))
}

/**
 * Infer whether a string looks like an ISO-8601 timestamp.
 */
function looksLikeTimestamp(s: string): boolean {
  return ISO_DATE_RE.test(s)
}

// ── Core inference ────────────────────────────────────────────────────────────

/**
 * Infer a TypeExpr from a runtime MaisieValue.
 *
 * Type inference rules:
 *   null / undefined  → AnyType
 *   boolean           → scalar<boolean>
 *   number            → scalar<number>
 *   string            → scalar<url | timestamp | string> (heuristics applied)
 *   function          → function() -> any (params unknown at runtime)
 *   array             → collection<infer from first element, or any if empty>
 *   object            → record<{key: infer(value[key]), ...}>
 */
export function inferType(value: MaisieValue): TypeExpr {
  if (value === null || value === undefined) {
    return { kind: 'any' }
  }

  if (typeof value === 'boolean') {
    return { kind: 'scalar', type: 'boolean' }
  }

  if (typeof value === 'number') {
    return { kind: 'scalar', type: 'number' }
  }

  if (typeof value === 'string') {
    if (looksLikeUrl(value)) {
      return { kind: 'scalar', type: 'url' }
    }
    if (looksLikeTimestamp(value)) {
      return { kind: 'scalar', type: 'timestamp' }
    }
    return { kind: 'scalar', type: 'string' }
  }

  if (typeof value === 'function') {
    // Runtime functions have unknown param lists — represent as function() -> any
    return { kind: 'function', params: [], returns: { kind: 'any' } }
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { kind: 'collection', element: { kind: 'any' } }
    }
    // Infer from first element
    const elementType = inferType(value[0] as MaisieValue)
    return { kind: 'collection', element: elementType }
  }

  if (typeof value === 'object') {
    const fields: Record<string, TypeExpr> = {}
    for (const [key, fieldValue] of Object.entries(value as Record<string, MaisieValue>)) {
      fields[key] = inferType(fieldValue)
    }
    return { kind: 'record', fields }
  }

  // Fallback
  return { kind: 'any' }
}
