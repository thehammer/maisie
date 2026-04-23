/**
 * Hono routes for the canvas document persistence API.
 *
 * Endpoints:
 *   GET    /canvas/:id  — load a canvas document (returns {document} or 404)
 *   PUT    /canvas/:id  — save a canvas document (body: {document})
 *   DELETE /canvas/:id  — clear a canvas document
 *
 * Phase 3l uses 'default' as the singleton id for all users.
 */

import { Hono } from 'hono'
import type { CanvasDocumentStore } from './canvas-document-store'

export function createCanvasRouter(store: CanvasDocumentStore) {
  const router = new Hono()

  // ── Load ─────────────────────────────────────────────────────────────────────

  router.get('/canvas/:id', async (c) => {
    const id = c.req.param('id')
    const document = await store.load(id)
    if (document === null) return c.json({ error: 'not found' }, 404)
    return c.json({ document })
  })

  // ── Save ─────────────────────────────────────────────────────────────────────

  router.put('/canvas/:id', async (c) => {
    const id = c.req.param('id')
    let body: { document?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }

    if (body.document === undefined) {
      return c.json({ error: 'expected "document" in request body' }, 400)
    }

    try {
      await store.save(id, body.document)
    } catch (err) {
      return c.json({ error: `persistence error: ${String(err)}` }, 500)
    }

    return c.json({ ok: true })
  })

  // ── Clear ────────────────────────────────────────────────────────────────────

  router.delete('/canvas/:id', async (c) => {
    const id = c.req.param('id')
    try {
      await store.clear(id)
    } catch (err) {
      return c.json({ error: `persistence error: ${String(err)}` }, 500)
    }
    return c.json({ ok: true })
  })

  return router
}
