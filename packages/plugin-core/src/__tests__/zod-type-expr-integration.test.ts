/**
 * Integration test: Phase 3g — Zod → TypeExpr → entity → satisfies
 *
 * Exercises the full chain:
 *   synthesizeEntityFromAction → TypeExpr field type → dataFieldTypeExpr → satisfies
 *
 * Validates that the canvas would see a structurally typed entity instead of the
 * old coarse 'collection' / 'record' strings, and that satisfies() returns ok
 * when matching against a component contract with the same shape.
 */
import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { defineAction, field, satisfies, dataFieldTypeExpr } from '@maisie/shared'
import type { MaisiePlugin, TypeExpr, DataFieldDef } from '@maisie/shared'
import { synthesizeEntityFromAction } from '../entity-registry'

// ── Fixture plugin ────────────────────────────────────────────────────────────

const listRecentlyAddedAction = defineAction({
  name: 'list_recently_added',
  description: 'List recently added items',
  input: z.object({}),
  output: z.array(
    z.object({
      title: z.string(),
      coverUrl: field(z.string(), 'url'),
      addedAt: field(z.number(), 'epoch_ms'),
      year: z.number(),
    }),
  ),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Recently Added', section: 'media' },
  async execute() { return [] },
})

const fakePlugin: MaisiePlugin = {
  name: 'plex',
  version: '1.0.0',
  description: 'Plex plugin',
  capabilities: [],
  envVars: [],
  actions: [listRecentlyAddedAction],
  events: [],
  async init() {},
  async shutdown() {},
  async healthCheck() { return { status: 'healthy', lastCheck: new Date() } },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 3g integration: entity type from Zod schema', () => {
  it('synthesized entity result field has a TypeExpr (not a string)', () => {
    const entity = synthesizeEntityFromAction(fakePlugin, listRecentlyAddedAction)
    expect(entity).not.toBeNull()

    const resultField = entity!.fields.result as DataFieldDef
    expect(resultField.kind).toBe('data')
    // Phase 3g: type is now a TypeExpr object, not the old 'record' string
    expect(typeof resultField.type).toBe('object')
  })

  it('result field TypeExpr is collection<record<...>>', () => {
    const entity = synthesizeEntityFromAction(fakePlugin, listRecentlyAddedAction)
    const resultField = entity!.fields.result as DataFieldDef
    const typeExpr = resultField.type as TypeExpr

    expect(typeExpr.kind).toBe('collection')
    if (typeExpr.kind !== 'collection') return

    expect(typeExpr.element.kind).toBe('record')
    if (typeExpr.element.kind !== 'record') return

    const fields = typeExpr.element.fields
    expect(fields.title).toEqual({ kind: 'scalar', type: 'string' })
    expect(fields.coverUrl).toEqual({ kind: 'scalar', type: 'url' })
    expect(fields.addedAt).toEqual({ kind: 'scalar', type: 'epoch_ms' })
    expect(fields.year).toEqual({ kind: 'scalar', type: 'number' })
  })

  it('dataFieldTypeExpr passes TypeExpr through unchanged', () => {
    const entity = synthesizeEntityFromAction(fakePlugin, listRecentlyAddedAction)
    const resultField = entity!.fields.result as DataFieldDef
    const direct = resultField.type as TypeExpr
    const viaHelper = dataFieldTypeExpr(resultField.type)
    expect(viaHelper).toEqual(direct)
  })

  it('satisfies returns ok when entity output matches component input contract', () => {
    const entity = synthesizeEntityFromAction(fakePlugin, listRecentlyAddedAction)
    const resultField = entity!.fields.result as DataFieldDef
    const entityOutputType = dataFieldTypeExpr(resultField.type)

    // Component contract: requires a collection of records with title and coverUrl
    // (fewer fields than the entity provides — structural subtyping allows extras)
    const componentInputContract: TypeExpr = {
      kind: 'collection',
      element: {
        kind: 'record',
        fields: {
          title: { kind: 'scalar', type: 'string' },
          coverUrl: { kind: 'scalar', type: 'url' },
        },
      },
    }

    const result = satisfies(entityOutputType, componentInputContract)
    expect(result.ok).toBe(true)
  })

  it('satisfies returns error when entity output does not match a stricter contract', () => {
    const entity = synthesizeEntityFromAction(fakePlugin, listRecentlyAddedAction)
    const resultField = entity!.fields.result as DataFieldDef
    const entityOutputType = dataFieldTypeExpr(resultField.type)

    // Contract requires a field that the entity does not provide
    const strictContract: TypeExpr = {
      kind: 'collection',
      element: {
        kind: 'record',
        fields: {
          title: { kind: 'scalar', type: 'string' },
          rating: { kind: 'scalar', type: 'number' },  // not in entity output
        },
      },
    }

    const result = satisfies(entityOutputType, strictContract)
    expect(result.ok).toBe(false)
  })

  it('dataFieldTypeExpr handles legacy string type "collection"', () => {
    const t = dataFieldTypeExpr('collection')
    expect(t).toEqual({ kind: 'collection', element: { kind: 'any' } })
  })

  it('dataFieldTypeExpr handles legacy string type "record"', () => {
    const t = dataFieldTypeExpr('record')
    expect(t).toEqual({ kind: 'record', fields: {} })
  })

  it('dataFieldTypeExpr handles legacy scalar string type', () => {
    const t = dataFieldTypeExpr('string')
    expect(t).toEqual({ kind: 'scalar', type: 'string' })
  })
})
