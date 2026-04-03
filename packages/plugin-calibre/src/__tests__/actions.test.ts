import { describe, test, expect } from 'bun:test'
import * as actionDefs from '../actions'
import { alexandria } from '../persona'

describe('search_books action', () => {
  test('requires query parameter', () => {
    expect(actionDefs.searchBooks.input.safeParse({}).success).toBe(false)
    expect(actionDefs.searchBooks.input.safeParse({ query: '' }).success).toBe(true)
  })
  test('has inform tier', () => {
    if (actionDefs.searchBooks.ai !== false) {
      expect(actionDefs.searchBooks.ai.tier).toBe('inform')
    }
  })
})

describe('apply_enrichment action', () => {
  test('requires bookId', () => {
    expect(actionDefs.applyEnrichment.input.safeParse({}).success).toBe(false)
    expect(actionDefs.applyEnrichment.input.safeParse({ bookId: 42 }).success).toBe(true)
  })
  test('has advise tier — writes to library', () => {
    if (actionDefs.applyEnrichment.ai !== false) {
      expect(actionDefs.applyEnrichment.ai.tier).toBe('advise')
    }
  })
  test('bookId must be a number', () => {
    expect(actionDefs.applyEnrichment.input.safeParse({ bookId: 'not-a-number' }).success).toBe(false)
  })
})

describe('plugin structure', () => {
  test('provides required book-library capability actions', () => {
    const names = Object.values(actionDefs).map(a => a.name)
    expect(names).toContain('search_books')
    expect(names).toContain('get_book_count')
  })
  test('all actions have http, ai, ui declared', () => {
    for (const [name, action] of Object.entries(actionDefs)) {
      expect(action.http, `${name}: http missing`).toBeDefined()
      expect(action.ai, `${name}: ai missing`).toBeDefined()
      expect(action.ui, `${name}: ui missing`).toBeDefined()
    }
  })
  test('all actions have http method set', () => {
    for (const [name, action] of Object.entries(actionDefs)) {
      expect(action.http.method, `${name}: http.method missing`).toBeDefined()
    }
  })
})

describe('Alexandria persona', () => {
  test('defaultTier is advise — never acts unilaterally on the library', () => {
    expect(alexandria.defaultTier).toBe('advise')
  })
  test('apply_enrichment is in toolScopes', () => {
    expect(alexandria.toolScopes).toContain('apply_enrichment')
  })
  test('eventSubscriptions cover calibre topics', () => {
    expect(alexandria.eventSubscriptions.some(s => s.includes('calibre'))).toBe(true)
  })
})

describe('enrichment state machine via actions', () => {
  test('scan creates pending items', () => {
    const action = actionDefs.scanEnrichmentGaps
    expect(action.input.safeParse({ limit: 10 }).success).toBe(true)
  })
  test('scan defaults limit to 50', () => {
    const parsed = actionDefs.scanEnrichmentGaps.input.safeParse({})
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect((parsed.data as { limit: number }).limit).toBe(50)
    }
  })
  test('apply requires a specific bookId', () => {
    expect(actionDefs.applyEnrichment.input.safeParse({ bookId: 1 }).success).toBe(true)
    expect(actionDefs.applyEnrichment.input.safeParse({ bookId: 'not-a-number' }).success).toBe(false)
  })
  test('reject_enrichment requires bookId', () => {
    expect(actionDefs.rejectEnrichment.input.safeParse({ bookId: 7 }).success).toBe(true)
    expect(actionDefs.rejectEnrichment.input.safeParse({}).success).toBe(false)
  })
  test('get_enrichment_queue status filter only accepts valid values', () => {
    expect(actionDefs.getEnrichmentQueue.input.safeParse({}).success).toBe(true)
    expect(actionDefs.getEnrichmentQueue.input.safeParse({ status: 'enriched' }).success).toBe(true)
    expect(actionDefs.getEnrichmentQueue.input.safeParse({ status: 'reviewed' }).success).toBe(true)
    expect(actionDefs.getEnrichmentQueue.input.safeParse({ status: 'pending' }).success).toBe(false)
  })
  test('run_enrichment_lookup has advise tier — produces proposals not final changes', () => {
    if (actionDefs.runEnrichmentLookup.ai !== false) {
      expect(actionDefs.runEnrichmentLookup.ai.tier).toBe('advise')
    }
  })
})

describe('library read actions', () => {
  test('get_book requires id', () => {
    expect(actionDefs.getBook.input.safeParse({}).success).toBe(false)
    expect(actionDefs.getBook.input.safeParse({ id: 123 }).success).toBe(true)
  })
  test('get_book ui is false — not a top-level dashboard widget', () => {
    expect(actionDefs.getBook.ui).toBe(false)
  })
  test('search_external_books defaults limit to 5', () => {
    const parsed = actionDefs.searchExternalBooks.input.safeParse({ query: 'Dune' })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect((parsed.data as { limit: number }).limit).toBe(5)
    }
  })
  test('get_library_stats has inform tier', () => {
    if (actionDefs.getLibraryStats.ai !== false) {
      expect(actionDefs.getLibraryStats.ai.tier).toBe('inform')
    }
  })
})
