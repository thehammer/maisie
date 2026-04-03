import { describe, test, expect } from 'bun:test'
import * as actionDefs from '../actions'

describe('search_shows action', () => {
  test('requires query parameter', () => {
    const action = actionDefs.searchShows
    expect(action.input.safeParse({ query: 'Breaking Bad' }).success).toBe(true)
    expect(action.input.safeParse({}).success).toBe(false)
    expect(action.input.safeParse({ query: 123 }).success).toBe(false)
  })
})

describe('add_show action', () => {
  test('has advise tier', () => {
    const action = actionDefs.addShow
    expect(action.ai).not.toBe(false)
    if (action.ai !== false) {
      expect(action.ai.tier).toBe('advise')
    }
  })

  test('requires title', () => {
    const action = actionDefs.addShow
    expect(action.input.safeParse({ title: 'Breaking Bad' }).success).toBe(true)
    expect(action.input.safeParse({}).success).toBe(false)
  })

  test('tvdbId is optional', () => {
    const action = actionDefs.addShow
    expect(action.input.safeParse({ title: 'Breaking Bad' }).success).toBe(true)
    expect(action.input.safeParse({ title: 'Breaking Bad', tvdbId: 81189 }).success).toBe(true)
  })
})

describe('get_upcoming_episodes action', () => {
  test('has default days value', () => {
    const action = actionDefs.getUpcomingEpisodes
    const result = action.input.safeParse({})
    expect(result.success).toBe(true)
  })

  test('accepts explicit days', () => {
    const action = actionDefs.getUpcomingEpisodes
    expect(action.input.safeParse({ days: 14 }).success).toBe(true)
  })
})

describe('check_show_status action', () => {
  test('requires title', () => {
    const action = actionDefs.checkShowStatus
    expect(action.input.safeParse({ title: 'Breaking Bad' }).success).toBe(true)
    expect(action.input.safeParse({}).success).toBe(false)
  })

  test('ui is false — not surfaced in dashboard directly', () => {
    expect(actionDefs.checkShowStatus.ui).toBe(false)
  })
})

describe('plugin structure', () => {
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
