import { describe, test, expect } from 'bun:test'
import * as actionDefs from '../actions'

describe('get_now_playing action', () => {
  test('has GET method and ai: inform', () => {
    const action = actionDefs.getNowPlaying
    expect(action.http.method).toBe('GET')
    expect(action.ai).not.toBe(false)
    if (action.ai !== false) {
      expect(action.ai.tier).toBe('inform')
    }
  })
})

describe('get_recently_added action', () => {
  test('input accepts optional limit', () => {
    const action = actionDefs.getRecentlyAdded
    expect(action.input.safeParse({}).success).toBe(true)
    expect(action.input.safeParse({ limit: 50 }).success).toBe(true)
    expect(action.input.safeParse({ libraryId: 'abc' }).success).toBe(true)
  })

  test('limit is optional with default', () => {
    const result = actionDefs.getRecentlyAdded.input.safeParse({})
    expect(result.success).toBe(true)
  })
})

describe('search_media action', () => {
  test('input requires query string', () => {
    const action = actionDefs.searchMedia
    expect(action.input.safeParse({ query: 'Breaking Bad' }).success).toBe(true)
    expect(action.input.safeParse({}).success).toBe(false)
    expect(action.input.safeParse({ query: 123 }).success).toBe(false)
  })
})

describe('get_plex_image action', () => {
  test('has ai: false and ui: false — infrastructure action', () => {
    const action = actionDefs.getPlexImage
    expect(action.ai).toBe(false)
    expect(action.ui).toBe(false)
  })
})

describe('plugin structure', () => {
  test('provides all required media-server capability actions', () => {
    const actionNames = Object.values(actionDefs).map((a) => a.name)
    expect(actionNames).toContain('list_libraries')
    expect(actionNames).toContain('get_now_playing')
    expect(actionNames).toContain('list_recently_added')
  })

  test('all actions have http explicitly set', () => {
    for (const action of Object.values(actionDefs)) {
      expect(action.http).toBeDefined()
      expect(action.http.method).toBeDefined()
    }
  })

  test('all actions have ai explicitly set (or false)', () => {
    for (const [name, action] of Object.entries(actionDefs)) {
      expect(action.ai, `action ${name} must have ai declared`).toBeDefined()
    }
  })

  test('all actions have ui explicitly set (or false)', () => {
    for (const [name, action] of Object.entries(actionDefs)) {
      expect(action.ui, `action ${name} must have ui declared`).toBeDefined()
    }
  })
})
