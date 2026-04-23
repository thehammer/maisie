/**
 * Generic address-based tools for the Maisie agent.
 *
 * Four protocol-level tools that operate against any entity in the catalog.
 * These are additive — per-action hand-wired tools continue to work alongside them.
 *
 * Phase 4a implementation.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { ActionTier, ActionContext } from '@maisie/shared'
import { parse, evalExprAsync, inferTier, STD_LIB } from '@maisie/shared'
import type { ParsedEntity, ParsedComponent } from '@maisie/shared'
import { createAddressResolver } from '@maisie/plugin-core/src/address-resolver'
import { entityRegistry } from '@maisie/plugin-core'
import { componentRegistry } from '@maisie/plugin-core'
import { requireTier } from './tier-enforcement'

// ── ActionContext adapter ─────────────────────────────────────────────────────
//
// createAddressResolver expects { [key: string]: unknown } (the plugin-core
// internal ActionContext). The shared ActionContext is a superset, so it
// satisfies the interface directly.

// ── Tier lookup for run_pipeline ──────────────────────────────────────────────

/**
 * Resolve a function ref or address to its tier for pipeline safety checking.
 * Mirrors the logic in entity-registry.ts but exposed as a standalone helper.
 */
function tierLookupForPipeline(ref: string): ActionTier | null {
  // Std lib and primitives are inform (pure reads).
  const STD_NAMES = new Set(Object.keys(STD_LIB))
  if (STD_NAMES.has(ref)) return 'inform'

  const KNOWN_PRIMITIVES = new Set([
    'reduce', 'sort', 'append', 'take', 'sortBy', 'groupBy',
    'get', 'set', 'merge',
    'eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith',
    'add', 'sub', 'mul', 'div', 'mod',
    'and', 'or', 'not',
    'concat', 'len', 'str',
    'if', 'identity', 'call',
    'empty-record',
    // Named pipe operators map to std.* variants
    'std.filter', 'std.sort', 'std.limit', 'std.map', 'std.pluck',
    'std.group', 'std.count', 'std.sum', 'std.any', 'std.all',
  ])
  if (KNOWN_PRIMITIVES.has(ref)) return 'inform'

  // Dotted path — try entity field lookup.
  const lastDot = ref.lastIndexOf('.')
  if (lastDot >= 0) {
    const entityName = ref.slice(0, lastDot)
    const fieldName = ref.slice(lastDot + 1)
    const entity = entityRegistry.get(entityName)
    if (entity) {
      const field = entity.fields[fieldName]
      if (field?.kind === 'function') return field.tier
    }
  }

  return null
}

// ── Tool summaries returned by list_entities ──────────────────────────────────

interface EntitySummary {
  name: string
  kind: 'entity' | 'component'
  description: string | null
  section: string | null
  source?: 'plugin' | 'derived'
}

// ── Generic tool factory ──────────────────────────────────────────────────────

/**
 * Create the four generic agent tools.
 *
 * @param actionContext — passed to the address resolver so plugin actions have
 *   access to log/emit/db. Use a context built from the current request.
 * @param permittedTier — the maximum tier the calling persona can invoke.
 *   Defaults to 'inform' (safest). Pass 'act' or 'advise' to unlock higher tiers.
 */
export function createGenericTools(
  actionContext: ActionContext,
  permittedTier: ActionTier = 'inform',
) {
  const resolver = createAddressResolver(actionContext as unknown as Record<string, unknown>)

  // ── resolve_address ─────────────────────────────────────────────────────────

  const resolveAddress = tool({
    description:
      'Return the live value at an entity-field address (e.g. "ha.list_switches.result"). ' +
      'Reads data fields — does not invoke function fields.',
    inputSchema: z.object({
      address: z.string().describe('Dot-separated entity address, e.g. "home-assistant.list_switches.result"'),
    }),
    execute: async ({ address }: { address: string }) => {
      try {
        return await resolver.resolve(address)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  // ── invoke_address ──────────────────────────────────────────────────────────

  const invokeAddress = tool({
    description:
      'Call a function field at an entity address with optional named arguments. ' +
      'Tier is checked before dispatch — invoke only function fields that are within your permitted tier.',
    inputSchema: z.object({
      address: z.string().describe('Dot-separated function field address, e.g. "ha.switch.front.toggle"'),
      args: z.record(z.string(), z.unknown()).optional().describe('Named arguments for the function'),
    }),
    execute: async ({ address, args = {} }: { address: string; args?: Record<string, unknown> }) => {
      try {
        // Resolve the field to determine its tier before invoking.
        const parts = address.split('.')
        // Longest-prefix match: the field name is the last segment.
        // Find the entity and field tier.
        const entities = entityRegistry.list()
        let resolvedTier: ActionTier | null = null

        for (const entity of entities) {
          if (address === entity.name || address.startsWith(entity.name + '.')) {
            const rest = address.slice(entity.name.length + 1)
            const fieldName = rest.split('.')[0]
            const field = entity.fields[fieldName]
            if (field?.kind === 'function') {
              resolvedTier = field.tier
              break
            }
          }
        }

        if (resolvedTier === null) {
          // Could not determine tier — check if field is a data field (not callable).
          return { error: `"${address}" is not a callable function field` }
        }

        // Enforce tier before invoking.
        requireTier(resolvedTier, permittedTier)

        return await resolver.invoke(address, args as import('@maisie/shared').MaisieRecord)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  // ── run_pipeline ────────────────────────────────────────────────────────────

  const runPipeline = tool({
    description:
      'Parse and evaluate a MEL expression string. ' +
      'Use for multi-step pipeline queries (filter, sort, map, etc.). ' +
      'Define blocks are rejected — this tool evaluates expressions only. ' +
      'Embedded function calls are tier-checked before evaluation.',
    inputSchema: z.object({
      expression: z.string().describe(
        'A MEL expression string, e.g. "home-assistant.list_switches.result | filter: state == \\"on\\""',
      ),
    }),
    execute: async ({ expression }: { expression: string }) => {
      try {
        const parsed = parse(expression)

        // Reject define blocks.
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'kind' in parsed &&
          ((parsed as ParsedEntity | ParsedComponent).kind === 'entity' ||
            (parsed as ParsedEntity | ParsedComponent).kind === 'component')
        ) {
          return {
            error: 'run_pipeline only accepts expressions, not define blocks. Use save_entity for authoring.',
          }
        }

        const exprNode = parsed as import('@maisie/shared').ExprNode

        // Compute the max tier of all function calls in the expression tree.
        const expressionTier = inferTier(exprNode, tierLookupForPipeline)

        // Enforce tier.
        try {
          requireTier(expressionTier, permittedTier)
        } catch {
          return {
            error: `Expression tier "${expressionTier}" exceeds permitted tier "${permittedTier}" — some operations in this pipeline require higher permissions`,
          }
        }

        const result = await evalExprAsync(exprNode, resolver, {}, STD_LIB)
        return result
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  // ── list_entities ───────────────────────────────────────────────────────────

  const listEntities = tool({
    description:
      'List all entities (and components) in the catalog. ' +
      'Filter by section name or by field names present on the entity. ' +
      'Returns summaries — use resolve_address to fetch live data.',
    inputSchema: z.object({
      filter: z
        .object({
          section: z.string().optional().describe('Exact match on entity.section (e.g. "media", "network")'),
          fieldNames: z
            .array(z.string())
            .optional()
            .describe('Entity must have ALL of these field names present'),
        })
        .optional()
        .describe('Optional filter criteria'),
    }),
    execute: async ({
      filter,
    }: {
      filter?: { section?: string; fieldNames?: string[] }
    }): Promise<EntitySummary[]> => {
      const results: EntitySummary[] = []

      // Entities from the entity registry.
      for (const entity of entityRegistry.list()) {
        if (filter?.section && entity.section !== filter.section) continue
        if (filter?.fieldNames) {
          const missing = filter.fieldNames.some((fn) => !(fn in entity.fields))
          if (missing) continue
        }
        results.push({
          name: entity.name,
          kind: 'entity',
          description: entity.description ?? null,
          section: entity.section ?? null,
          source: entity.source,
        })
      }

      // Components from the component registry (no section or fieldShape filter —
      // components have a different shape; include them without field filtering).
      for (const component of componentRegistry.list()) {
        if (filter?.section) continue  // Components don't have sections — skip when section filter is set.
        if (filter?.fieldNames) continue  // Skip components when field filter is set.
        results.push({
          name: component.name,
          kind: 'component',
          description: component.description ?? null,
          section: null,
        })
      }

      return results
    },
  })

  return {
    resolve_address: resolveAddress,
    invoke_address: invokeAddress,
    run_pipeline: runPipeline,
    list_entities: listEntities,
  }
}
