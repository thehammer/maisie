/**
 * Safety tier inference for derived entity function fields.
 *
 * Walks an expression tree, finds every function invocation, and computes
 * the maximum safety tier across all of them. Used at entity registration time
 * to assign tiers to derived function fields based on the operations they
 * compose — ensuring wrapped destructive operations cannot bypass the safety model.
 */

import type { ExprNode } from './ops'
import type { ActionTier } from './action'

export type { ActionTier }

/**
 * Tier ordering for escalation.
 *
 * 'advise' is the highest (most restrictive) because it requires human approval.
 * 'act' is autonomous but well-understood. 'inform' is read-only.
 *
 * When composing functions, the resulting tier is the max of its components:
 *   any advise → advise
 *   else if any act → act
 *   else inform
 */
const TIER_RANK: Record<ActionTier, number> = {
  inform: 0,
  act: 1,
  advise: 2,
}

/** Return the higher-ranked of two tiers. */
export function maxTier(a: ActionTier, b: ActionTier): ActionTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}

/**
 * Walk an expression tree, finding every function invocation, and compute
 * the max tier across all of them.
 *
 * The `tierLookup` callback resolves a function reference or address to its
 * tier. Tests inject a mock. Production uses a lookup against the entity
 * registry and plugin registry.
 *
 * Returns 'inform' if no function invocations are found (pure data expressions
 * are read-only by definition).
 */
export function inferTier(
  expression: ExprNode,
  tierLookup: (fnNameOrAddress: string) => ActionTier | null,
): ActionTier {
  return walk(expression, tierLookup)
}

function walk(
  node: ExprNode,
  tierLookup: (fnNameOrAddress: string) => ActionTier | null,
): ActionTier {
  switch (node.kind) {
    case 'literal':
      return 'inform'

    case 'ref': {
      // A ref might be a function address (e.g. 'home-assistant.turn_on').
      // If tierLookup resolves it, use that tier; otherwise it's a data ref.
      const tier = tierLookup(node.name)
      return tier ?? 'inform'
    }

    case 'lambda':
      return walk(node.body, tierLookup)

    case 'apply': {
      // Look up the function being applied.
      const fnTier = tierLookup(node.fn) ?? 'inform'
      // Recurse into all arguments.
      const argTier = node.args.reduce<ActionTier>(
        (acc, arg) => maxTier(acc, walk(arg, tierLookup)),
        'inform',
      )
      return maxTier(fnTier, argTier)
    }

    case 'let': {
      // Recurse into each binding value and the body.
      const bindingTier = node.bindings.reduce<ActionTier>(
        (acc, binding) => maxTier(acc, walk(binding.value, tierLookup)),
        'inform',
      )
      return maxTier(bindingTier, walk(node.body, tierLookup))
    }

    case 'pipe': {
      // Recurse into the initial value and each step.
      const valueTier = walk(node.value, tierLookup)
      const stepTier = node.steps.reduce<ActionTier>(
        (acc, step) => maxTier(acc, walk(step, tierLookup)),
        'inform',
      )
      return maxTier(valueTier, stepTier)
    }
  }
}
