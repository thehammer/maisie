import { describe, it, expect } from 'bun:test'
import { validateViewDef } from '../view'
import type { ViewDef } from '../view'

function makeView(overrides: Partial<ViewDef> = {}): ViewDef {
  return {
    name: 'recent-movies-strip',
    source: { entity: 'plex.list_recently_added', field: 'result' },
    chain: [],
    component: 'Strip',
    ...overrides,
  }
}

describe('validateViewDef', () => {
  it('passes a valid view with no chain', () => {
    expect(validateViewDef(makeView())).toEqual([])
  })

  it('passes a valid view with chain steps', () => {
    expect(validateViewDef(makeView({
      chain: [
        { functionId: 'std.limit', params: { n: 5 } },
        { functionId: 'std.sort', params: { field: 'title' } },
      ],
    }))).toEqual([])
  })

  it('passes a view with componentProps', () => {
    expect(validateViewDef(makeView({
      componentProps: { orientation: 'horizontal' },
    }))).toEqual([])
  })

  it('passes a view with no field (optional)', () => {
    expect(validateViewDef(makeView({ source: { entity: 'plex.list_recently_added' } }))).toEqual([])
  })

  it('fails when name is empty', () => {
    const errors = validateViewDef(makeView({ name: '' }))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/name is required/)
  })

  it('fails when name starts with a digit', () => {
    const errors = validateViewDef(makeView({ name: '1invalid' }))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/invalid view name/)
  })

  it('fails when name contains spaces', () => {
    const errors = validateViewDef(makeView({ name: 'my view' }))
    expect(errors.some((e) => e.includes('invalid view name'))).toBe(true)
  })

  it('allows dots and hyphens in names', () => {
    expect(validateViewDef(makeView({ name: 'my.view-thing_1' }))).toEqual([])
  })

  it('fails when source.entity is missing', () => {
    const view = makeView()
    // @ts-expect-error intentionally invalid
    view.source = {}
    const errors = validateViewDef(view)
    expect(errors.some((e) => e.includes('source.entity'))).toBe(true)
  })

  it('fails when source is missing entirely', () => {
    const view = makeView()
    // @ts-expect-error intentionally invalid
    view.source = undefined
    const errors = validateViewDef(view)
    expect(errors.some((e) => e.includes('source.entity'))).toBe(true)
  })

  it('fails when component is empty', () => {
    const errors = validateViewDef(makeView({ component: '' }))
    expect(errors.some((e) => e.includes('component is required'))).toBe(true)
  })

  it('returns multiple errors when multiple fields are invalid', () => {
    const errors = validateViewDef(makeView({ name: '', component: '' }))
    expect(errors.length).toBeGreaterThan(1)
  })
})
