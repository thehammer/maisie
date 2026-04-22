/**
 * Hono routes for the entity CRUD + field resolution API.
 *
 * Endpoints:
 *   GET    /entities               — list all entities (plugin + derived)
 *   GET    /entities/:name         — get one entity definition
 *   POST   /entities               — create derived entity (MEL source or EntityDef JSON)
 *   PUT    /entities/:name         — update derived entity
 *   DELETE /entities/:name         — delete derived entity
 *   GET    /entities/:name/:field  — resolve a data field to its live value
 *   POST   /entities/:name/:field  — invoke a function field
 */

import { Hono } from 'hono'
import type { EntityDef } from '@maisie/shared'
import { parse } from '@maisie/shared'
import { entityRegistry } from './entity-registry'
import { parsedToEntityDef } from './entity-convert'
import type { DerivedEntityStore } from './derived-entity-store'
import type { ActionContext } from './address-resolver'
import { createAddressResolver } from './address-resolver'

export function createEntityRouter(
  store: DerivedEntityStore,
  actionContext: ActionContext,
) {
  const router = new Hono()
  const resolver = createAddressResolver(actionContext)

  // ── List all entities ────────────────────────────────────────────────────────

  router.get('/entities', (c) => {
    return c.json(entityRegistry.list())
  })

  // ── Get one entity definition ────────────────────────────────────────────────

  router.get('/entities/:name', (c) => {
    const entity = entityRegistry.get(c.req.param('name'))
    if (!entity) return c.json({ error: 'not found' }, 404)
    return c.json(entity)
  })

  // ── Create a derived entity ──────────────────────────────────────────────────

  router.post('/entities', async (c) => {
    let body: { source?: string; entity?: EntityDef }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }

    let entity: EntityDef
    if (body.source) {
      let parsed
      try {
        parsed = parse(body.source)
      } catch (err) {
        return c.json({ error: `parse error: ${String(err)}` }, 400)
      }
      if (!('kind' in parsed) || parsed.kind !== 'entity') {
        return c.json({ error: 'source does not define an entity (expected a define block)' }, 400)
      }
      entity = parsedToEntityDef(parsed)
    } else if (body.entity) {
      entity = body.entity
    } else {
      return c.json({ error: 'expected "source" (MEL string) or "entity" (EntityDef JSON)' }, 400)
    }

    try {
      entityRegistry.register(entity)
    } catch (err) {
      return c.json({ error: `validation error: ${String(err)}` }, 400)
    }

    try {
      await store.save(entity)
    } catch (err) {
      // Rollback registry on persistence failure
      entityRegistry.unregister(entity.name)
      return c.json({ error: `persistence error: ${String(err)}` }, 500)
    }

    return c.json(entity, 201)
  })

  // ── Update a derived entity ──────────────────────────────────────────────────

  router.put('/entities/:name', async (c) => {
    const name = c.req.param('name')

    let body: { source?: string; entity?: EntityDef }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }

    let entity: EntityDef
    if (body.source) {
      let parsed
      try {
        parsed = parse(body.source)
      } catch (err) {
        return c.json({ error: `parse error: ${String(err)}` }, 400)
      }
      if (!('kind' in parsed) || parsed.kind !== 'entity') {
        return c.json({ error: 'source does not define an entity' }, 400)
      }
      entity = parsedToEntityDef(parsed)
    } else if (body.entity) {
      entity = body.entity
    } else {
      return c.json({ error: 'expected "source" or "entity"' }, 400)
    }

    // Ensure the entity name matches the URL param.
    if (entity.name !== name) {
      return c.json({ error: `entity name "${entity.name}" does not match URL param "${name}"` }, 400)
    }

    // Only allow updating derived entities.
    const existing = entityRegistry.get(name)
    if (existing && existing.source !== 'derived') {
      return c.json({ error: 'cannot update a base (plugin) entity' }, 400)
    }

    try {
      // Unregister old version (if any) then register new.
      entityRegistry.unregister(name)
      entityRegistry.register(entity)
    } catch (err) {
      return c.json({ error: `validation error: ${String(err)}` }, 400)
    }

    try {
      await store.save(entity)
    } catch (err) {
      return c.json({ error: `persistence error: ${String(err)}` }, 500)
    }

    return c.json(entity)
  })

  // ── Delete a derived entity ──────────────────────────────────────────────────

  router.delete('/entities/:name', async (c) => {
    const name = c.req.param('name')
    const entity = entityRegistry.get(name)
    if (!entity) return c.json({ error: 'not found' }, 404)
    if (entity.source !== 'derived') {
      return c.json({ error: 'cannot delete a base (plugin) entity' }, 400)
    }

    entityRegistry.unregister(name)

    try {
      await store.delete(name)
    } catch (err) {
      // Re-register on persistence failure to keep registry consistent.
      entityRegistry.register(entity)
      return c.json({ error: `persistence error: ${String(err)}` }, 500)
    }

    return c.json({ success: true })
  })

  // ── Resolve a data field to its live value ───────────────────────────────────

  router.get('/entities/:name/:field', async (c) => {
    const name = c.req.param('name')
    const field = c.req.param('field')
    const address = `${name}.${field}`
    try {
      const value = await resolver.resolve(address)
      return c.json({ value })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // ── Invoke a function field ──────────────────────────────────────────────────

  router.post('/entities/:name/:field', async (c) => {
    const name = c.req.param('name')
    const field = c.req.param('field')
    const address = `${name}.${field}`

    let args: Record<string, unknown> = {}
    try {
      args = await c.req.json()
    } catch {
      // No body or non-JSON is fine — use empty args.
    }

    try {
      const result = await resolver.invoke(address, args as MaisieRecord)
      return c.json({ result })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  return router
}

// Type import for the invoke call
import type { MaisieRecord } from '@maisie/shared'
