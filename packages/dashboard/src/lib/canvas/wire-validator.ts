/**
 * Wire validation — checks structural compatibility between two ports
 * using the contract matcher from @maisie/shared.
 */

import type { TypeExpr, MatchResult } from '@maisie/shared'
import { satisfies } from '@maisie/shared'

export type WireStatus = 'compatible' | 'ambiguous' | 'incompatible' | 'unknown'

export interface WireValidation {
  status: WireStatus
  result?: MatchResult
  /** Human-readable summary. */
  message?: string
}

/**
 * Validate a wire given the types at each endpoint.
 *
 * Returns:
 *   - 'compatible' when source type satisfies target type
 *   - 'incompatible' when satisfies() returns errors
 *   - 'unknown' when one or both types can't be resolved (the user sees a gray wire)
 *
 * Ambiguity detection is deferred to Phase 3d; for 3b any satisfies.ok case
 * is classified as 'compatible'.
 */
export function validateWire(
  sourceType: TypeExpr | undefined,
  targetType: TypeExpr | undefined,
): WireValidation {
  if (!sourceType || !targetType) {
    return { status: 'unknown', message: 'type not resolved' }
  }
  const result = satisfies(sourceType, targetType)
  if (result.ok) {
    return { status: 'compatible', result }
  }
  const summary = result.errors
    .slice(0, 3)
    .map((e) => e.message)
    .join('; ')
  return { status: 'incompatible', result, message: summary }
}
