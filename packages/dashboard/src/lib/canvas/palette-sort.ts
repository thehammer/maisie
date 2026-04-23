/**
 * Palette compatibility sorting for Phase 3i.
 *
 * Given a target TypeExpr (from a selected placement) and a list of palette
 * items that each carry a TypeExpr, classify each item as compatible, chain,
 * incompatible, or unknown, then sort the list so that compatible items appear
 * first within each group.
 */

import type { TypeExpr } from '@maisie/shared'
import { satisfies } from '@maisie/shared'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CompatibilityStatus = 'compatible' | 'chain' | 'incompatible' | 'unknown'

export interface WithCompatibility {
  compatibilityStatus: CompatibilityStatus
}

// ── Classification ─────────────────────────────────────────────────────────────

const STATUS_RANK: Record<CompatibilityStatus, number> = {
  compatible: 0,
  chain: 1,
  incompatible: 2,
  unknown: 3,
}

/**
 * Classify one TypeExpr against a target.
 *
 * Rules (Phase 3i):
 *   - If either type is absent → unknown
 *   - If satisfies(candidate, target).ok → compatible
 *   - Otherwise: look at the top-level kinds.
 *     - record→record or collection→collection with a different inner shape → chain
 *       (structurally similar enough that a function could bridge them)
 *     - collection→any or any→collection also qualifies as chain
 *     - anything else (e.g. scalar→record, record→scalar) → incompatible
 *
 * The actual chain detection (BFS over function signatures) is Phase 3j.
 * For now we just flag structural plausibility.
 */
export function classifyCompatibility(
  candidateType: TypeExpr | undefined,
  targetType: TypeExpr | undefined,
): CompatibilityStatus {
  if (!candidateType || !targetType) return 'unknown'

  const result = satisfies(candidateType, targetType)
  if (result.ok) return 'compatible'

  // Chain heuristic: same top-level kind but not directly compatible →
  // a function could bridge (e.g. record→record with different fields,
  // or collection→collection with incompatible elements).
  // `any` is already handled by satisfies() returning ok, so it never reaches here.
  const ck = candidateType.kind
  const tk = targetType.kind

  if (ck === tk) return 'chain'
  // Mismatched kinds (scalar↔record, record↔collection, etc.) → incompatible
  return 'incompatible'
}

// ── Sort ──────────────────────────────────────────────────────────────────────

/**
 * Sort palette items by compatibility status (compatible first), then
 * preserve existing order within each tier.
 *
 * This is a stable sort: items that compare equal by status keep their
 * original relative order (alphabetical from the caller).
 */
export function sortByCompatibility<T extends WithCompatibility>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => STATUS_RANK[a.compatibilityStatus] - STATUS_RANK[b.compatibilityStatus],
  )
}

/**
 * Annotate a list of items with a compatibility status against a target type.
 *
 * @param items         Raw items carrying a TypeExpr at `getType(item)`.
 * @param targetType    The TypeExpr to evaluate against (from selected placement).
 * @param getType       Accessor that extracts the candidate TypeExpr from an item.
 * @returns             Items annotated with `compatibilityStatus`.
 */
export function annotateCompatibility<T>(
  items: T[],
  targetType: TypeExpr | undefined,
  getType: (item: T) => TypeExpr | undefined,
): (T & WithCompatibility)[] {
  return items.map((item) => ({
    ...item,
    compatibilityStatus: targetType
      ? classifyCompatibility(getType(item), targetType)
      : ('unknown' as CompatibilityStatus),
  }))
}
