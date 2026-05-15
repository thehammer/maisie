import { describe, it, expect } from 'bun:test'
import { extractSnippet } from '../../tools/snippet'

// ---------------------------------------------------------------------------
// extractSnippet(content, query, max?) — pure text windowing function
// ---------------------------------------------------------------------------

const LONG = 'The quick brown fox jumps over the lazy dog. ' +
             'Pack my box with five dozen liquor jugs. ' +
             'How vaguely exciting would the next big jazz album be. ' +
             'The five boxing wizards jump quickly.'

describe('extractSnippet — match at start of content', () => {
  it('returns up to max chars when query appears at the very beginning', () => {
    const result = extractSnippet('Eisenhorn investigates heresy on Gudrun.', 'Eisenhorn', 30)
    expect(result).toContain('Eisenhorn')
    expect(result.length).toBeLessThanOrEqual(30 + 10) // small tolerance for ellipsis
  })

  it('does not add a leading ellipsis when match is near the start', () => {
    const result = extractSnippet('Eisenhorn investigates heresy.', 'Eisenhorn', 50)
    expect(result.startsWith('...')).toBe(false)
  })
})

describe('extractSnippet — match in the middle of content', () => {
  it('returns a window centered on the match term', () => {
    const content = 'A'.repeat(100) + 'TARGET' + 'B'.repeat(100)
    const result = extractSnippet(content, 'TARGET', 40)
    expect(result).toContain('TARGET')
  })

  it('adds an ellipsis before the window when the match is not at the start', () => {
    const content = 'A'.repeat(80) + 'needle' + 'B'.repeat(80)
    const result = extractSnippet(content, 'needle', 40)
    expect(result.startsWith('...')).toBe(true)
  })

  it('adds an ellipsis after the window when the match is not at the end', () => {
    const content = 'A'.repeat(80) + 'needle' + 'B'.repeat(80)
    const result = extractSnippet(content, 'needle', 40)
    expect(result.endsWith('...')).toBe(true)
  })
})

describe('extractSnippet — match near the end of content', () => {
  it('returns content up to end without a trailing ellipsis', () => {
    const content = 'Lots of filler text here and then finally: Pontius Glaw.'
    const result = extractSnippet(content, 'Pontius Glaw', 30)
    expect(result).toContain('Pontius Glaw')
    expect(result.endsWith('...')).toBe(false)
  })
})

describe('extractSnippet — no match found', () => {
  it('returns the first max chars of content when query does not appear', () => {
    const content = 'Gregor Eisenhorn is an inquisitor of the Ordo Xenos.'
    const result = extractSnippet(content, 'Bequin', 20)
    expect(result.length).toBeLessThanOrEqual(23) // 20 + possible ellipsis
    expect(result).toContain('Gregor')
  })

  it('does not add a leading ellipsis when falling back to start of content', () => {
    const result = extractSnippet('No match here at all.', 'xyzzy', 30)
    expect(result.startsWith('...')).toBe(false)
  })
})

describe('extractSnippet — multi-term query', () => {
  it('finds the first occurrence of any query term when multiple words given', () => {
    const content = 'Bequin walked through the halls. Later Eisenhorn arrived.'
    const result = extractSnippet(content, 'Eisenhorn Bequin', 30)
    // Should anchor to the first occurring term (Bequin is earlier)
    expect(result).toContain('Bequin')
  })
})

describe('extractSnippet — max parameter', () => {
  it('respects a shorter max window', () => {
    const result = extractSnippet(LONG, 'fox', 20)
    // Result text (excluding ellipsis markers) should not massively exceed max
    const textOnly = result.replace(/\.\.\./g, '')
    expect(textOnly.length).toBeLessThanOrEqual(30)
  })

  it('uses a sensible default max when not provided', () => {
    const result = extractSnippet(LONG, 'fox')
    expect(result).toContain('fox')
    expect(result.length).toBeLessThan(LONG.length)
  })

  it('returns the full content when content is shorter than max', () => {
    const short = 'Short content with Eisenhorn.'
    const result = extractSnippet(short, 'Eisenhorn', 200)
    expect(result).toBe(short)
  })
})
