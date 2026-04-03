import { describe, test, expect } from 'bun:test'
import * as actionDefs from '../actions'
import * as eventDefs from '../events'

describe('get_health action', () => {
  test('has http GET', () => {
    expect(actionDefs.getHealth.http.method).toBe('GET')
  })

  test('has ai inform tier', () => {
    const ai = actionDefs.getHealth.ai
    expect(ai).not.toBe(false)
    if (ai !== false) {
      expect(ai.tier).toBe('inform')
    }
  })

  test('ui has section nas', () => {
    const ui = actionDefs.getHealth.ui
    expect(ui).not.toBe(false)
    if (ui !== false) {
      expect(ui.section).toBe('nas')
    }
  })

  test('output schema is defined', () => {
    expect(actionDefs.getHealth.output).toBeDefined()
  })
})

describe('list_files action', () => {
  test('requires path parameter', () => {
    expect(actionDefs.listFiles.input.safeParse({ path: '/volume1/docker' }).success).toBe(true)
  })

  test('input rejects missing path', () => {
    expect(actionDefs.listFiles.input.safeParse({}).success).toBe(false)
  })

  test('has http GET', () => {
    expect(actionDefs.listFiles.http.method).toBe('GET')
  })
})

describe('volumeDegraded event', () => {
  test('has tier act — critical event requiring immediate response', () => {
    expect(eventDefs.volumeDegraded.ai.tier).toBe('act')
  })
})

describe('storageLow event', () => {
  test('has notify true', () => {
    expect(eventDefs.storageLow.ui.notify).toBe(true)
  })

  test('uses nas storage topic', () => {
    expect(eventDefs.storageLow.topic).toBe('home/nas/storage/low')
  })
})

describe('plugin structure', () => {
  test('plugin provides get_health — required storage capability action', () => {
    const actionNames = Object.values(actionDefs).map(a => a.name)
    expect(actionNames).toContain('get_health')
  })

  test('plugin provides list_files — required storage capability action', () => {
    const actionNames = Object.values(actionDefs).map(a => a.name)
    expect(actionNames).toContain('list_files')
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
