import { describe, test, expect } from 'bun:test'
import * as actionDefs from '../actions'

describe('cleanup_youtube action', () => {
  test('defaults dryRun to true (safety default)', () => {
    const action = actionDefs.cleanupYoutube
    const parsed = action.input.safeParse({})
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.dryRun).toBe(true)
    }
  })

  test('has advise tier — irreversible operation', () => {
    const ai = actionDefs.cleanupYoutube.ai
    expect(ai).not.toBe(false)
    if (ai !== false) expect(ai.tier).toBe('advise')
  })

  test('accepts explicit dryRun: false', () => {
    expect(actionDefs.cleanupYoutube.input.safeParse({ dryRun: false }).success).toBe(true)
  })
})

describe('get_auth_status action', () => {
  test('has inform tier', () => {
    const ai = actionDefs.getAuthStatus.ai
    expect(ai).not.toBe(false)
    if (ai !== false) expect(ai.tier).toBe('inform')
  })

  test('has GET method', () => {
    expect(actionDefs.getAuthStatus.http.method).toBe('GET')
  })

  test('accepts empty input', () => {
    expect(actionDefs.getAuthStatus.input.safeParse({}).success).toBe(true)
  })
})

describe('get_upcoming_events action', () => {
  test('accepts days parameter', () => {
    const action = actionDefs.getUpcomingCalendarEvents
    expect(action.input.safeParse({ days: 14 }).success).toBe(true)
  })

  test('defaults days to 7', () => {
    const parsed = actionDefs.getUpcomingCalendarEvents.input.safeParse({})
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.days).toBe(7)
  })

  test('has GET method', () => {
    expect(actionDefs.getUpcomingCalendarEvents.http.method).toBe('GET')
  })
})

describe('plugin structure', () => {
  test('all actions have http explicitly set', () => {
    const actions = Object.values(actionDefs).filter(v => typeof v === 'object' && 'name' in v) as any[]
    for (const action of actions) {
      expect(action.http).toBeDefined()
      expect(action.http.method).toBeDefined()
    }
  })

  test('all actions have ai explicitly set (or false)', () => {
    const actions = Object.values(actionDefs).filter(v => typeof v === 'object' && 'name' in v) as any[]
    for (const action of actions) {
      expect(action.ai, `action ${action.name} must have ai declared`).toBeDefined()
    }
  })

  test('all actions have ui explicitly set (or false)', () => {
    const actions = Object.values(actionDefs).filter(v => typeof v === 'object' && 'name' in v) as any[]
    for (const action of actions) {
      expect(action.ui, `action ${action.name} must have ui declared`).toBeDefined()
    }
  })
})
