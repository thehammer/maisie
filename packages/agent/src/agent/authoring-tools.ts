/**
 * MEL authoring tools for the Maisie agent.
 *
 * Three advise-tier tool surfaces that let the agent create and delete
 * persistent catalog artifacts (derived entities and components).
 *
 * All three require advise tier — creating or removing catalog artifacts is
 * human-visible and sticky. The advise flow surfaces the proposed action to
 * the user for approval before it takes effect.
 *
 * Phase 4b implementation.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { ActionTier } from '@maisie/shared'
import { parse } from '@maisie/shared'
import type { ParsedEntity, ParsedComponent } from '@maisie/shared'
import { entityRegistry } from '@maisie/plugin-core'
import { componentRegistry } from '@maisie/plugin-core'
import { parsedToEntityDef } from '@maisie/plugin-core/src/entity-convert'
import { parsedToComponentDef } from '@maisie/plugin-core/src/component-convert'
import type { DerivedEntityStore } from '@maisie/plugin-core/src/derived-entity-store'
import type { DerivedComponentStore } from '@maisie/plugin-core/src/derived-component-store'
import { requireTier } from './tier-enforcement'

// ── Deps ──────────────────────────────────────────────────────────────────────

export interface AuthoringToolDeps {
  entityStore: DerivedEntityStore
  componentStore: DerivedComponentStore
}

// ── Authoring tool factory ────────────────────────────────────────────────────

/**
 * Create the three MEL authoring agent tools.
 *
 * @param deps — stores for persisting derived entities and components.
 * @param permittedTier — the maximum tier the calling persona can invoke.
 *   All authoring tools require 'advise' tier minimum.
 */
export function createAuthoringTools(
  deps: AuthoringToolDeps,
  permittedTier: ActionTier = 'inform',
) {
  const { entityStore, componentStore } = deps

  // ── save_entity ─────────────────────────────────────────────────────────────

  const saveEntity = tool({
    description:
      'Parse a MEL define block and save it as a derived entity in the catalog. ' +
      'The source must be a define block for an entity (not a component). ' +
      'Returns the created EntityDef on success. Tier: advise — requires human approval.',
    inputSchema: z.object({
      source: z.string().describe('MEL source string for a define block, e.g. "define unwatched-movies { ... }"'),
    }),
    execute: async ({ source }: { source: string }) => {
      try {
        // Tier enforcement before any side effect.
        requireTier('advise', permittedTier)

        // Parse the MEL source.
        let parsed: ReturnType<typeof parse>
        try {
          parsed = parse(source)
        } catch (err) {
          return { error: `MEL parse error: ${err instanceof Error ? err.message : String(err)}` }
        }

        if (parsed === null || typeof parsed !== 'object') {
          return { error: 'Source must be a define block, not an expression' }
        }

        // Must be an entity define block (not a component).
        if (!('kind' in parsed) || (parsed as ParsedEntity | ParsedComponent).kind !== 'entity') {
          return {
            error:
              'Source must be an entity define block. ' +
              'A component define block (containing a render: field) was provided — use save_component instead.',
          }
        }

        const parsedEntity = parsed as ParsedEntity

        // Convert to EntityDef.
        const entityDef = parsedToEntityDef(parsedEntity)

        // Check for name conflicts: block overwriting plugin (base) entities.
        const existing = entityRegistry.get(entityDef.name)
        if (existing && existing.source === 'plugin') {
          return {
            error: `Cannot overwrite plugin entity "${entityDef.name}". Plugin entities are read-only.`,
          }
        }

        // Register in the registry (throws on validation failure).
        try {
          entityRegistry.register(entityDef)
        } catch (err) {
          return { error: `Validation error: ${err instanceof Error ? err.message : String(err)}` }
        }

        // Persist to the store.
        await entityStore.save(entityDef)

        return {
          name: entityDef.name,
          source: 'derived' as const,
          description: entityDef.description ?? null,
          fields: entityDef.fields,
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  // ── save_component ───────────────────────────────────────────────────────────

  const saveComponent = tool({
    description:
      'Parse a MEL define block and save it as a derived component in the catalog. ' +
      'The source must be a component define block (containing a render: field). ' +
      'Returns the created ComponentDef on success. Tier: advise — requires human approval.',
    inputSchema: z.object({
      source: z.string().describe('MEL source string for a component define block, e.g. "define MyCard { render: text(value: title) }"'),
    }),
    execute: async ({ source }: { source: string }) => {
      try {
        // Tier enforcement before any side effect.
        requireTier('advise', permittedTier)

        // Parse the MEL source.
        let parsed: ReturnType<typeof parse>
        try {
          parsed = parse(source)
        } catch (err) {
          return { error: `MEL parse error: ${err instanceof Error ? err.message : String(err)}` }
        }

        if (parsed === null || typeof parsed !== 'object') {
          return { error: 'Source must be a define block, not an expression' }
        }

        // Must be a component define block.
        if (!('kind' in parsed) || (parsed as ParsedEntity | ParsedComponent).kind !== 'component') {
          return {
            error:
              'Source must be a component define block (containing a render: field). ' +
              'An entity define block was provided — use save_entity instead.',
          }
        }

        const parsedComponent = parsed as ParsedComponent

        // Convert to ComponentDef.
        const componentDef = parsedToComponentDef(parsedComponent)

        // Register in the registry (throws on validation failure).
        try {
          componentRegistry.register(componentDef)
        } catch (err) {
          return { error: `Validation error: ${err instanceof Error ? err.message : String(err)}` }
        }

        // Persist to the store.
        await componentStore.save(componentDef)

        return {
          name: componentDef.name,
          kind: 'derived' as const,
          description: componentDef.description ?? null,
          input: componentDef.input ?? null,
          props: componentDef.props ?? null,
          render: componentDef.render,
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  // ── delete_artifact ──────────────────────────────────────────────────────────

  const deleteArtifact = tool({
    description:
      'Remove a derived entity or derived component from the catalog by name. ' +
      'Only derived artifacts (user/agent-authored) can be deleted. ' +
      'Plugin entities and base/layout components are protected and cannot be removed. ' +
      'Tier: advise — requires human approval.',
    inputSchema: z.object({
      address: z.string().describe('The name of the derived entity or component to delete, e.g. "unwatched-movies" or "MyCard"'),
    }),
    execute: async ({ address }: { address: string }) => {
      try {
        // Tier enforcement before any side effect.
        requireTier('advise', permittedTier)

        // Try entity first.
        const entity = entityRegistry.get(address)
        if (entity) {
          if (entity.source !== 'derived') {
            return {
              error: `Cannot delete "${address}" — it is a plugin entity. Only derived (user/agent-authored) entities can be deleted.`,
            }
          }
          entityRegistry.unregister(address)
          await entityStore.delete(address)
          return { deleted: true, kind: 'entity' as const, name: address }
        }

        // Try component.
        const component = componentRegistry.get(address)
        if (component) {
          if (component.kind !== 'derived') {
            return {
              error: `Cannot delete "${address}" — it is a ${component.kind} component. Only derived components can be deleted.`,
            }
          }
          const removed = componentRegistry.unregister(address)
          if (!removed) {
            return {
              error: `Failed to unregister component "${address}" — it may be a base or layout component.`,
            }
          }
          await componentStore.delete(address)
          return { deleted: true, kind: 'component' as const, name: address }
        }

        // Not found in either registry.
        return { error: `No entity or component found at address "${address}"` }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  return {
    save_entity: saveEntity,
    save_component: saveComponent,
    delete_artifact: deleteArtifact,
  }
}
