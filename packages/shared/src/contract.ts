/**
 * Structural contract matcher for the Maisie component model.
 *
 * Determines whether a value's declared type satisfies a component's input
 * contract. Pure — no I/O, no state. All matching is structural (not nominal).
 *
 * Rules (from docs/components.md Section 5):
 *   - Scalar: match with Maisie semantic subtyping (url satisfies string, etc.)
 *   - Record: required fields present with compatible types; extra fields allowed
 *   - Collection: element type satisfies contract element type
 *   - Function: arity ≥ required; params compatible; return satisfies contract return
 *   - Component: input contract compatibility
 *   - AnyType: accepts / is accepted by anything
 */

import type { TypeExpr } from './component'
import type { MaisieFieldType } from './field'

// ── MatchError ────────────────────────────────────────────────────────────────

export interface MatchError {
  /** Path from the root of the value. ["items", 0, "coverUrl"] = value.items[0].coverUrl */
  path: (string | number)[]
  expected: TypeExpr
  actual: TypeExpr
  message: string
}

export type MatchResult = { ok: true } | { ok: false; errors: MatchError[] }

// ── Scalar subtype rules ──────────────────────────────────────────────────────

/**
 * Maisie semantic subtype relationships.
 * A specialized type can be used where its base type is expected.
 *
 *   url       → string    (url is a string with URL format)
 *   image     → string    (image is a string URL for images)
 *   timestamp → string    (timestamp is a string in ISO-8601)
 *   bytes     → number    (bytes is a numeric count)
 *   percentage→ number    (percentage is a 0-100 number)
 *   epoch_ms  → number    (epoch_ms is a numeric timestamp)
 *   duration  → number    (duration is seconds as a number)
 *   temperature→ number   (temperature is Celsius as a number)
 *   signal    → number    (signal is dBm as a number)
 *   status    → string    (status is a named state string)
 *   toggle    → boolean   (toggle is a readable/writable boolean)
 */
const SCALAR_SUPERTYPES: Partial<Record<MaisieFieldType, MaisieFieldType>> = {
  url: 'string',
  image: 'string',
  timestamp: 'string',
  status: 'string',
  stream: 'string',
  bytes: 'number',
  percentage: 'number',
  epoch_ms: 'number',
  duration: 'number',
  temperature: 'number',
  signal: 'number',
  toggle: 'boolean',
}

/**
 * Returns true if `actual` scalar type satisfies `expected` scalar type.
 * An exact match always satisfies. A semantic subtype satisfies its supertype.
 */
export function scalarSatisfies(actual: MaisieFieldType, expected: MaisieFieldType): boolean {
  if (actual === expected) return true
  // Walk up the subtype chain
  let current: MaisieFieldType | undefined = actual
  while (current !== undefined) {
    const supertype: MaisieFieldType | undefined = SCALAR_SUPERTYPES[current]
    if (supertype === expected) return true
    current = supertype
  }
  return false
}

// ── Core matcher ──────────────────────────────────────────────────────────────

/**
 * Check whether `actual` type satisfies `contract` type.
 * Returns { ok: true } if compatible, or { ok: false; errors } with details.
 */
export function satisfies(actual: TypeExpr, contract: TypeExpr): MatchResult {
  const errors: MatchError[] = []
  checkSatisfies(actual, contract, [], errors)
  if (errors.length === 0) return { ok: true }
  return { ok: false, errors }
}

function checkSatisfies(
  actual: TypeExpr,
  contract: TypeExpr,
  path: (string | number)[],
  errors: MatchError[],
): void {
  // AnyType: anything satisfies any, and any satisfies anything
  if (contract.kind === 'any' || actual.kind === 'any') return

  // Union type on contract: actual must satisfy at least one member
  if (contract.kind === 'union') {
    for (const member of contract.members) {
      const result = satisfies(actual, member)
      if (result.ok) return
    }
    errors.push({
      path,
      expected: contract,
      actual,
      message: `${formatType(actual)} does not satisfy any member of union ${formatType(contract)}`,
    })
    return
  }

  // Optional type: actual satisfies if it satisfies the inner type (or is absent — handled at record level)
  if (contract.kind === 'optional') {
    checkSatisfies(actual, contract.inner, path, errors)
    return
  }

  // Type kind mismatch
  if (actual.kind !== contract.kind) {
    // Special case: scalar coercion for union/optional containers
    // A scalar actual can satisfy a scalar contract even if kinds differ via subtyping
    if (actual.kind === 'scalar' && contract.kind === 'scalar') {
      // handled below
    } else {
      errors.push({
        path,
        expected: contract,
        actual,
        message: `type mismatch: expected ${formatType(contract)}, got ${formatType(actual)}`,
      })
      return
    }
  }

  switch (contract.kind) {
    case 'scalar': {
      if (actual.kind !== 'scalar') {
        errors.push({ path, expected: contract, actual, message: `expected scalar ${contract.type}, got ${formatType(actual)}` })
        return
      }
      if (!scalarSatisfies(actual.type, contract.type)) {
        errors.push({
          path,
          expected: contract,
          actual,
          message: `scalar type mismatch: ${actual.type} does not satisfy ${contract.type}`,
        })
      }
      break
    }

    case 'record': {
      if (actual.kind !== 'record') {
        errors.push({ path, expected: contract, actual, message: `expected record, got ${formatType(actual)}` })
        return
      }
      // Every required field of contract must exist in actual
      const optionalSet = new Set(contract.optional ?? [])
      for (const [fieldName, fieldContract] of Object.entries(contract.fields)) {
        const isOptional = optionalSet.has(fieldName)
        if (!(fieldName in actual.fields)) {
          if (!isOptional) {
            errors.push({
              path: [...path, fieldName],
              expected: fieldContract,
              actual: { kind: 'any' },
              message: `required field "${fieldName}" is missing`,
            })
          }
          continue
        }
        checkSatisfies(actual.fields[fieldName], fieldContract, [...path, fieldName], errors)
      }
      // Extra fields in actual are fine (structural subtyping)
      break
    }

    case 'collection': {
      if (actual.kind !== 'collection') {
        errors.push({ path, expected: contract, actual, message: `expected collection, got ${formatType(actual)}` })
        return
      }
      // Collection<any> accepts any collection
      if (contract.element.kind === 'any') return
      checkSatisfies(actual.element, contract.element, [...path, '[*]'], errors)
      break
    }

    case 'function': {
      if (actual.kind !== 'function') {
        errors.push({ path, expected: contract, actual, message: `expected function, got ${formatType(actual)}` })
        return
      }
      // Actual must have at least as many params as contract requires
      if (actual.params.length < contract.params.length) {
        errors.push({
          path,
          expected: contract,
          actual,
          message: `function has ${actual.params.length} param(s) but contract requires ${contract.params.length}`,
        })
        return
      }
      // Each param: contravariant — actual param type must be compatible with contract param type.
      // For practical subtype checking we check that actual.param satisfies contract.param
      // (i.e. we accept that actual takes more specific types, which is a relaxation).
      for (let i = 0; i < contract.params.length; i++) {
        checkSatisfies(actual.params[i].type, contract.params[i].type, [...path, `param[${i}]`], errors)
      }
      // Return type: actual return must satisfy contract return
      if (contract.returns.kind !== 'any') {
        checkSatisfies(actual.returns, contract.returns, [...path, 'return'], errors)
      }
      break
    }

    case 'component': {
      if (actual.kind !== 'component') {
        errors.push({ path, expected: contract, actual, message: `expected component, got ${formatType(actual)}` })
        return
      }
      // If contract specifies an input and actual doesn't, fail
      if (contract.input !== undefined && actual.input === undefined) {
        errors.push({
          path,
          expected: contract,
          actual,
          message: `component contract requires input ${formatType(contract.input)}, but actual component has no declared input`,
        })
        return
      }
      // If contract specifies input, actual's input must satisfy it
      if (contract.input !== undefined && actual.input !== undefined) {
        checkSatisfies(actual.input, contract.input, [...path, 'input'], errors)
      }
      // If actual specifies input and contract doesn't: pass (more specific is fine)
      break
    }

  }
}

// ── Type formatter ────────────────────────────────────────────────────────────

/**
 * Human-readable rendering of a TypeExpr for error messages.
 */
export function formatType(t: TypeExpr): string {
  switch (t.kind) {
    case 'any': return 'any'
    case 'scalar': return t.type
    case 'collection': return `collection<${formatType(t.element)}>`
    case 'record': {
      const fields = Object.keys(t.fields)
      if (fields.length === 0) return 'record'
      const optional = new Set(t.optional ?? [])
      const fieldStrs = fields.map(f => `${f}${optional.has(f) ? '?' : ''}: ${formatType(t.fields[f])}`)
      return `record<{${fieldStrs.join(', ')}}>`
    }
    case 'function': {
      const params = t.params.map(p => `${p.name}: ${formatType(p.type)}`).join(', ')
      return `function(${params}) -> ${formatType(t.returns)}`
    }
    case 'component':
      return t.input ? `component<${formatType(t.input)}>` : 'component'
    case 'optional':
      return `${formatType(t.inner)}?`
    case 'union':
      return t.members.map(formatType).join(' | ')
  }
}

/**
 * Compose match errors into a friendly summary string.
 */
export function formatErrors(errors: MatchError[]): string {
  return errors.map(e => {
    const pathStr = e.path.length > 0
      ? e.path.map(p => typeof p === 'number' ? `[${p}]` : `.${p}`).join('')
      : '(root)'
    return `  ${pathStr}: ${e.message}`
  }).join('\n')
}
