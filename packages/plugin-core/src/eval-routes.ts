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
import { parse, evalExprAsync, ParseError } from '@maisie/shared'
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

      // If source defines an entity, preview it by evaluating each data field
      // in declaration order. Each resolved field is added to a `self` record
      // so later fields can reference it (e.g., `total: self.items | count`).
      // Function fields are shown as placeholders — they're not invokable
      // from an unsaved preview. Save via POST /api/entities to get a real
      // function field with cycle detection and tier inference.
      if ('kind' in parsed && parsed.kind === 'entity') {
        const preview: Record<string, unknown> = {}
        const selfRecord: Record<string, unknown> = {}
        for (const field of parsed.fields) {
          if (field.kind === 'data' && field.expression) {
            try {
              const value = await evalExprAsync(
                field.expression,
                resolver,
                { self: selfRecord as never },
              )
              preview[field.name] = value
              selfRecord[field.name] = value
            } catch (err) {
              preview[field.name] = `<error: ${err instanceof Error ? err.message : String(err)}>`
            }
          } else if (field.kind === 'function') {
            const paramList = field.params.map((p) => p.name).join(', ')
            preview[field.name] = `<function(${paramList})>`
            // Provide a placeholder in self so function-field references don't
            // crash the preview. Calling it returns an error string.
            selfRecord[field.name] = (() =>
              `<function "${field.name}" — save the entity to invoke>`) as never
          }
        }
        return c.json({
          value: preview,
          type: `entity "${parsed.name}"`,
        })
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

  // ── POST /eval/validate ────────────────────────────────────────────────────
  // Parse-only — no evaluation. Returns { valid, errors[] } for inline linting.
  router.post('/eval/validate', async (c) => {
    let body: { source?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ valid: false, errors: [{ line: 0, col: 0, message: 'invalid JSON body' }] })
    }

    if (!body.source || body.source.trim().length === 0) {
      return c.json({ valid: false, errors: [{ line: 0, col: 0, message: 'empty source' }] })
    }

    try {
      parse(body.source)
      return c.json({ valid: true, errors: [] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // ParseError carries a character-offset `pos` — convert to 1-based line/col.
      if (err instanceof ParseError) {
        const { line, col } = posToLineCol(body.source, err.pos)
        return c.json({ valid: false, errors: [{ line, col, message: msg }] })
      }
      // Unknown error shape — report at position 0 (start of document)
      return c.json({ valid: false, errors: [{ line: 1, col: 1, message: msg }] })
    }
  })

  return router
}

/** Convert a 0-based character offset to 1-based line/col. */
function posToLineCol(src: string, pos: number): { line: number; col: number } {
  let line = 1
  let col = 1
  const end = Math.min(pos, src.length)
  for (let i = 0; i < end; i++) {
    if (src[i] === '\n') {
      line++
      col = 1
    } else {
      col++
    }
  }
  return { line, col }
}

function describeValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return `collection<${v.length}>`
  if (typeof v === 'function') return 'function'
  if (typeof v === 'object') return 'record'
  return typeof v
}
