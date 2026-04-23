/**
 * Tests for the proposal store.
 *
 * Uses an in-memory SQLite database to test create/list/get/approve/reject/delete
 * without touching the real database.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { createProposalStore } from '../proposal-store'
import * as schema from '../schema'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE proposals (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      reasoning TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
  `)
  return drizzle(sqlite, { schema })
}

describe('ProposalStore', () => {
  let store: ReturnType<typeof createProposalStore>

  beforeEach(() => {
    store = createProposalStore(makeDb())
  })

  test('create returns a proposal with id, status pending, and correct fields', async () => {
    const proposal = await store.create({
      kind: 'entity',
      name: 'unwatched-movies',
      source: 'define unwatched-movies { count: number = 42 }',
      reasoning: 'You mentioned wanting to track unwatched films',
    })

    expect(proposal.id).toBeString()
    expect(proposal.id.length).toBeGreaterThan(0)
    expect(proposal.kind).toBe('entity')
    expect(proposal.name).toBe('unwatched-movies')
    expect(proposal.source).toBe('define unwatched-movies { count: number = 42 }')
    expect(proposal.reasoning).toBe('You mentioned wanting to track unwatched films')
    expect(proposal.status).toBe('pending')
    expect(proposal.createdAt).toBeInstanceOf(Date)
    expect(proposal.resolvedAt).toBeUndefined()
  })

  test('create without reasoning omits the field', async () => {
    const proposal = await store.create({
      kind: 'component',
      name: 'MovieCard',
      source: 'define MovieCard { render: text(value: title) }',
    })

    expect(proposal.reasoning).toBeUndefined()
  })

  test('list returns all proposals when no filter given', async () => {
    await store.create({ kind: 'entity', name: 'a', source: 'define a { x: number = 1 }' })
    await store.create({ kind: 'component', name: 'B', source: 'define B { render: text(value: x) }' })

    const all = await store.list()
    expect(all.length).toBe(2)
  })

  test('list filters by status=pending', async () => {
    const p1 = await store.create({ kind: 'entity', name: 'a', source: 'define a { x: number = 1 }' })
    const p2 = await store.create({ kind: 'entity', name: 'b', source: 'define b { x: number = 2 }' })

    await store.markApproved(p1.id)

    const pending = await store.list({ status: 'pending' })
    expect(pending.length).toBe(1)
    expect(pending[0].id).toBe(p2.id)
  })

  test('list filters by status=approved', async () => {
    const p1 = await store.create({ kind: 'entity', name: 'a', source: 'define a { x: number = 1 }' })
    await store.create({ kind: 'entity', name: 'b', source: 'define b { x: number = 2 }' })

    await store.markApproved(p1.id)

    const approved = await store.list({ status: 'approved' })
    expect(approved.length).toBe(1)
    expect(approved[0].id).toBe(p1.id)
    expect(approved[0].status).toBe('approved')
  })

  test('list filters by status=rejected', async () => {
    const p1 = await store.create({ kind: 'entity', name: 'a', source: 'define a { x: number = 1 }' })
    await store.create({ kind: 'entity', name: 'b', source: 'define b { x: number = 2 }' })

    await store.markRejected(p1.id)

    const rejected = await store.list({ status: 'rejected' })
    expect(rejected.length).toBe(1)
    expect(rejected[0].id).toBe(p1.id)
    expect(rejected[0].status).toBe('rejected')
  })

  test('get returns the proposal by id', async () => {
    const created = await store.create({
      kind: 'entity',
      name: 'my-entity',
      source: 'define my-entity { val: number = 10 }',
    })

    const found = await store.get(created.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
    expect(found!.name).toBe('my-entity')
  })

  test('get returns null for unknown id', async () => {
    const found = await store.get('nonexistent-id')
    expect(found).toBeNull()
  })

  test('markApproved sets status to approved and sets resolvedAt', async () => {
    const p = await store.create({ kind: 'entity', name: 'x', source: 'define x { n: number = 1 }' })

    await store.markApproved(p.id)

    const updated = await store.get(p.id)
    expect(updated!.status).toBe('approved')
    expect(updated!.resolvedAt).toBeInstanceOf(Date)
  })

  test('markRejected sets status to rejected and sets resolvedAt', async () => {
    const p = await store.create({ kind: 'entity', name: 'y', source: 'define y { n: number = 1 }' })

    await store.markRejected(p.id)

    const updated = await store.get(p.id)
    expect(updated!.status).toBe('rejected')
    expect(updated!.resolvedAt).toBeInstanceOf(Date)
  })

  test('delete removes the proposal', async () => {
    const p = await store.create({ kind: 'entity', name: 'z', source: 'define z { n: number = 1 }' })

    await store.delete(p.id)

    const found = await store.get(p.id)
    expect(found).toBeNull()
  })

  test('list returns empty array when no proposals exist', async () => {
    const all = await store.list()
    expect(all).toEqual([])
  })
})
