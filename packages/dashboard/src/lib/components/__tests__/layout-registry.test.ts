import { describe, it, expect } from 'bun:test'
import { LAYOUT_PRIMITIVES, getLayoutPrimitive, listLayoutPrimitives, isLayoutPrimitive } from '../layout-registry'
import { validateComponentDef } from '@maisie/shared'

describe('LAYOUT_PRIMITIVES', () => {
  it('has entries', () => {
    expect(Object.keys(LAYOUT_PRIMITIVES).length).toBeGreaterThan(0)
  })

  for (const [name, def] of Object.entries(LAYOUT_PRIMITIVES)) {
    describe(`${name}`, () => {
      it('has kind === "layout"', () => {
        expect(def.kind).toBe('layout')
      })

      it('passes validateComponentDef', () => {
        const errors = validateComponentDef(def)
        expect(errors).toEqual([])
      })

      it('has a children prop (except spacer, which is a leaf)', () => {
        if (name === 'spacer') return
        expect(def.props).toBeDefined()
        expect(def.props!['children']).toBeDefined()
      })

      it('has no input field (layouts render children, not data)', () => {
        expect(def.input).toBeUndefined()
      })

      it('name matches registry key', () => {
        expect(def.name).toBe(name)
      })
    })
  }
})

describe('getLayoutPrimitive', () => {
  it('returns a layout primitive by name', () => {
    const def = getLayoutPrimitive('stack')
    expect(def).toBeDefined()
    expect(def?.name).toBe('stack')
    expect(def?.kind).toBe('layout')
  })

  it('returns undefined for unknown names', () => {
    expect(getLayoutPrimitive('nonexistent')).toBeUndefined()
  })
})

describe('listLayoutPrimitives', () => {
  it('returns all layout primitives as an array', () => {
    const list = listLayoutPrimitives()
    expect(list.length).toBe(Object.keys(LAYOUT_PRIMITIVES).length)
    for (const def of list) {
      expect(def.kind).toBe('layout')
    }
  })
})

describe('isLayoutPrimitive', () => {
  it('returns true for known layout names', () => {
    for (const name of Object.keys(LAYOUT_PRIMITIVES)) {
      expect(isLayoutPrimitive(name)).toBe(true)
    }
  })

  it('returns false for unknown names', () => {
    expect(isLayoutPrimitive('text')).toBe(false)
    expect(isLayoutPrimitive('nonexistent')).toBe(false)
  })
})
