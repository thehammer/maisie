/**
 * Chain search — BFS over std function signatures to find bridging chains.
 *
 * Given a source TypeExpr and a target TypeExpr that are structurally
 * incompatible, findBridgingChains returns the shortest sequences of
 * std lib functions that, when composed, produce output satisfying the target.
 */

import type { TypeExpr } from '@maisie/shared'
import { satisfies, STD_FUNCTION_DESCRIPTORS, type FunctionDescriptor } from '@maisie/shared'

export interface ChainStep {
  /** Std lib id, e.g. 'std.pluck'. */
  functionId: string
  descriptor: FunctionDescriptor
  /**
   * Inferred or default inline param values shown in the inspector.
   * Users can override these after applying the chain.
   */
  suggestedParams?: Record<string, unknown>
}

export interface BridgingChain {
  steps: ChainStep[]
  /** The final output type after applying every step. Satisfies targetType. */
  outputType: TypeExpr
}

/**
 * BFS over std function signatures to find chains bridging sourceType → targetType.
 *
 * Strategy:
 *  - Start with sourceType as the current head
 *  - For each function whose input satisfies(head, fn.input).ok, apply it
 *  - Check if the new output satisfies the target — if so, record the chain
 *  - Otherwise, continue expanding up to maxDepth
 *  - Deduplicate by current-head type fingerprint to prevent exponential blowup
 *  - Return all chains sorted by length (shortest first)
 *
 * @param sourceType  The type produced by the source placement
 * @param targetType  The type required by the target placement
 * @param maxDepth    Maximum chain length (default 3)
 */
export function findBridgingChains(
  sourceType: TypeExpr,
  targetType: TypeExpr,
  maxDepth: number = 3,
): BridgingChain[] {
  // Quick-out: already compatible, no chain needed
  if (satisfies(sourceType, targetType).ok) {
    return []
  }

  const results: BridgingChain[] = []

  // BFS queue entries: the current head type and the steps taken so far
  const queue: Array<{ currentType: TypeExpr; steps: ChainStep[] }> = [
    { currentType: sourceType, steps: [] },
  ]

  // Visited set keyed by JSON fingerprint of the current head type.
  // We track fingerprints only after at least one step has been taken to
  // ensure we always explore the source type itself.
  const visited = new Set<string>()

  while (queue.length > 0) {
    const { currentType, steps } = queue.shift()!
    const fingerprint = JSON.stringify(currentType)

    // Skip if we already explored this head type via a different path (dedup)
    if (steps.length > 0 && visited.has(fingerprint)) continue
    visited.add(fingerprint)

    // Don't expand beyond maxDepth
    if (steps.length >= maxDepth) continue

    for (const descriptor of STD_FUNCTION_DESCRIPTORS) {
      // Can the current head type flow into this function's input?
      if (!satisfies(currentType, descriptor.input).ok) continue

      const nextType = inferFunctionOutput(descriptor, currentType)
      const step: ChainStep = {
        functionId: descriptor.id,
        descriptor,
        suggestedParams: buildSuggestedParams(descriptor),
      }

      // Does this function's output satisfy the target?
      if (satisfies(nextType, targetType).ok) {
        results.push({ steps: [...steps, step], outputType: nextType })
        // Don't stop — keep searching for other chains at this same depth
        continue
      }

      // Not done — enqueue for further expansion
      queue.push({ currentType: nextType, steps: [...steps, step] })
    }
  }

  // Shortest chains first
  return results.sort((a, b) => a.steps.length - b.steps.length)
}

/**
 * Functions that act as pure passthrough on the collection element type:
 * collection<T> → collection<T>. These preserve the element type.
 *
 * pluck, map, group transform the elements (element type changes), so they
 * are excluded — their output stays collection<any> at search time since the
 * transformation target isn't known until the user fills in inline params.
 */
const PASSTHROUGH_FN_IDS = new Set(['std.filter', 'std.sort', 'std.limit', 'std.unique'])

/**
 * Given a function descriptor and the actual input type, compute the output type.
 *
 * Polymorphic collection operations (filter, sort, limit, unique) preserve the
 * element type of the concrete input rather than returning collection<any>.
 *
 * Transform operations (pluck, map, group) return collection<any> because the
 * output element type depends on inline params the user hasn't filled in yet.
 */
export function inferFunctionOutput(descriptor: FunctionDescriptor, inputType: TypeExpr): TypeExpr {
  // Passthrough polymorphism: collection<T> → collection<T> for filter/sort/limit/unique
  if (
    PASSTHROUGH_FN_IDS.has(descriptor.id) &&
    descriptor.output.kind === 'collection' &&
    descriptor.output.element.kind === 'any' &&
    inputType.kind === 'collection'
  ) {
    return { kind: 'collection', element: inputType.element }
  }

  // All other descriptors return their declared output type directly.
  // For pluck/map at search time we don't know the field name, so the
  // output stays collection<any> — which satisfies collection<any> targets.
  // Users fill in the field name in the inspector after applying the chain.
  return descriptor.output
}

/**
 * Build a suggestedParams map from a descriptor's inline params.
 * Uses the declared default values where available.
 */
function buildSuggestedParams(descriptor: FunctionDescriptor): Record<string, unknown> | undefined {
  if (!descriptor.params || descriptor.params.length === 0) return undefined
  const params: Record<string, unknown> = {}
  for (const p of descriptor.params) {
    if (p.inline && p.default !== undefined) {
      params[p.name] = p.default
    }
  }
  return Object.keys(params).length > 0 ? params : undefined
}
