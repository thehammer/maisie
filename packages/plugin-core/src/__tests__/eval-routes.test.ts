/**
 * Tests for the eval-routes HTTP handlers.
 *
 * Covers POST /eval/validate: valid source, invalid source, empty source.
 */

import { describe, it, expect } from 'bun:test'
import { createEvalRouter } from '../eval-routes'

// The validate endpoint only parses — no action context needed.
const router = createEvalRouter({})

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const req = new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const res = await router.fetch(req)
  const json = await res.json()
  return { status: res.status, json }
}

// ── POST /eval/validate ───────────────────────────────────────────────────────

describe('POST /eval/validate', () => {
  it('returns valid:true for a syntactically correct expression', async () => {
    const { status, json } = await post('/eval/validate', { source: '1 + 2' })
    expect(status).toBe(200)
    expect((json as { valid: boolean }).valid).toBe(true)
    expect((json as { errors: unknown[] }).errors).toHaveLength(0)
  })

  it('returns valid:true for a well-formed define block', async () => {
    const source = `define exterior-lights {
  description: "test"
  switches: collection = home-assistant.list_switches | filter: (sw) => sw.name contains "ext"
}`
    const { status, json } = await post('/eval/validate', { source })
    expect(status).toBe(200)
    expect((json as { valid: boolean }).valid).toBe(true)
  })

  it('returns valid:false with an error for invalid syntax', async () => {
    const { status, json } = await post('/eval/validate', { source: 'let x = @@@' })
    expect(status).toBe(200)
    const result = json as { valid: boolean; errors: { line: number; col: number; message: string }[] }
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].message).toBeTruthy()
  })

  it('reports a non-zero position for errors after the first line', async () => {
    const source = '# comment\n@@@'
    const { status, json } = await post('/eval/validate', { source })
    expect(status).toBe(200)
    const result = json as { valid: boolean; errors: { line: number; col: number; message: string }[] }
    expect(result.valid).toBe(false)
    // Error should be on line 2, not line 1
    expect(result.errors[0].line).toBe(2)
  })

  it('returns valid:false for empty source', async () => {
    const { status, json } = await post('/eval/validate', { source: '' })
    expect(status).toBe(200)
    expect((json as { valid: boolean }).valid).toBe(false)
    expect((json as { errors: unknown[] }).errors.length).toBeGreaterThan(0)
  })

  it('returns valid:false for whitespace-only source', async () => {
    const { status, json } = await post('/eval/validate', { source: '   \n  ' })
    expect(status).toBe(200)
    expect((json as { valid: boolean }).valid).toBe(false)
  })

  it('handles missing source field gracefully', async () => {
    const { status, json } = await post('/eval/validate', {})
    expect(status).toBe(200)
    expect((json as { valid: boolean }).valid).toBe(false)
  })
})
