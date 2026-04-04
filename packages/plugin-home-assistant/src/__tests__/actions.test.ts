import { describe, test, expect } from 'bun:test'
import * as actionDefs from '../actions'

describe('get_entities action', () => {
  test('accepts optional domain filter', () => {
    const action = actionDefs.getEntities
    expect(action.input.safeParse({}).success).toBe(true)
    expect(action.input.safeParse({ domain: 'light' }).success).toBe(true)
    expect(action.input.safeParse({ domain: 'light', area: 'kitchen' }).success).toBe(true)
  })

  test('has GET method', () => {
    expect(actionDefs.getEntities.http.method).toBe('GET')
  })

  test('has inform tier', () => {
    const ai = actionDefs.getEntities.ai
    expect(ai).not.toBe(false)
    if (ai !== false) expect(ai.tier).toBe('inform')
  })
})

describe('call_service action', () => {
  test('requires domain and service', () => {
    const action = actionDefs.callService
    expect(action.input.safeParse({ domain: 'light', service: 'turn_on' }).success).toBe(true)
    expect(action.input.safeParse({ domain: 'light' }).success).toBe(false)
    expect(action.input.safeParse({ service: 'turn_on' }).success).toBe(false)
    expect(action.input.safeParse({}).success).toBe(false)
  })

  test('has act tier', () => {
    const ai = actionDefs.callService.ai
    expect(ai).not.toBe(false)
    if (ai !== false) expect(ai.tier).toBe('act')
  })

  test('entityId and data are optional', () => {
    const action = actionDefs.callService
    expect(action.input.safeParse({ domain: 'scene', service: 'turn_on' }).success).toBe(true)
    expect(action.input.safeParse({
      domain: 'light',
      service: 'turn_on',
      entityId: 'light.kitchen',
      data: { brightness_pct: 80 },
    }).success).toBe(true)
  })
})

describe('toggle_entity action', () => {
  test('requires entityId', () => {
    const action = actionDefs.toggleEntity
    expect(action.input.safeParse({ entityId: 'light.kitchen' }).success).toBe(true)
    expect(action.input.safeParse({}).success).toBe(false)
  })

  test('has POST method', () => {
    expect(actionDefs.toggleEntity.http.method).toBe('POST')
  })
})

describe('plugin structure', () => {
  test('plugin has get_entities and call_service (required smart-home capability actions)', () => {
    const names = Object.values(actionDefs)
      .filter(v => typeof v === 'object' && 'name' in v)
      .map((a: any) => a.name)
    expect(names).toContain('list_entities')
    expect(names).toContain('invoke_service')
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
