import { describe, it, expect } from 'bun:test'
import { matchScope } from '../../tools/scope-filter'
import type { Scope } from '../../types/scope'

// ---------------------------------------------------------------------------
// matchScope(locationUri, scope) — pure predicate
// ---------------------------------------------------------------------------

describe('matchScope — empty / undefined scope', () => {
  it('returns true for any URI when scope is undefined', () => {
    expect(matchScope('calli://eisenhorn/ch/1/sc/1', undefined)).toBe(true)
    expect(matchScope('calli://eisenhorn/ch/2/sc/3', undefined)).toBe(true)
  })

  it('returns true for any URI when scope has no include or exclude', () => {
    const scope: Scope = {}
    expect(matchScope('calli://eisenhorn/ch/1/sc/1', scope)).toBe(true)
  })

  it('returns true when scope only contains position (no include/exclude)', () => {
    const scope: Scope = {
      position: {
        corpus_id: 'eisenhorn',
        path: 'ch/1/sc/1',
        uri: 'calli://eisenhorn/ch/1/sc/1',
      },
    }
    expect(matchScope('calli://eisenhorn/ch/2/sc/3', scope)).toBe(true)
  })
})

describe('matchScope — include patterns', () => {
  it('matches a URI that satisfies an include glob', () => {
    const scope: Scope = { include: ['ch/1/**'] }
    expect(matchScope('calli://eisenhorn/ch/1/sc/1', scope)).toBe(true)
    expect(matchScope('calli://eisenhorn/ch/1/sc/2', scope)).toBe(true)
    expect(matchScope('calli://eisenhorn/ch/1/sc/3', scope)).toBe(true)
  })

  it('rejects a URI that does not satisfy any include glob', () => {
    const scope: Scope = { include: ['ch/1/**'] }
    expect(matchScope('calli://eisenhorn/ch/2/sc/1', scope)).toBe(false)
    expect(matchScope('calli://eisenhorn/ch/2/sc/2', scope)).toBe(false)
  })

  it('returns true when URI matches any one of multiple include patterns', () => {
    const scope: Scope = { include: ['ch/1/sc/1', 'ch/2/sc/3'] }
    expect(matchScope('calli://eisenhorn/ch/1/sc/1', scope)).toBe(true)
    expect(matchScope('calli://eisenhorn/ch/2/sc/3', scope)).toBe(true)
    expect(matchScope('calli://eisenhorn/ch/1/sc/2', scope)).toBe(false)
  })
})

describe('matchScope — exclude patterns', () => {
  it('rejects a URI that matches an exclude glob', () => {
    const scope: Scope = { exclude: ['ch/2/**'] }
    expect(matchScope('calli://eisenhorn/ch/2/sc/1', scope)).toBe(false)
    expect(matchScope('calli://eisenhorn/ch/2/sc/2', scope)).toBe(false)
  })

  it('allows a URI that does not match any exclude glob', () => {
    const scope: Scope = { exclude: ['ch/2/**'] }
    expect(matchScope('calli://eisenhorn/ch/1/sc/1', scope)).toBe(true)
    expect(matchScope('calli://eisenhorn/ch/1/sc/3', scope)).toBe(true)
  })
})

describe('matchScope — include + exclude interaction', () => {
  it('exclude wins when both include and exclude match the same URI', () => {
    const scope: Scope = {
      include: ['ch/1/**'],
      exclude: ['ch/1/sc/2'],
    }
    // Matches include but also matches exclude → excluded
    expect(matchScope('calli://eisenhorn/ch/1/sc/2', scope)).toBe(false)
    // Matches include and NOT excluded → allowed
    expect(matchScope('calli://eisenhorn/ch/1/sc/1', scope)).toBe(true)
  })

  it('rejects URI that only matches exclude (not include)', () => {
    const scope: Scope = {
      include: ['ch/1/**'],
      exclude: ['ch/2/**'],
    }
    expect(matchScope('calli://eisenhorn/ch/2/sc/1', scope)).toBe(false)
  })
})

describe('matchScope — glob character semantics', () => {
  it('? matches a single non-separator character', () => {
    const scope: Scope = { include: ['ch/?/sc/1'] }
    expect(matchScope('calli://eisenhorn/ch/1/sc/1', scope)).toBe(true)
    expect(matchScope('calli://eisenhorn/ch/2/sc/1', scope)).toBe(true)
  })

  it('* does not match path separators (does not cross / boundaries)', () => {
    // 'ch/*' should match 'ch/1' but not 'ch/1/sc/1'
    const scope: Scope = { include: ['ch/*'] }
    expect(matchScope('calli://eisenhorn/ch/1', scope)).toBe(true)
    expect(matchScope('calli://eisenhorn/ch/1/sc/1', scope)).toBe(false)
  })

  it('** matches across path separators', () => {
    const scope: Scope = { include: ['ch/**'] }
    expect(matchScope('calli://eisenhorn/ch/1', scope)).toBe(true)
    expect(matchScope('calli://eisenhorn/ch/1/sc/1', scope)).toBe(true)
    expect(matchScope('calli://eisenhorn/ch/2/sc/3', scope)).toBe(true)
  })
})
