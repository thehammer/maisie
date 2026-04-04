import { describe, test, expect } from 'bun:test'
import * as actionDefs from '../actions'
import * as eventDefs from '../events'

describe('get_status action', () => {
  test('has GET method', () => {
    expect(actionDefs.getStatus.http.method).toBe('GET')
  })

  test('has inform tier', () => {
    const ai = actionDefs.getStatus.ai
    expect(ai).not.toBe(false)
    if (ai !== false) expect(ai.tier).toBe('inform')
  })

  test('input schema accepts empty object', () => {
    expect(actionDefs.getStatus.input.safeParse({}).success).toBe(true)
  })
})

describe('pause_print action', () => {
  test('has advise tier — affects physical hardware mid-print', () => {
    const ai = actionDefs.pausePrint.ai
    expect(ai).not.toBe(false)
    if (ai !== false) expect(ai.tier).toBe('advise')
  })

  test('has POST method', () => {
    expect(actionDefs.pausePrint.http.method).toBe('POST')
  })
})

describe('cancel_print action', () => {
  test('has advise tier — irreversible operation', () => {
    const ai = actionDefs.cancelPrint.ai
    expect(ai).not.toBe(false)
    if (ai !== false) expect(ai.tier).toBe('advise')
  })

  test('has POST method', () => {
    expect(actionDefs.cancelPrint.http.method).toBe('POST')
  })
})

describe('printFailed event', () => {
  test('has advise tier', () => {
    expect(eventDefs.printFailed.ai.tier).toBe('advise')
  })

  test('has correct topic', () => {
    expect(eventDefs.printFailed.topic).toBe('home/printer/bambu/failed')
  })
})

describe('filamentLow event', () => {
  test('has notify: true', () => {
    expect(eventDefs.filamentLow.ui.notify).toBe(true)
  })

  test('has advise tier', () => {
    expect(eventDefs.filamentLow.ai.tier).toBe('advise')
  })
})

describe('plugin structure', () => {
  test('plugin provides get_status (required printer capability action)', () => {
    const names = Object.values(actionDefs)
      .filter(v => typeof v === 'object' && 'name' in v)
      .map((a: any) => a.name)
    expect(names).toContain('get_print_status')
  })

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
