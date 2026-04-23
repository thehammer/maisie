/**
 * Hono routes for the view CRUD API.
 *
 * Endpoints:
 *   GET    /views        — list all views
 *   GET    /views/:name  — get one view definition
 *   POST   /views        — create a view (body: { view: ViewDef })
 *   PUT    /views/:name  — update a view (body: { view: ViewDef })
 *   DELETE /views/:name  — delete a view
 */

import { Hono } from 'hono'
import type { ViewDef } from '@maisie/shared'
import { viewRegistry } from './view-registry'
import type { ViewStore } from './view-store'

export function createViewRouter(store: ViewStore) {
  const router = new Hono()

  // ── List all views ───────────────────────────────────────────────────────────

  router.get('/views', (c) => {
    return c.json(viewRegistry.list())
  })

  // ── Get one view ─────────────────────────────────────────────────────────────

  router.get('/views/:name', (c) => {
    const view = viewRegistry.get(c.req.param('name'))
    if (!view) return c.json({ error: 'not found' }, 404)
    return c.json(view)
  })

  // ── Create a view ────────────────────────────────────────────────────────────

  router.post('/views', async (c) => {
    let body: { view?: ViewDef }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }

    if (!body.view) {
      return c.json({ error: 'expected "view" (ViewDef JSON)' }, 400)
    }

    const view = body.view

    try {
      viewRegistry.register(view)
    } catch (err) {
      return c.json({ error: `validation error: ${String(err)}` }, 400)
    }

    try {
      await store.save(view)
    } catch (err) {
      // Rollback registry on persistence failure
      viewRegistry.unregister(view.name)
      return c.json({ error: `persistence error: ${String(err)}` }, 500)
    }

    return c.json(view, 201)
  })

  // ── Update a view ────────────────────────────────────────────────────────────

  router.put('/views/:name', async (c) => {
    const name = c.req.param('name')

    let body: { view?: ViewDef }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }

    if (!body.view) {
      return c.json({ error: 'expected "view" (ViewDef JSON)' }, 400)
    }

    const view = body.view

    // Ensure view name matches URL param
    if (view.name !== name) {
      return c.json({ error: `view name "${view.name}" does not match URL param "${name}"` }, 400)
    }

    // Unregister old, register new
    viewRegistry.unregister(name)
    try {
      viewRegistry.register(view)
    } catch (err) {
      return c.json({ error: `validation error: ${String(err)}` }, 400)
    }

    try {
      await store.save(view)
    } catch (err) {
      return c.json({ error: `persistence error: ${String(err)}` }, 500)
    }

    return c.json(view)
  })

  // ── Delete a view ────────────────────────────────────────────────────────────

  router.delete('/views/:name', async (c) => {
    const name = c.req.param('name')
    const view = viewRegistry.get(name)
    if (!view) return c.json({ error: 'not found' }, 404)

    viewRegistry.unregister(name)

    try {
      await store.delete(name)
    } catch (err) {
      // Re-register on persistence failure to keep registry consistent
      viewRegistry.register(view)
      return c.json({ error: `persistence error: ${String(err)}` }, 500)
    }

    return c.json({ success: true })
  })

  return router
}
