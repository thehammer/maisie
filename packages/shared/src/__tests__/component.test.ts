import { describe, it, expect } from 'bun:test'
import { validateComponentDef, type ComponentDef } from '../component'

describe('validateComponentDef', () => {
  it('accepts a valid base component', () => {
    const def: ComponentDef = {
      name: 'text',
      kind: 'base',
      input: { kind: 'scalar', type: 'string' },
    }
    expect(validateComponentDef(def)).toEqual([])
  })

  it('accepts a valid layout component', () => {
    const def: ComponentDef = {
      name: 'stack',
      kind: 'layout',
      props: {
        gap: { type: { kind: 'scalar', type: 'number' }, default: 8 },
      },
    }
    expect(validateComponentDef(def)).toEqual([])
  })

  it('accepts a valid derived component', () => {
    const def: ComponentDef = {
      name: 'MovieTile',
      kind: 'derived',
      input: { kind: 'record', fields: { title: { kind: 'scalar', type: 'string' } } },
      render: { kind: 'literal', value: null },
    }
    expect(validateComponentDef(def)).toEqual([])
  })

  it('rejects an invalid kind', () => {
    const def = {
      name: 'bad',
      kind: 'widget' as ComponentDef['kind'],
    }
    const errors = validateComponentDef(def)
    expect(errors.some((e) => e.includes('invalid component kind'))).toBe(true)
  })

  it('rejects a derived component without a render expression', () => {
    const def: ComponentDef = {
      name: 'NoRender',
      kind: 'derived',
    }
    const errors = validateComponentDef(def)
    expect(errors.some((e) => e.includes('derived components must have a render expression'))).toBe(true)
  })

  it('rejects a non-derived component with a render expression', () => {
    const def: ComponentDef = {
      name: 'base_with_render',
      kind: 'base',
      input: { kind: 'scalar', type: 'string' },
      render: { kind: 'literal', value: null },
    }
    const errors = validateComponentDef(def)
    expect(errors.some((e) => e.includes('only derived components have render expressions'))).toBe(true)
  })

  it('rejects an empty component name', () => {
    const def: ComponentDef = {
      name: '',
      kind: 'base',
    }
    const errors = validateComponentDef(def)
    expect(errors.some((e) => e.includes('component name is required'))).toBe(true)
  })

  it('rejects an invalid component name', () => {
    const def: ComponentDef = {
      name: '123bad-name!',
      kind: 'base',
    }
    const errors = validateComponentDef(def)
    expect(errors.some((e) => e.includes('invalid component name'))).toBe(true)
  })

  it('accepts dotted and underscore names', () => {
    const cases = ['my_component', 'plugin.TextTile', 'A.B.C']
    for (const name of cases) {
      const def: ComponentDef = { name, kind: 'base' }
      expect(validateComponentDef(def)).toEqual([])
    }
  })

  it('rejects a prop with both required and a default', () => {
    const def: ComponentDef = {
      name: 'BadProps',
      kind: 'base',
      input: { kind: 'scalar', type: 'string' },
      props: {
        label: {
          type: { kind: 'scalar', type: 'string' },
          required: true,
          default: 'fallback',
        },
      },
    }
    const errors = validateComponentDef(def)
    expect(errors.some((e) => e.includes('"label"') && e.includes('required') && e.includes('default'))).toBe(true)
  })

  it('passes a prop that is required without a default', () => {
    const def: ComponentDef = {
      name: 'GoodRequired',
      kind: 'base',
      input: { kind: 'scalar', type: 'string' },
      props: {
        label: {
          type: { kind: 'scalar', type: 'string' },
          required: true,
        },
      },
    }
    expect(validateComponentDef(def)).toEqual([])
  })

  it('passes a prop that has a default but is not required', () => {
    const def: ComponentDef = {
      name: 'GoodDefault',
      kind: 'base',
      input: { kind: 'scalar', type: 'string' },
      props: {
        label: {
          type: { kind: 'scalar', type: 'string' },
          default: 'fallback',
        },
      },
    }
    expect(validateComponentDef(def)).toEqual([])
  })
})
