/**
 * Tests for the proposals HTTP routes (Phase 4e).
 *
 * Covers:
 * - GET /proposals (list, filter)
 * - GET /proposals/:id (get one, 404)
 * - POST /proposals/:id/approve (happy path, already-resolved, invalid MEL)
 * - POST /proposals/:id/reject (happy path, already-resolved)
 * - DELETE /proposals/:id
 *
 * Approval path uses real entity/component registries and mock stores, so we
 * confirm the same code path as save_entity/save_component is exercised.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { createProposalsRouter } from '../proposals'
import { entityRegistry, componentRegistry } from '@maisie/plugin-core'
import type { ProposalStore, Proposal } from '../../services/proposal-store'
import type { DerivedEntityStore } from '@maisie/plugin-core/src/derived-entity-store'
import type { DerivedComponentStore } from '@maisie/plugin-core/src/derived-component-store'
import type { EntityDef, ComponentDef } from '@maisie/shared'

// ── Mock stores ───────────────────────────────────────────────────────────────

function makeMockProposalStore(): ProposalStore & { _store: Map<string, Proposal> } {
  const _store = new Map<string, Proposal>()

  return {
    _store,
    async create(input) {
      const p: Proposal = {
        id: crypto.randomUUID(),
        kind: input.kind,
        name: input.name,
        source: input.source,
        reasoning: input.reasoning,
        status: 'pending',
        createdAt: new Date(),
      }
      _store.set(p.id, p)
      return p
    },
    async list(filter) {
      const all = [..._store.values()]
      if (filter?.status) return all.filter((p) => p.status === filter.status)
      return all
    },
    async get(id) { return _store.get(id) ?? null },
    async markApproved(id) {
      const p = _store.get(id)
      if (p) _store.set(id, { ...p, status: 'approved', resolvedAt: new Date() })
    },
    async markRejected(id) {
      const p = _store.get(id)
      if (p) _store.set(id, { ...p, status: 'rejected', resolvedAt: new Date() })
    },
    async delete(id) { _store.delete(id) },
  }
}

function makeMockEntityStore(): DerivedEntityStore & { _saved: Map<string, EntityDef> } {
  const _saved = new Map<string, EntityDef>()
  return {
    _saved,
    async save(entity) { _saved.set(entity.name, entity) },
    async loadAll() { return [..._saved.values()] },
    async delete(name) { _saved.delete(name) },
    async get(name) { return _saved.get(name) ?? null },
  }
}

function makeMockComponentStore(): DerivedComponentStore & { _saved: Map<string, ComponentDef> } {
  const _saved = new Map<string, ComponentDef>()
  return {
    _saved,
    async save(component) { _saved.set(component.name, component) },
    async loadAll() { return [..._saved.values()] },
    async delete(name) { _saved.delete(name) },
    async get(name) { return _saved.get(name) ?? null },
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function makeRequest(
  router: ReturnType<typeof createProposalsRouter>,
  method: string,
  path: string,
  body?: unknown,
) {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const res = await router.fetch(req)
  const json = await res.json()
  return { status: res.status, json }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  entityRegistry.clear()
  componentRegistry.clear()
})

function makeRouter() {
  const proposalStore = makeMockProposalStore()
  const entityStore = makeMockEntityStore()
  const componentStore = makeMockComponentStore()
  const router = createProposalsRouter({ proposalStore, entityStore, componentStore })
  return { router, proposalStore, entityStore, componentStore }
}

// ── GET /proposals ────────────────────────────────────────────────────────────

describe('GET /proposals', () => {
  test('returns empty array when no proposals exist', async () => {
    const { router } = makeRouter()
    const { status, json } = await makeRequest(router, 'GET', '/proposals')
    expect(status).toBe(200)
    expect(json).toEqual([])
  })

  test('returns all proposals without filter', async () => {
    const { router, proposalStore } = makeRouter()
    await proposalStore.create({ kind: 'entity', name: 'a', source: 'define a { x: number = 1 }' })
    await proposalStore.create({ kind: 'component', name: 'B', source: 'define B { render: text(value: x) }' })

    const { status, json } = await makeRequest(router, 'GET', '/proposals')
    expect(status).toBe(200)
    expect((json as unknown[]).length).toBe(2)
  })

  test('filters by status=pending', async () => {
    const { router, proposalStore } = makeRouter()
    const p1 = await proposalStore.create({ kind: 'entity', name: 'a', source: 'define a { x: number = 1 }' })
    await proposalStore.create({ kind: 'entity', name: 'b', source: 'define b { x: number = 2 }' })
    await proposalStore.markApproved(p1.id)

    const { status, json } = await makeRequest(router, 'GET', '/proposals?status=pending')
    expect(status).toBe(200)
    const list = json as Proposal[]
    expect(list.length).toBe(1)
    expect(list[0].status).toBe('pending')
  })
})

// ── GET /proposals/:id ────────────────────────────────────────────────────────

describe('GET /proposals/:id', () => {
  test('returns 404 for unknown id', async () => {
    const { router } = makeRouter()
    const { status } = await makeRequest(router, 'GET', '/proposals/no-such-id')
    expect(status).toBe(404)
  })

  test('returns the proposal by id', async () => {
    const { router, proposalStore } = makeRouter()
    const p = await proposalStore.create({ kind: 'entity', name: 'x', source: 'define x { n: number = 1 }' })

    const { status, json } = await makeRequest(router, 'GET', `/proposals/${p.id}`)
    expect(status).toBe(200)
    expect((json as Proposal).id).toBe(p.id)
    expect((json as Proposal).name).toBe('x')
  })
})

// ── POST /proposals/:id/approve ───────────────────────────────────────────────

describe('POST /proposals/:id/approve', () => {
  test('approves an entity proposal and saves to entity store', async () => {
    const { router, proposalStore, entityStore } = makeRouter()
    const p = await proposalStore.create({
      kind: 'entity',
      name: 'unwatched-movies',
      source: 'define unwatched-movies { count: number = 42 }',
    })

    const { status, json } = await makeRequest(router, 'POST', `/proposals/${p.id}/approve`)
    expect(status).toBe(200)
    expect((json as any).approved).toBe(true)
    expect((json as any).kind).toBe('entity')
    expect((json as any).name).toBe('unwatched-movies')

    // Proposal marked approved in store
    const updated = await proposalStore.get(p.id)
    expect(updated!.status).toBe('approved')

    // Entity saved to entity store
    expect(entityStore._saved.has('unwatched-movies')).toBe(true)

    // Entity registered in entity registry
    expect(entityRegistry.get('unwatched-movies')).not.toBeNull()
  })

  test('approves a component proposal and saves to component store', async () => {
    const { router, proposalStore, componentStore } = makeRouter()
    const p = await proposalStore.create({
      kind: 'component',
      name: 'MovieCard',
      source: 'define MovieCard { render: text(value: title) }',
    })

    const { status, json } = await makeRequest(router, 'POST', `/proposals/${p.id}/approve`)
    expect(status).toBe(200)
    expect((json as any).approved).toBe(true)
    expect((json as any).kind).toBe('component')

    const updated = await proposalStore.get(p.id)
    expect(updated!.status).toBe('approved')
    expect(componentStore._saved.has('MovieCard')).toBe(true)
    expect(componentRegistry.get('MovieCard')).not.toBeNull()
  })

  test('returns 404 for unknown proposal id', async () => {
    const { router } = makeRouter()
    const { status } = await makeRequest(router, 'POST', '/proposals/no-such-id/approve')
    expect(status).toBe(404)
  })

  test('returns 409 when proposal is already resolved', async () => {
    const { router, proposalStore } = makeRouter()
    const p = await proposalStore.create({ kind: 'entity', name: 'x', source: 'define x { n: number = 1 }' })
    await proposalStore.markRejected(p.id)

    const { status, json } = await makeRequest(router, 'POST', `/proposals/${p.id}/approve`)
    expect(status).toBe(409)
    expect((json as any).error).toContain('rejected')
  })

  test('rejects the proposal when MEL source fails to parse', async () => {
    const { router, proposalStore } = makeRouter()
    // Manually insert a proposal with broken source (bypassing tool validation)
    const p: Proposal = {
      id: crypto.randomUUID(),
      kind: 'entity',
      name: 'broken',
      source: 'this is totally invalid @@@',
      status: 'pending',
      createdAt: new Date(),
    }
    proposalStore._store.set(p.id, p)

    const { status, json } = await makeRequest(router, 'POST', `/proposals/${p.id}/approve`)
    expect(status).toBe(422)
    expect((json as any).error).toBeDefined()

    const updated = await proposalStore.get(p.id)
    expect(updated!.status).toBe('rejected')
  })
})

// ── POST /proposals/:id/reject ────────────────────────────────────────────────

describe('POST /proposals/:id/reject', () => {
  test('marks the proposal as rejected', async () => {
    const { router, proposalStore } = makeRouter()
    const p = await proposalStore.create({ kind: 'entity', name: 'x', source: 'define x { n: number = 1 }' })

    const { status, json } = await makeRequest(router, 'POST', `/proposals/${p.id}/reject`)
    expect(status).toBe(200)
    expect((json as any).rejected).toBe(true)

    const updated = await proposalStore.get(p.id)
    expect(updated!.status).toBe('rejected')
  })

  test('does NOT save anything to entity store on rejection', async () => {
    const { router, proposalStore, entityStore } = makeRouter()
    const p = await proposalStore.create({
      kind: 'entity',
      name: 'unwatched-movies',
      source: 'define unwatched-movies { count: number = 42 }',
    })

    await makeRequest(router, 'POST', `/proposals/${p.id}/reject`)
    expect(entityStore._saved.size).toBe(0)
  })

  test('returns 404 for unknown proposal id', async () => {
    const { router } = makeRouter()
    const { status } = await makeRequest(router, 'POST', '/proposals/no-such-id/reject')
    expect(status).toBe(404)
  })

  test('returns 409 when proposal is already resolved', async () => {
    const { router, proposalStore } = makeRouter()
    const p = await proposalStore.create({ kind: 'entity', name: 'x', source: 'define x { n: number = 1 }' })
    await proposalStore.markApproved(p.id)

    const { status, json } = await makeRequest(router, 'POST', `/proposals/${p.id}/reject`)
    expect(status).toBe(409)
    expect((json as any).error).toContain('approved')
  })
})

// ── DELETE /proposals/:id ─────────────────────────────────────────────────────

describe('DELETE /proposals/:id', () => {
  test('removes the proposal', async () => {
    const { router, proposalStore } = makeRouter()
    const p = await proposalStore.create({ kind: 'entity', name: 'x', source: 'define x { n: number = 1 }' })

    const { status, json } = await makeRequest(router, 'DELETE', `/proposals/${p.id}`)
    expect(status).toBe(200)
    expect((json as any).deleted).toBe(true)

    const found = await proposalStore.get(p.id)
    expect(found).toBeNull()
  })

  test('returns 404 for unknown proposal id', async () => {
    const { router } = makeRouter()
    const { status } = await makeRequest(router, 'DELETE', '/proposals/no-such-id')
    expect(status).toBe(404)
  })
})
