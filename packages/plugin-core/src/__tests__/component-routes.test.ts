/**
 * Tests for component CRUD routes.
 *
 * Uses a mock in-memory store and a fresh ComponentRegistry per test to
 * avoid singleton state leakage between tests.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { Hono } from 'hono'
import { ComponentRegistry } from '../component-registry'
import { parsedToComponentDef } from '../component-convert'
import type { DerivedComponentStore } from '../derived-component-store'
import type { ComponentDef } from '@maisie/shared'

// ── In-memory store ───────────────────────────────────────────────────────────

function makeMemoryStore(): DerivedComponentStore {
  const data = new Map<string, ComponentDef>()
  return {
    async save(component) { data.set(component.name, component) },
    async loadAll() { return [...data.values()] },
    async delete(name) { data.delete(name) },
    async get(name) { return data.get(name) ?? null },
  }
}

// ── Router factory (uses a fresh registry per test) ────────────────────────────

function makeRouter(store: DerivedComponentStore) {
  // Build a standalone router with a local registry instance (not singleton)
  // by manually wiring the registry.
  const registry = new ComponentRegistry()

  const router = new Hono()

  router.get('/components', (c) => c.json(registry.list()))

  router.get('/components/:name', (c) => {
    const component = registry.get(c.req.param('name'))
    if (!component) return c.json({ error: 'not found' }, 404)
    return c.json(component)
  })

  router.post('/components', async (c) => {
    let body: { source?: string; component?: ComponentDef }
    try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON body' }, 400) }

    let component: ComponentDef
    if (body.source) {
      const { parse } = await import('@maisie/shared')
      let parsed
      try { parsed = parse(body.source) } catch (err) {
        return c.json({ error: `parse error: ${String(err)}` }, 400)
      }
      if (!('kind' in parsed) || parsed.kind !== 'component') {
        return c.json({ error: 'source does not define a component (no render: field)' }, 400)
      }
      component = parsedToComponentDef(parsed)
    } else if (body.component) {
      component = body.component
    } else {
      return c.json({ error: 'expected "source" or "component"' }, 400)
    }

    try { registry.register(component) } catch (err) {
      return c.json({ error: `validation error: ${String(err)}` }, 400)
    }
    await store.save(component)
    return c.json(component, 201)
  })

  router.put('/components/:name', async (c) => {
    const name = c.req.param('name')
    let body: { source?: string; component?: ComponentDef }
    try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON body' }, 400) }

    let component: ComponentDef
    if (body.source) {
      const { parse } = await import('@maisie/shared')
      let parsed
      try { parsed = parse(body.source) } catch (err) {
        return c.json({ error: `parse error: ${String(err)}` }, 400)
      }
      if (!('kind' in parsed) || parsed.kind !== 'component') {
        return c.json({ error: 'source does not define a component' }, 400)
      }
      component = parsedToComponentDef(parsed)
    } else if (body.component) {
      component = body.component
    } else {
      return c.json({ error: 'expected "source" or "component"' }, 400)
    }

    if (component.name !== name) {
      return c.json({ error: `component name "${component.name}" does not match URL path "${name}"` }, 400)
    }
    const existing = registry.get(name)
    if (existing && existing.kind !== 'derived') {
      return c.json({ error: 'cannot update a base or layout component' }, 400)
    }
    try {
      registry.unregister(name)
      registry.register(component)
    } catch (err) {
      return c.json({ error: `validation error: ${String(err)}` }, 400)
    }
    await store.save(component)
    return c.json(component)
  })

  router.delete('/components/:name', async (c) => {
    const name = c.req.param('name')
    const component = registry.get(name)
    if (!component) return c.json({ error: 'not found' }, 404)
    if (component.kind !== 'derived') {
      return c.json({ error: 'cannot delete base or layout components' }, 400)
    }
    registry.unregister(name)
    await store.delete(name)
    return c.json({ success: true })
  })

  return { router, registry }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function req(
  router: Hono,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const r = new Request(`http://localhost${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const res = await router.fetch(r)
  const json = await res.json()
  return { status: res.status, json }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DERIVED_COMPONENT: ComponentDef = {
  name: 'test.MyTile',
  kind: 'derived',
  description: 'A test tile',
  input: { kind: 'record', fields: { title: { kind: 'scalar', type: 'string' } } },
  render: { kind: 'literal', value: 'stub' },
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /components', () => {
  it('returns base and layout components on a fresh registry', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    const { status, json } = await req(router, 'GET', '/components')
    expect(status).toBe(200)
    const list = json as ComponentDef[]
    expect(Array.isArray(list)).toBe(true)
    expect(list.some((c) => c.name === 'text' && c.kind === 'base')).toBe(true)
    expect(list.some((c) => c.name === 'stack' && c.kind === 'layout')).toBe(true)
  })
})

describe('GET /components/:name', () => {
  it('returns 404 for unknown component', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    const { status } = await req(router, 'GET', '/components/no.such.thing')
    expect(status).toBe(404)
  })

  it('returns a base component by name', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    const { status, json } = await req(router, 'GET', '/components/text')
    expect(status).toBe(200)
    expect((json as ComponentDef).name).toBe('text')
    expect((json as ComponentDef).kind).toBe('base')
  })
})

describe('POST /components', () => {
  it('creates a derived component from ComponentDef JSON', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    const { status, json } = await req(router, 'POST', '/components', { component: DERIVED_COMPONENT })
    expect(status).toBe(201)
    expect((json as ComponentDef).name).toBe('test.MyTile')
    expect((json as ComponentDef).kind).toBe('derived')
  })

  it('persists to the store', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    await req(router, 'POST', '/components', { component: DERIVED_COMPONENT })
    const all = await store.loadAll()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('test.MyTile')
  })

  it('returns 400 when body has neither source nor component', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    const { status } = await req(router, 'POST', '/components', {})
    expect(status).toBe(400)
  })

  it('returns 400 when component validation fails', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    const bad: ComponentDef = { name: 'bad.comp', kind: 'derived' } // missing render
    const { status } = await req(router, 'POST', '/components', { component: bad })
    expect(status).toBe(400)
  })

  it('is idempotent — creating the same component twice overwrites', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    await req(router, 'POST', '/components', { component: DERIVED_COMPONENT })
    const updated = { ...DERIVED_COMPONENT, description: 'Updated' }
    const { status } = await req(router, 'POST', '/components', { component: updated })
    expect(status).toBe(201)
    const { json } = await req(router, 'GET', '/components/test.MyTile')
    expect((json as ComponentDef).description).toBe('Updated')
  })
})

describe('PUT /components/:name', () => {
  it('updates an existing derived component', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    await req(router, 'POST', '/components', { component: DERIVED_COMPONENT })

    const updated = { ...DERIVED_COMPONENT, description: 'Updated description' }
    const { status, json } = await req(router, 'PUT', '/components/test.MyTile', { component: updated })
    expect(status).toBe(200)
    expect((json as ComponentDef).description).toBe('Updated description')
  })

  it('returns 400 when component name does not match URL', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    const { status } = await req(router, 'PUT', '/components/wrong.name', { component: DERIVED_COMPONENT })
    expect(status).toBe(400)
  })

  it('returns 400 when trying to update a base component', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    const baseAsUpdate: ComponentDef = { name: 'text', kind: 'base', input: { kind: 'scalar', type: 'string' } }
    const { status } = await req(router, 'PUT', '/components/text', { component: baseAsUpdate })
    expect(status).toBe(400)
  })
})

describe('DELETE /components/:name', () => {
  it('deletes a derived component', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    await req(router, 'POST', '/components', { component: DERIVED_COMPONENT })

    const { status, json } = await req(router, 'DELETE', '/components/test.MyTile')
    expect(status).toBe(200)
    expect((json as { success: boolean }).success).toBe(true)

    const { status: getStatus } = await req(router, 'GET', '/components/test.MyTile')
    expect(getStatus).toBe(404)
  })

  it('removes from store', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    await req(router, 'POST', '/components', { component: DERIVED_COMPONENT })
    await req(router, 'DELETE', '/components/test.MyTile')
    const all = await store.loadAll()
    expect(all).toHaveLength(0)
  })

  it('returns 404 for unknown component', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    const { status } = await req(router, 'DELETE', '/components/no.such.thing')
    expect(status).toBe(404)
  })

  it('returns 400 when trying to delete a base component', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    const { status } = await req(router, 'DELETE', '/components/text')
    expect(status).toBe(400)
  })

  it('returns 400 when trying to delete a layout primitive', async () => {
    const store = makeMemoryStore()
    const { router } = makeRouter(store)
    const { status } = await req(router, 'DELETE', '/components/stack')
    expect(status).toBe(400)
  })
})
