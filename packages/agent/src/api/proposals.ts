/**
 * HTTP routes for agent proposals (Phase 4e).
 *
 * Proposals are pending MEL artifacts that the agent has suggested but that
 * require human approval before being saved to the catalog.
 *
 * Routes:
 *   GET    /proposals          — list all proposals (optional ?status filter)
 *   GET    /proposals/:id      — get one proposal
 *   POST   /proposals/:id/approve — approve: parse MEL and save via catalog path
 *   POST   /proposals/:id/reject  — mark rejected
 *   DELETE /proposals/:id      — remove entirely
 *
 * The approval path delegates to the same code that save_entity/save_component
 * uses (parsedToEntityDef / parsedToComponentDef + registry + store), keeping
 * a single source of truth for catalog artifact creation.
 */

import { Hono } from 'hono'
import { parse } from '@maisie/shared'
import type { ParsedEntity, ParsedComponent } from '@maisie/shared'
import { entityRegistry, componentRegistry } from '@maisie/plugin-core'
import { parsedToEntityDef } from '@maisie/plugin-core/src/entity-convert'
import { parsedToComponentDef } from '@maisie/plugin-core/src/component-convert'
import type { ProposalStore } from '../services/proposal-store'
import type { DerivedEntityStore } from '@maisie/plugin-core/src/derived-entity-store'
import type { DerivedComponentStore } from '@maisie/plugin-core/src/derived-component-store'

export interface ProposalRouteDeps {
  proposalStore: ProposalStore
  entityStore: DerivedEntityStore
  componentStore: DerivedComponentStore
}

export function createProposalsRouter(deps: ProposalRouteDeps) {
  const { proposalStore, entityStore, componentStore } = deps
  const router = new Hono()

  // GET /proposals — list with optional ?status filter
  router.get('/proposals', async (c) => {
    try {
      const status = c.req.query('status') as 'pending' | 'approved' | 'rejected' | undefined
      const filter = status ? { status } : undefined
      const list = await proposalStore.list(filter)
      return c.json(list)
    } catch (err) {
      console.error('[proposals] list error:', err)
      return c.json({ error: String(err) }, 500)
    }
  })

  // GET /proposals/:id — get one
  router.get('/proposals/:id', async (c) => {
    try {
      const proposal = await proposalStore.get(c.req.param('id'))
      if (!proposal) return c.json({ error: 'Proposal not found' }, 404)
      return c.json(proposal)
    } catch (err) {
      console.error('[proposals] get error:', err)
      return c.json({ error: String(err) }, 500)
    }
  })

  // POST /proposals/:id/approve — approve and save artifact
  router.post('/proposals/:id/approve', async (c) => {
    const id = c.req.param('id')
    try {
      const proposal = await proposalStore.get(id)
      if (!proposal) return c.json({ error: 'Proposal not found' }, 404)
      if (proposal.status !== 'pending') {
        return c.json({ error: `Proposal is already ${proposal.status}` }, 409)
      }

      // Parse the MEL source — same validation as save_entity/save_component.
      let parsed: ReturnType<typeof parse>
      try {
        parsed = parse(proposal.source)
      } catch (err) {
        await proposalStore.markRejected(id)
        return c.json({
          error: `MEL parse error: ${err instanceof Error ? err.message : String(err)}`,
          proposal: await proposalStore.get(id),
        }, 422)
      }

      if (parsed === null || typeof parsed !== 'object' || !('kind' in parsed)) {
        await proposalStore.markRejected(id)
        return c.json({ error: 'Source must be a define block' }, 422)
      }

      const typedParsed = parsed as ParsedEntity | ParsedComponent

      if (typedParsed.kind !== 'entity' && typedParsed.kind !== 'component') {
        await proposalStore.markRejected(id)
        return c.json({ error: 'Source must be a define block (entity or component), not a plain expression.' }, 422)
      }

      if (typedParsed.kind === 'entity') {
        // Reuse save_entity path exactly.
        const entityDef = parsedToEntityDef(typedParsed as ParsedEntity)

        const existing = entityRegistry.get(entityDef.name)
        if (existing && existing.source === 'plugin') {
          return c.json({
            error: `Cannot overwrite plugin entity "${entityDef.name}". Plugin entities are read-only.`,
          }, 409)
        }

        try {
          entityRegistry.register(entityDef)
        } catch (err) {
          await proposalStore.markRejected(id)
          return c.json({
            error: `Validation error: ${err instanceof Error ? err.message : String(err)}`,
          }, 422)
        }

        await entityStore.save(entityDef)
        await proposalStore.markApproved(id)

        return c.json({
          approved: true,
          kind: 'entity',
          name: entityDef.name,
          proposal: await proposalStore.get(id),
        })
      } else {
        // Reuse save_component path exactly.
        const componentDef = parsedToComponentDef(typedParsed as ParsedComponent)

        try {
          componentRegistry.register(componentDef)
        } catch (err) {
          await proposalStore.markRejected(id)
          return c.json({
            error: `Validation error: ${err instanceof Error ? err.message : String(err)}`,
          }, 422)
        }

        await componentStore.save(componentDef)
        await proposalStore.markApproved(id)

        return c.json({
          approved: true,
          kind: 'component',
          name: componentDef.name,
          proposal: await proposalStore.get(id),
        })
      }
    } catch (err) {
      console.error('[proposals] approve error:', err)
      return c.json({ error: String(err) }, 500)
    }
  })

  // POST /proposals/:id/reject — mark rejected
  router.post('/proposals/:id/reject', async (c) => {
    const id = c.req.param('id')
    try {
      const proposal = await proposalStore.get(id)
      if (!proposal) return c.json({ error: 'Proposal not found' }, 404)
      if (proposal.status !== 'pending') {
        return c.json({ error: `Proposal is already ${proposal.status}` }, 409)
      }

      await proposalStore.markRejected(id)
      return c.json({ rejected: true, id })
    } catch (err) {
      console.error('[proposals] reject error:', err)
      return c.json({ error: String(err) }, 500)
    }
  })

  // DELETE /proposals/:id — remove entirely
  router.delete('/proposals/:id', async (c) => {
    const id = c.req.param('id')
    try {
      const proposal = await proposalStore.get(id)
      if (!proposal) return c.json({ error: 'Proposal not found' }, 404)

      await proposalStore.delete(id)
      return c.json({ deleted: true, id })
    } catch (err) {
      console.error('[proposals] delete error:', err)
      return c.json({ error: String(err) }, 500)
    }
  })

  return router
}
