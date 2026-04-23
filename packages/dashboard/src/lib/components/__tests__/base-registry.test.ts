import { describe, it, expect } from 'bun:test'
import { BASE_COMPONENTS, getBaseComponent, listBaseComponents } from '../base-registry'
import { validateComponentDef } from '@maisie/shared'

describe('BASE_COMPONENTS', () => {
  it('has entries', () => {
    expect(Object.keys(BASE_COMPONENTS).length).toBeGreaterThan(0)
  })

  for (const [name, def] of Object.entries(BASE_COMPONENTS)) {
    describe(`${name}`, () => {
      it('has kind === "base"', () => {
        expect(def.kind).toBe('base')
      })

      it('passes validateComponentDef', () => {
        const errors = validateComponentDef(def)
        expect(errors).toEqual([])
      })

      it('has an input field', () => {
        expect(def.input).toBeDefined()
      })

      it('name matches registry key', () => {
        expect(def.name).toBe(name)
      })
    })
  }
})

describe('getBaseComponent', () => {
  it('returns a component by name', () => {
    const def = getBaseComponent('text')
    expect(def).toBeDefined()
    expect(def?.name).toBe('text')
  })

  it('returns undefined for unknown names', () => {
    expect(getBaseComponent('nonexistent')).toBeUndefined()
  })
})

describe('listBaseComponents', () => {
  it('returns all base components as an array', () => {
    const list = listBaseComponents()
    expect(list.length).toBe(Object.keys(BASE_COMPONENTS).length)
    for (const def of list) {
      expect(def.kind).toBe('base')
    }
  })
})
