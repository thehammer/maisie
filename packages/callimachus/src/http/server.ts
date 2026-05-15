import { Hono } from 'hono'
import type { QueryService } from '../tools/query-service'
import { version } from '../../package.json'

type ToolResult = { ok: boolean; kind?: string; code?: string }

/**
 * Map a ToolResult to an HTTP status code.
 * - Success (ok: true) → 200
 * - NotFound → 404
 * - ErrorResult with invalid_input or corpus_not_found → 400
 * - Other ErrorResult → 500
 */
function statusFor(result: ToolResult): number {
  if (result.ok) return 200
  if (result.kind === 'not_found') return 404
  if (result.kind === 'error') {
    const code = result.code ?? ''
    if (code === 'invalid_input' || code === 'corpus_not_found') return 400
    return 500
  }
  return 500
}

/**
 * Create the Callimachus HTTP API as a Hono app.
 * All routes delegate to `queryService`.
 */
export function createHttpApp(queryService: QueryService): Hono {
  const app = new Hono()

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  app.get('/health', async (c) => {
    const corpora = await queryService.corpusCount()
    return c.json({ ok: true, version, corpora })
  })

  // -------------------------------------------------------------------------
  // corpus_list
  // -------------------------------------------------------------------------

  app.get('/v1/corpora', async (c) => {
    const result = await queryService.corpus_list({})
    return c.json(result as object, statusFor(result as ToolResult) as any)
  })

  // -------------------------------------------------------------------------
  // corpus_overview
  // -------------------------------------------------------------------------

  app.get('/v1/corpora/:corpus_id/overview', async (c) => {
    const corpus_id = c.req.param('corpus_id')
    const result = await queryService.corpus_overview({ corpus_id })
    return c.json(result as object, statusFor(result as ToolResult) as any)
  })

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------

  app.post('/v1/corpora/:corpus_id/search', async (c) => {
    const corpus_id = c.req.param('corpus_id')
    let body: unknown = {}
    try {
      body = await c.req.json()
    } catch {
      // empty body is valid (will fail Zod validation)
    }
    const result = await queryService.search({ ...(body as object), corpus_id })
    return c.json(result as object, statusFor(result as ToolResult) as any)
  })

  // -------------------------------------------------------------------------
  // entity
  // -------------------------------------------------------------------------

  app.get('/v1/corpora/:corpus_id/entities/:name_or_id', async (c) => {
    const corpus_id = c.req.param('corpus_id')
    const name_or_id = c.req.param('name_or_id')
    const result = await queryService.entity({ corpus_id, name_or_id })
    return c.json(result as object, statusFor(result as ToolResult) as any)
  })

  // -------------------------------------------------------------------------
  // entity_edges
  // -------------------------------------------------------------------------

  app.post('/v1/corpora/:corpus_id/entities/:entity_id/edges', async (c) => {
    const corpus_id = c.req.param('corpus_id')
    const entity_id = c.req.param('entity_id')
    let body: unknown = {}
    try {
      body = await c.req.json()
    } catch {
      // ok
    }
    const result = await queryService.entity_edges({ ...(body as object), corpus_id, entity_id })
    return c.json(result as object, statusFor(result as ToolResult) as any)
  })

  // -------------------------------------------------------------------------
  // entity_meet
  // -------------------------------------------------------------------------

  app.post('/v1/corpora/:corpus_id/entities/meet', async (c) => {
    const corpus_id = c.req.param('corpus_id')
    let body: unknown = {}
    try {
      body = await c.req.json()
    } catch {
      // ok
    }
    const result = await queryService.entity_meet({ ...(body as object), corpus_id })
    return c.json(result as object, statusFor(result as ToolResult) as any)
  })

  // -------------------------------------------------------------------------
  // read
  // -------------------------------------------------------------------------

  app.post('/v1/corpora/:corpus_id/read', async (c) => {
    const corpus_id = c.req.param('corpus_id')
    let body: unknown = {}
    try {
      body = await c.req.json()
    } catch {
      // ok
    }
    const result = await queryService.read({ ...(body as object), corpus_id })
    return c.json(result as object, statusFor(result as ToolResult) as any)
  })

  // -------------------------------------------------------------------------
  // summarize
  // -------------------------------------------------------------------------

  app.post('/v1/corpora/:corpus_id/summarize', async (c) => {
    const corpus_id = c.req.param('corpus_id')
    let body: unknown = {}
    try {
      body = await c.req.json()
    } catch {
      // ok
    }
    const result = await queryService.summarize({ corpus_id, ...(body as object) })
    return c.json(result as object, statusFor(result as ToolResult) as any)
  })

  // -------------------------------------------------------------------------
  // related
  // -------------------------------------------------------------------------

  app.post('/v1/corpora/:corpus_id/related', async (c) => {
    const corpus_id = c.req.param('corpus_id')
    let body: unknown = {}
    try {
      body = await c.req.json()
    } catch {
      // ok
    }
    const result = await queryService.related({ ...(body as object), corpus_id })
    return c.json(result as object, statusFor(result as ToolResult) as any)
  })

  return app
}
