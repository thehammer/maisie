import { describe, it, expect } from 'bun:test'

// ---------------------------------------------------------------------------
// HTTP server behavioral tests
//
// Uses Hono's app.request() for dispatch — no real network involved.
// A stub QueryService is injected at the boundary.
// ---------------------------------------------------------------------------

import { createHttpApp } from '../../http/server'
import type { QueryService } from '../../tools/query-service'

// ---------------------------------------------------------------------------
// Stub QueryService factory
// ---------------------------------------------------------------------------

const MOCK_SUCCESS = {
  ok: true as const,
  data: { ok: true },
  scope_applied: {},
  generated_at: '2025-01-15T12:00:00.000Z',
}

const MOCK_NOT_FOUND = {
  ok: false as const,
  kind: 'not_found' as const,
  suggestions: [],
}

const MOCK_INVALID_INPUT = {
  ok: false as const,
  kind: 'error' as const,
  code: 'invalid_input',
  message: 'Missing required field',
  retriable: false,
}

const MOCK_CORPUS_NOT_FOUND = {
  ok: false as const,
  kind: 'error' as const,
  code: 'corpus_not_found',
  message: 'Corpus not found',
  retriable: false,
}

const MOCK_INTERNAL_ERROR = {
  ok: false as const,
  kind: 'error' as const,
  code: 'internal_failure',
  message: 'Something went wrong',
  retriable: true,
}

type StubOverrides = Partial<Record<keyof QueryService, (...args: unknown[]) => Promise<unknown>>>

function makeStubQueryService(overrides: StubOverrides = {}): QueryService {
  const defaults: Record<string, () => Promise<unknown>> = {
    corpus_list: async () => MOCK_SUCCESS,
    corpus_overview: async () => MOCK_SUCCESS,
    search: async () => MOCK_SUCCESS,
    entity: async () => MOCK_SUCCESS,
    entity_edges: async () => MOCK_SUCCESS,
    entity_meet: async () => MOCK_SUCCESS,
    read: async () => MOCK_SUCCESS,
    summarize: async () => MOCK_SUCCESS,
    related: async () => MOCK_SUCCESS,
    // health helper — returns corpus count
    corpusCount: async () => 1,
  }
  return { ...defaults, ...overrides } as unknown as QueryService
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getJson(app: ReturnType<typeof createHttpApp>, path: string): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path)
  const body = await res.json()
  return { status: res.status, body }
}

async function postJson(app: ReturnType<typeof createHttpApp>, path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json()
  return { status: res.status, body }
}

// ---------------------------------------------------------------------------
// Health endpoint
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns 200 with ok:true', async () => {
    const app = createHttpApp(makeStubQueryService())
    const { status, body } = await getJson(app, '/health')
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
  })

  it('includes version in the health response', async () => {
    const app = createHttpApp(makeStubQueryService())
    const { body } = await getJson(app, '/health')
    expect((body as Record<string, unknown>).version).toBeDefined()
  })

  it('includes corpora count in the health response', async () => {
    const app = createHttpApp(makeStubQueryService())
    const { body } = await getJson(app, '/health')
    expect(typeof (body as Record<string, unknown>).corpora).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// Happy-path: each endpoint returns 200 with Success body
// ---------------------------------------------------------------------------

describe('GET /v1/corpora', () => {
  it('returns 200 with Success body', async () => {
    const app = createHttpApp(makeStubQueryService())
    const { status, body } = await getJson(app, '/v1/corpora')
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
  })
})

describe('GET /v1/corpora/:id/overview', () => {
  it('returns 200 with Success body', async () => {
    const app = createHttpApp(makeStubQueryService())
    const { status, body } = await getJson(app, '/v1/corpora/eisenhorn/overview')
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
  })
})

describe('POST /v1/corpora/:id/search', () => {
  it('returns 200 for a valid search request', async () => {
    const app = createHttpApp(makeStubQueryService())
    const { status, body } = await postJson(app, '/v1/corpora/eisenhorn/search', { query: 'Eisenhorn', mode: 'hybrid' })
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
  })
})

describe('GET /v1/corpora/:id/entities/:entityId', () => {
  it('returns 200 with Success body', async () => {
    const app = createHttpApp(makeStubQueryService())
    const { status, body } = await getJson(app, '/v1/corpora/eisenhorn/entities/ent-eisenhorn')
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
  })
})

describe('POST /v1/corpora/:id/entities/:entityId/edges', () => {
  it('returns 200 with Success body', async () => {
    const app = createHttpApp(makeStubQueryService())
    const { status, body } = await postJson(app, '/v1/corpora/eisenhorn/entities/ent-eisenhorn/edges', { direction: 'outbound' })
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
  })
})

describe('POST /v1/corpora/:id/entities/meet', () => {
  it('returns 200 with Success body', async () => {
    const app = createHttpApp(makeStubQueryService())
    const { status, body } = await postJson(app, '/v1/corpora/eisenhorn/entities/meet', {
      entity_a: 'ent-eisenhorn',
      entity_b: 'ent-bequin',
    })
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
  })
})

describe('POST /v1/corpora/:id/read', () => {
  it('returns 200 with Success body', async () => {
    const app = createHttpApp(makeStubQueryService())
    const { status, body } = await postJson(app, '/v1/corpora/eisenhorn/read', {
      location: 'calli://eisenhorn/ch/1/sc/1',
      depth: 'full',
    })
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
  })
})

describe('POST /v1/corpora/:id/summarize', () => {
  it('returns 200 with Success body', async () => {
    const app = createHttpApp(makeStubQueryService())
    const { status, body } = await postJson(app, '/v1/corpora/eisenhorn/summarize', {
      target: { kind: 'corpus' },
    })
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
  })
})

describe('POST /v1/corpora/:id/related', () => {
  it('returns 200 with Success body', async () => {
    const app = createHttpApp(makeStubQueryService())
    const { status, body } = await postJson(app, '/v1/corpora/eisenhorn/related', {
      location: 'calli://eisenhorn/ch/1/sc/1',
    })
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Error mapping: service result → HTTP status code
// ---------------------------------------------------------------------------

describe('HTTP error mapping', () => {
  it('maps NotFound service result to HTTP 404', async () => {
    const app = createHttpApp(makeStubQueryService({
      corpus_overview: async () => MOCK_NOT_FOUND,
    } as StubOverrides))
    const { status } = await getJson(app, '/v1/corpora/eisenhorn/overview')
    expect(status).toBe(404)
  })

  it('maps ErrorResult with code invalid_input to HTTP 400', async () => {
    const app = createHttpApp(makeStubQueryService({
      search: async () => MOCK_INVALID_INPUT,
    } as StubOverrides))
    const { status } = await postJson(app, '/v1/corpora/eisenhorn/search', {})
    expect(status).toBe(400)
  })

  it('maps ErrorResult with code corpus_not_found to HTTP 400', async () => {
    const app = createHttpApp(makeStubQueryService({
      search: async () => MOCK_CORPUS_NOT_FOUND,
    } as StubOverrides))
    const { status } = await postJson(app, '/v1/corpora/eisenhorn/search', { query: 'x' })
    expect(status).toBe(400)
  })

  it('maps ErrorResult with an unrecognized code to HTTP 500', async () => {
    const app = createHttpApp(makeStubQueryService({
      read: async () => MOCK_INTERNAL_ERROR,
    } as StubOverrides))
    const { status } = await postJson(app, '/v1/corpora/eisenhorn/read', { location: 'calli://eisenhorn/ch/1', depth: 'full' })
    expect(status).toBe(500)
  })

  it('response body always contains the raw ToolResult on error', async () => {
    const app = createHttpApp(makeStubQueryService({
      entity: async () => MOCK_NOT_FOUND,
    } as StubOverrides))
    const { status, body } = await getJson(app, '/v1/corpora/eisenhorn/entities/ent-missing')
    expect(status).toBe(404)
    expect((body as { ok: boolean }).ok).toBe(false)
    expect((body as { kind: string }).kind).toBe('not_found')
  })
})
