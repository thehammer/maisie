/**
 * Type inference utilities.
 *
 * Two distinct functions live here:
 *
 *   inferType(value)          — runtime inference: MaisieValue → TypeExpr
 *                               Used at render-time when only the value is known.
 *
 *   inferFunctionOutput(...)  — design-time inference: given a FunctionDescriptor,
 *                               the upstream TypeExpr, and any inline param values,
 *                               compute the output TypeExpr. Used by the canvas to
 *                               display schema panels and by chain-search.
 *
 * Both are pure (no I/O, no state) and fully testable.
 */

import type { TypeExpr } from './component'
import type { MaisieValue } from './ops'
import type { FunctionDescriptor, FunctionOutputSpec } from './function-registry-data'

// ── Passthrough function ids ───────────────────────────────────────────────────

/**
 * Functions that preserve the collection element type verbatim:
 *   collection<T> → collection<T>
 *
 * pluck, map, group, get transform the elements so they are excluded.
 */
const PASSTHROUGH_FN_IDS = new Set(['std.filter', 'std.sort', 'std.limit', 'std.unique'])

// ── Design-time function output inferencer ────────────────────────────────────

/**
 * Infer the output TypeExpr of a function placement, given the actual upstream
 * type and the inline param values configured on the placement.
 *
 * Resolution rules per FunctionOutputSpec kind:
 *
 *   TypeExpr (static)          — returned as-is, except for passthrough functions
 *                                (filter/sort/limit/unique) where the element type
 *                                is preserved from the upstream collection.
 *
 *   element_of                 — if upstream is collection<T>, returns T; else ANY.
 *
 *   field_of                   — if upstream is record<{...}> AND params[fieldParam]
 *                                is a string AND that field exists, returns the
 *                                field's TypeExpr; else ANY.
 *
 *   collection_of_field_of     — if upstream is collection<record<{...}>> AND param
 *                                is a string AND field exists in the element, returns
 *                                collection<fieldType>; else collection<any>.
 *
 *   group_of                   — falls back to collection<any> for Phase 3n (exact
 *                                bucket-record construction is out of scope).
 *
 * For runtime-param-dependent outputs where the param is not a string literal
 * at design time, the inferencer falls back to ANY or collection<any>.
 */
export function inferFunctionOutput(
  descriptor: FunctionDescriptor,
  upstreamType: TypeExpr | undefined,
  params: Record<string, unknown> = {},
): TypeExpr {
  const spec = descriptor.output

  // ── Static TypeExpr output ─────────────────────────────────────────────────
  if (isStaticTypeExpr(spec)) {
    // Passthrough polymorphism: preserve element type for filter/sort/limit/unique
    if (
      PASSTHROUGH_FN_IDS.has(descriptor.id) &&
      spec.kind === 'collection' &&
      spec.element.kind === 'any' &&
      upstreamType?.kind === 'collection'
    ) {
      return { kind: 'collection', element: upstreamType.element }
    }
    return spec
  }

  // ── element_of ─────────────────────────────────────────────────────────────
  if (spec.kind === 'element_of') {
    if (upstreamType?.kind === 'collection') {
      return upstreamType.element
    }
    return { kind: 'any' }
  }

  // ── field_of ───────────────────────────────────────────────────────────────
  if (spec.kind === 'field_of') {
    const fieldName = params[spec.fieldParam]
    if (
      typeof fieldName === 'string' &&
      upstreamType?.kind === 'record' &&
      fieldName in upstreamType.fields
    ) {
      return upstreamType.fields[fieldName]
    }
    return { kind: 'any' }
  }

  // ── collection_of_field_of ─────────────────────────────────────────────────
  if (spec.kind === 'collection_of_field_of') {
    const fieldName = params[spec.fieldParam]
    if (
      typeof fieldName === 'string' &&
      upstreamType?.kind === 'collection' &&
      upstreamType.element.kind === 'record' &&
      fieldName in upstreamType.element.fields
    ) {
      return { kind: 'collection', element: upstreamType.element.fields[fieldName] }
    }
    return { kind: 'collection', element: { kind: 'any' } }
  }

  // ── group_of ───────────────────────────────────────────────────────────────
  // Phase 3n: exact bucket-record construction is deferred; fall back to collection<any>.
  // (Full impl would produce collection<record<{[field]: fieldType, items: collection<elementType>}>>)
  if (spec.kind === 'group_of') {
    return { kind: 'collection', element: { kind: 'any' } }
  }

  // Should never reach here
  return { kind: 'any' }
}

/**
 * Returns true when the spec is a plain TypeExpr (not an input-relative descriptor).
 * We detect this by checking if the kind value is a TypeExpr kind — i.e. not one
 * of the input-relative descriptor kinds.
 */
function isStaticTypeExpr(spec: FunctionOutputSpec): spec is TypeExpr {
  const inputRelativeKinds = new Set(['element_of', 'field_of', 'collection_of_field_of', 'group_of'])
  return !inputRelativeKinds.has((spec as { kind: string }).kind)
}

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
