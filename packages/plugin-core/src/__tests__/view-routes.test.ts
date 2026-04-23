/**
 * Tests for view CRUD routes.
 *
 * Uses a mock in-memory store and a fresh ViewRegistry per test to avoid
 * singleton state leakage between tests.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { Hono } from 'hono'
import { ViewRegistry } from '../view-registry'
import type { ViewStore } from '../view-store'
import type { ViewDef } from '@maisie/shared'
import { validateViewDef } from '@maisie/shared'

// ── In-memory store ───────────────────────────────────────────────────────────

function makeMemoryStore(): ViewStore {
  const data = new Map<string, ViewDef>()
  return {
    async save(view) { data.set(view.name, view) },
    async loadAll() { return [...data.values()] },
    async delete(name) { data.delete(name) },
    async get(name) { return data.get(name) ?? null },
  }
}

// ── Router factory (uses a fresh registry per test) ────────────────────────────

function makeRouter(store: ViewStore) {
  const registry = new ViewRegistry()

  const router = new Hono()

  router.get('/views', (c) => c.json(registry.list()))

  router.get('/views/:name', (c) => {
    const view = registry.get(c.req.param('name'))
    if (!view) return c.json({ error: 'not found' }, 404)
    return c.json(view)
  })

  router.post('/views', async (c) => {
    let body: { view?: ViewDef }
    try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON body' }, 400) }

    if (!body.view) return c.json({ error: 'expected "view" (ViewDef JSON)' }, 400)

    const view = body.view
    const errors = validateViewDef(view)
    if (errors.length > 0) {
      return c.json({ error: `validation error: ${errors.join(', ')}` }, 400)
    }

    try { registry.register(view) } catch (err) {
      return c.json({ error: `validation error: ${String(err)}` }, 400)
    }
    await store.save(view)
    return c.json(view, 201)
  })

  router.put('/views/:name', async (c) => {
    const name = c.req.param('name')
    let body: { view?: ViewDef }
    try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON body' }, 400) }

    if (!body.view) return c.json({ error: 'expected "view" (ViewDef JSON)' }, 400)

    const view = body.view
    if (view.name !== name) {
      return c.json({ error: `view name "${view.name}" does not match URL param "${name}"` }, 400)
    }

    registry.unregister(name)
    try { registry.register(view) } catch (err) {
      return c.json({ error: `validation error: ${String(err)}` }, 400)
    }
    await store.save(view)
    return c.json(view)
  })

  router.delete('/views/:name', async (c) => {
    const name = c.req.param('name')
    const view = registry.get(name)
    if (!view) return c.json({ error: 'not found' }, 404)

    registry.unregister(name)
    await store.delete(name)
    return c.json({ success: true })
  })

  return router
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeView(overrides: Partial<ViewDef> = {}): ViewDef {
  return {
    name: 'recent-movies-strip',
    source: { entity: 'plex.list_recently_added', field: 'result' },
    chain: [],
    component: 'Strip',
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /views', () => {
  it('returns empty array when no views registered', async () => {
    const store = makeMemoryStore()
    const router = makeRouter(store)
    const res = await router.request('http://localhost/views')
    expect(res.status).toBe(200)
    const body = await res.json() as ViewDef[]
    expect(body).toEqual([])
  })

  it('returns registered views', async () => {
    const store = makeMemoryStore()
    const router = makeRouter(store)
    await router.request('http://localhost/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view: makeView() }),
    })
    const res = await router.request('http://localhost/views')
    const body = await res.json() as ViewDef[]
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('recent-movies-strip')
  })
})

describe('GET /views/:name', () => {
  it('returns 404 when view does not exist', async () => {
    const router = makeRouter(makeMemoryStore())
    const res = await router.request('http://localhost/views/ghost')
    expect(res.status).toBe(404)
  })

  it('returns the view when it exists', async () => {
    const store = makeMemoryStore()
    const router = makeRouter(store)
    await router.request('http://localhost/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view: makeView() }),
    })
    const res = await router.request('http://localhost/views/recent-movies-strip')
    expect(res.status).toBe(200)
    const body = await res.json() as ViewDef
    expect(body.name).toBe('recent-movies-strip')
    expect(body.component).toBe('Strip')
  })
})

describe('POST /views', () => {
  it('creates a view and returns 201', async () => {
    const store = makeMemoryStore()
    const router = makeRouter(store)
    const res = await router.request('http://localhost/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view: makeView() }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as ViewDef
    expect(body.name).toBe('recent-movies-strip')
  })

  it('returns 400 when body is not JSON', async () => {
    const router = makeRouter(makeMemoryStore())
    const res = await router.request('http://localhost/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when view field is missing from body', async () => {
    const router = makeRouter(makeMemoryStore())
    const res = await router.request('http://localhost/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid view (missing component)', async () => {
    const router = makeRouter(makeMemoryStore())
    const res = await router.request('http://localhost/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        view: makeView({ component: '' }),
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/validation/)
  })

  it('persists the view to the store', async () => {
    const store = makeMemoryStore()
    const router = makeRouter(store)
    await router.request('http://localhost/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view: makeView() }),
    })
    const views = await store.loadAll()
    expect(views).toHaveLength(1)
    expect(views[0].name).toBe('recent-movies-strip')
  })
})

describe('PUT /views/:name', () => {
  it('updates a view', async () => {
    const store = makeMemoryStore()
    const router = makeRouter(store)

    await router.request('http://localhost/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view: makeView() }),
    })

    const res = await router.request('http://localhost/views/recent-movies-strip', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view: makeView({ description: 'Updated' }) }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as ViewDef
    expect(body.description).toBe('Updated')
  })

  it('returns 400 when name in body does not match URL', async () => {
    const router = makeRouter(makeMemoryStore())
    const res = await router.request('http://localhost/views/other-name', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view: makeView({ name: 'recent-movies-strip' }) }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/does not match/)
  })
})

describe('DELETE /views/:name', () => {
  it('deletes an existing view', async () => {
    const store = makeMemoryStore()
    const router = makeRouter(store)

    await router.request('http://localhost/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view: makeView() }),
    })

    const res = await router.request('http://localhost/views/recent-movies-strip', {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean }
    expect(body.success).toBe(true)

    const listRes = await router.request('http://localhost/views')
    const list = await listRes.json() as ViewDef[]
    expect(list).toHaveLength(0)
  })

  it('returns 404 when view does not exist', async () => {
    const router = makeRouter(makeMemoryStore())
    const res = await router.request('http://localhost/views/ghost', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})
