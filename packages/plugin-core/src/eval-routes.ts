/**
 * POST /eval — evaluate a MEL expression or definition.
 *
 * Accepts:
 *   { source: string }      — parse + evaluate MEL source
 *   { expression: ExprNode } — evaluate a pre-parsed ExprNode
 *
 * Returns:
 *   { value: unknown, type: string }  — on success
 *   { error: string }                 — on parse or eval failure (HTTP 400)
 *
 * If the source contains a `define` block (an entity definition), the endpoint
 * returns a 400 with guidance to use POST /api/entities instead.
 */

import { Hono } from 'hono'
import type { ExprNode } from '@maisie/shared'
import { parse, evalExprAsync } from '@maisie/shared'
import { createAddressResolver } from './address-resolver'
import type { ActionContext } from './address-resolver'

export function createEvalRouter(actionContext: ActionContext) {
  const router = new Hono()
  const resolver = createAddressResolver(actionContext)

  router.post('/eval', async (c) => {
    let body: { source?: string; expression?: ExprNode }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }

    let expr: ExprNode

    if (body.source != null) {
      let parsed
      try {
        parsed = parse(body.source)
      } catch (err) {
        return c.json({ error: `parse error: ${err instanceof Error ? err.message : String(err)}` }, 400)
      }

      // If source defines an entity, redirect caller to the entity API.
      if ('kind' in parsed && parsed.kind === 'entity') {
        return c.json(
          {
            error:
              'source defines an entity — use POST /api/entities to save it, not /api/eval',
          },
          400,
        )
      }

      expr = parsed as ExprNode
    } else if (body.expression != null) {
      expr = body.expression
    } else {
      return c.json({ error: 'expected "source" (MEL string) or "expression" (ExprNode JSON)' }, 400)
    }

    let value: unknown
    try {
      value = await evalExprAsync(expr, resolver)
    } catch (err) {
      return c.json({ error: `eval error: ${err instanceof Error ? err.message : String(err)}` }, 400)
    }

    return c.json({ value, type: describeValue(value) })
  })

  return router
}

function describeValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return `collection<${v.length}>`
  if (typeof v === 'function') return 'function'
  if (typeof v === 'object') return 'record'
  return typeof v
}
