import { describe, test, expect } from 'bun:test'
import { tokyoStreamerPlugin } from '../plugin'

const actions = Object.fromEntries(tokyoStreamerPlugin.actions.map((a) => [a.name, a]))
const events = Object.fromEntries(tokyoStreamerPlugin.events.map((e) => [e.name, e]))

describe('plugin structure', () => {
  test('all actions have http, ai, ui declared', () => {
    for (const [name, action] of Object.entries(actions)) {
      expect(action.http, `${name}: http missing`).toBeDefined()
      expect(action.ai, `${name}: ai missing`).not.toBeUndefined()
      expect(action.ui, `${name}: ui missing`).not.toBeUndefined()
    }
  })

  test('get_stream_health has ai: false (infrastructure)', () => {
    expect(actions['get_stream_health'].ai).toBe(false)
  })

  test('get_active_streams has inform tier', () => {
    const ai = actions['get_active_streams'].ai
    expect(ai).not.toBe(false)
    if (ai !== false) {
      expect(ai.tier).toBe('inform')
    }
  })
})

describe('events', () => {
  test('nvenc_limit_reached has advise tier', () => {
    expect(events['nvenc_limit_reached'].ai.tier).toBe('advise')
  })

  test('stream_failed has notify true', () => {
    expect(events['stream_failed'].ui.notify).toBe(true)
  })

  test('nvenc_limit_reached has notify true', () => {
    expect(events['nvenc_limit_reached'].ui.notify).toBe(true)
  })
})
