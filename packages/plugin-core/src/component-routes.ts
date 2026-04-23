/**
 * Hono routes for the component CRUD API.
 *
 * Endpoints:
 *   GET    /components          — list all components (base + layout + derived)
 *   GET    /components/:name    — get one component definition
 *   POST   /components          — create derived component (MEL source or ComponentDef JSON)
 *   PUT    /components/:name    — update derived component
 *   DELETE /components/:name    — delete derived component
 */

import { Hono } from 'hono'
import type { ComponentDef } from '@maisie/shared'
import { parse } from '@maisie/shared'
import { componentRegistry } from './component-registry'
import { parsedToComponentDef } from './component-convert'
import type { DerivedComponentStore } from './derived-component-store'

export function createComponentRouter(store: DerivedComponentStore) {
  const router = new Hono()

  // ── List all components ────────────────────────────────────────────────────

  router.get('/components', (c) => {
    return c.json(componentRegistry.list())
  })

  // ── Get one component definition ───────────────────────────────────────────

  router.get('/components/:name', (c) => {
    const component = componentRegistry.get(c.req.param('name'))
    if (!component) return c.json({ error: 'not found' }, 404)
    return c.json(component)
  })

  // ── Create a derived component ─────────────────────────────────────────────

  router.post('/components', async (c) => {
    let body: { source?: string; component?: ComponentDef }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }

    let component: ComponentDef
    if (body.source) {
      let parsed
      try {
        parsed = parse(body.source)
      } catch (err) {
        return c.json({ error: `parse error: ${String(err)}` }, 400)
      }
      if (!('kind' in parsed) || parsed.kind !== 'component') {
        return c.json({ error: 'source does not define a component (no render: field)' }, 400)
      }
      component = parsedToComponentDef(parsed)
    } else if (body.component) {
      component = body.component
    } else {
      return c.json({ error: 'expected "source" (MEL string) or "component" (ComponentDef JSON)' }, 400)
    }

    try {
      componentRegistry.register(component)
    } catch (err) {
      return c.json({ error: `validation error: ${String(err)}` }, 400)
    }

    try {
      await store.save(component)
    } catch (err) {
      // Rollback registry on persistence failure
      componentRegistry.unregister(component.name)
      return c.json({ error: `persistence error: ${String(err)}` }, 500)
    }

    return c.json(component, 201)
  })

  // ── Update a derived component ─────────────────────────────────────────────

  router.put('/components/:name', async (c) => {
    const name = c.req.param('name')

    let body: { source?: string; component?: ComponentDef }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }

    let component: ComponentDef
    if (body.source) {
      let parsed
      try {
        parsed = parse(body.source)
      } catch (err) {
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
      return c.json(
        { error: `component name "${component.name}" does not match URL path "${name}"` },
        400,
      )
    }

    // Only allow updating derived components.
    const existing = componentRegistry.get(name)
    if (existing && existing.kind !== 'derived') {
      return c.json({ error: 'cannot update a base or layout component' }, 400)
    }

    try {
      componentRegistry.unregister(name)
      componentRegistry.register(component)
    } catch (err) {
      return c.json({ error: `validation error: ${String(err)}` }, 400)
    }

    try {
      await store.save(component)
    } catch (err) {
      return c.json({ error: `persistence error: ${String(err)}` }, 500)
    }

    return c.json(component)
  })

  // ── Delete a derived component ─────────────────────────────────────────────

  router.delete('/components/:name', async (c) => {
    const name = c.req.param('name')
    const component = componentRegistry.get(name)
    if (!component) return c.json({ error: 'not found' }, 404)
    if (component.kind !== 'derived') {
      return c.json({ error: 'cannot delete base or layout components' }, 400)
    }

    componentRegistry.unregister(name)

    try {
      await store.delete(name)
    } catch (err) {
      // Re-register on persistence failure to keep registry consistent.
      componentRegistry.register(component)
      return c.json({ error: `persistence error: ${String(err)}` }, 500)
    }

    return c.json({ success: true })
  })

  return router
}
