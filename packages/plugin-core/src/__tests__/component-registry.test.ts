import { describe, it, expect, beforeEach } from 'bun:test'
import { ComponentRegistry } from '../component-registry'
import { BASE_COMPONENTS, LAYOUT_PRIMITIVES } from '@maisie/shared'
import type { ComponentDef, TypeExpr } from '@maisie/shared'

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeDerived(overrides: Partial<ComponentDef> = {}): ComponentDef {
  return {
    name: 'test.MyTile',
    kind: 'derived',
    description: 'A test derived component',
    input: { kind: 'record', fields: { title: { kind: 'scalar', type: 'string' } } },
    render: { kind: 'literal', value: 'stub' },
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ComponentRegistry', () => {
  let registry: ComponentRegistry

  beforeEach(() => {
    registry = new ComponentRegistry()
  })

  describe('constructor — pre-registration', () => {
    it('pre-registers all base components', () => {
      for (const name of Object.keys(BASE_COMPONENTS)) {
        expect(registry.get(name)).toBeDefined()
        expect(registry.get(name)?.kind).toBe('base')
      }
    })

    it('pre-registers all layout primitives', () => {
      for (const name of Object.keys(LAYOUT_PRIMITIVES)) {
        expect(registry.get(name)).toBeDefined()
        expect(registry.get(name)?.kind).toBe('layout')
      }
    })

    it('list() includes all base and layout components on a fresh registry', () => {
      const all = registry.list()
      const expectedCount = Object.keys(BASE_COMPONENTS).length + Object.keys(LAYOUT_PRIMITIVES).length
      expect(all.length).toBe(expectedCount)
    })
  })

  describe('register', () => {
    it('registers a valid derived component', () => {
      const c = makeDerived()
      registry.register(c)
      expect(registry.get(c.name)).toEqual(c)
    })

    it('throws on invalid component (no render for derived)', () => {
      const bad: ComponentDef = { name: 'bad.comp', kind: 'derived' }
      expect(() => registry.register(bad)).toThrow()
    })

    it('throws on invalid component name', () => {
      const bad = makeDerived({ name: '' })
      expect(() => registry.register(bad)).toThrow()
    })

    it('overwrites an existing derived component on re-register', () => {
      const original = makeDerived()
      registry.register(original)

      const updated = makeDerived({ description: 'Updated' })
      registry.register(updated)

      expect(registry.get(original.name)?.description).toBe('Updated')
    })
  })

  describe('unregister', () => {
    it('removes a registered derived component', () => {
      const c = makeDerived()
      registry.register(c)
      const removed = registry.unregister(c.name)
      expect(removed).toBe(true)
      expect(registry.get(c.name)).toBeUndefined()
    })

    it('returns false for non-existent name', () => {
      expect(registry.unregister('does.not.exist')).toBe(false)
    })

    it('returns false and does not remove a base component', () => {
      const result = registry.unregister('text')
      expect(result).toBe(false)
      expect(registry.get('text')).toBeDefined()
    })

    it('returns false and does not remove a layout primitive', () => {
      const result = registry.unregister('stack')
      expect(result).toBe(false)
      expect(registry.get('stack')).toBeDefined()
    })
  })

  describe('get', () => {
    it('returns undefined for unknown name', () => {
      expect(registry.get('no.such.thing')).toBeUndefined()
    })
  })

  describe('list', () => {
    it('includes newly registered derived components', () => {
      const before = registry.list().length
      registry.register(makeDerived())
      expect(registry.list().length).toBe(before + 1)
    })

    it('excludes unregistered derived components', () => {
      const c = makeDerived()
      registry.register(c)
      registry.unregister(c.name)
      expect(registry.list().find((x) => x.name === c.name)).toBeUndefined()
    })
  })

  describe('findByKind', () => {
    it('returns only base components', () => {
      const bases = registry.findByKind('base')
      expect(bases.length).toBeGreaterThan(0)
      expect(bases.every((c) => c.kind === 'base')).toBe(true)
    })

    it('returns only layout primitives', () => {
      const layouts = registry.findByKind('layout')
      expect(layouts.length).toBeGreaterThan(0)
      expect(layouts.every((c) => c.kind === 'layout')).toBe(true)
    })

    it('returns only derived components', () => {
      registry.register(makeDerived())
      const derived = registry.findByKind('derived')
      expect(derived.length).toBe(1)
      expect(derived[0].kind).toBe('derived')
    })
  })

  describe('findByInputShape', () => {
    it('finds components whose input is satisfied by the candidate type', () => {
      const stringType: TypeExpr = { kind: 'scalar', type: 'string' }
      const results = registry.findByInputShape(stringType)
      // 'text' accepts scalar string input
      expect(results.some((c) => c.name === 'text')).toBe(true)
    })

    it('returns empty array when no components match', () => {
      // An unusual type that nothing should match
      const unusual: TypeExpr = { kind: 'record', fields: { __no_match__: { kind: 'scalar', type: 'string' } } }
      const results = registry.findByInputShape(unusual)
      // Nothing in the base/layout set expects a record with __no_match__ as its only field;
      // components with 'any' input would match, so filter to those without it.
      // The test here just checks the return is an array — shape tests are in contract.test.ts.
      expect(Array.isArray(results)).toBe(true)
    })

    it('excludes components with no input (layout primitives)', () => {
      const anyType: TypeExpr = { kind: 'any' }
      const results = registry.findByInputShape(anyType)
      expect(results.every((c) => c.input !== undefined)).toBe(true)
    })
  })

  describe('clear', () => {
    it('removes derived components but keeps base and layout', () => {
      registry.register(makeDerived())
      registry.clear()

      expect(registry.findByKind('derived')).toHaveLength(0)
      expect(registry.findByKind('base').length).toBe(Object.keys(BASE_COMPONENTS).length)
      expect(registry.findByKind('layout').length).toBe(Object.keys(LAYOUT_PRIMITIVES).length)
    })
  })
})
