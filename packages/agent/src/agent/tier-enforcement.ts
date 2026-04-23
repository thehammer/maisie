import type { ActionTier } from '@maisie/shared'

/**
 * Tier rank for enforcement comparisons.
 *
 * Permitted tier is the maximum a caller can autonomously invoke:
 *   - inform: can call inform only
 *   - act: can call inform and act
 *   - advise: can call anything (advise-tier calls surface for approval)
 *
 * The ranking mirrors the tier ordering in safety.ts:
 *   inform (0) < act (1) < advise (2)
 */
const RANK: Record<ActionTier, number> = { inform: 0, act: 1, advise: 2 }

/**
 * Returns true if invoking an operation at `requiredTier` is permitted
 * for a caller whose cap is `permittedTier`.
 */
export function canInvoke(requiredTier: ActionTier, permittedTier: ActionTier): boolean {
  return RANK[requiredTier] <= RANK[permittedTier]
}

/**
 * Throws if the required tier exceeds the permitted tier.
 * Call this before any side-effecting operation.
 */
export function requireTier(requiredTier: ActionTier, permittedTier: ActionTier): void {
  if (!canInvoke(requiredTier, permittedTier)) {
    throw new Error(
      `tier "${requiredTier}" exceeds permitted tier "${permittedTier}" — operation blocked`,
    )
  }
}
