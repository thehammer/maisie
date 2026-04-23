/**
 * Tests for the propose_artifact agent tool.
 *
 * Mocking strategy: ProposalStore is mocked at the boundary (in-memory map).
 * MEL parsing uses the real parser — we want to confirm parse errors are caught.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { createProposalTools } from '../proposal-tools'
import type { ProposalToolDeps } from '../proposal-tools'
import type { ProposalStore, Proposal } from '../../services/proposal-store'

// ── Mock store ────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function execTool(
  tools: ReturnType<typeof createProposalTools>,
  args: Record<string, unknown>,
) {
  const t = tools.propose_artifact as any
  return t.execute(args)
}

function makeDeps(): { deps: ProposalToolDeps; store: ReturnType<typeof makeMockProposalStore> } {
  const store = makeMockProposalStore()
  return { deps: { proposalStore: store }, store }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('propose_artifact', () => {
  test('valid entity MEL creates a pending proposal', async () => {
    const { deps, store } = makeDeps()
    const tools = createProposalTools(deps)

    const result = await execTool(tools, {
      source: 'define unwatched-movies { count: number = 42 }',
      reasoning: 'You asked about unwatched content',
    }) as any

    expect(result.error).toBeUndefined()
    expect(result.id).toBeString()
    expect(result.kind).toBe('entity')
    expect(result.name).toBe('unwatched-movies')
    expect(result.status).toBe('pending')
    expect(result.reasoning).toBe('You asked about unwatched content')
    expect(store._store.size).toBe(1)
  })

  test('valid component MEL creates a pending proposal with kind=component', async () => {
    const { deps, store } = makeDeps()
    const tools = createProposalTools(deps)

    const result = await execTool(tools, {
      source: 'define MovieCard { render: text(value: title) }',
    }) as any

    expect(result.error).toBeUndefined()
    expect(result.kind).toBe('component')
    expect(result.name).toBe('MovieCard')
    expect(result.status).toBe('pending')
    expect(store._store.size).toBe(1)
  })

  test('plain expression (not a define block) returns error without creating proposal', async () => {
    const { deps, store } = makeDeps()
    const tools = createProposalTools(deps)

    const result = await execTool(tools, {
      source: '42',
    }) as any

    expect(result.error).toBeDefined()
    expect(result.error).toContain('define block')
    expect(store._store.size).toBe(0)
  })

  test('invalid MEL syntax returns parse error without creating proposal', async () => {
    const { deps, store } = makeDeps()
    const tools = createProposalTools(deps)

    const result = await execTool(tools, {
      source: 'this is not valid MEL @@##',
    }) as any

    expect(result.error).toBeDefined()
    expect(store._store.size).toBe(0)
  })

  test('optional reasoning is stored when provided', async () => {
    const { deps, store } = makeDeps()
    const tools = createProposalTools(deps)

    await execTool(tools, {
      source: 'define x { n: number = 1 }',
      reasoning: 'Important reason',
    })

    const proposal = [...store._store.values()][0]
    expect(proposal.reasoning).toBe('Important reason')
  })

  test('reasoning is omitted when not provided', async () => {
    const { deps, store } = makeDeps()
    const tools = createProposalTools(deps)

    await execTool(tools, {
      source: 'define x { n: number = 1 }',
    })

    const proposal = [...store._store.values()][0]
    expect(proposal.reasoning).toBeUndefined()
  })
})
