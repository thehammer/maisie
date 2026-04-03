import { describe, test, expect } from 'bun:test'
import * as actionDefs from '../actions'

describe('get_devices action', () => {
  test('has correct action shape', () => {
    const action = actionDefs.getDevices
    expect(action.name).toBe('get_devices')
    expect(action.http.method).toBe('GET')
    expect(action.ai).not.toBe(false)
    expect(action.ui).not.toBe(false)
  })

  test('input schema accepts onlineOnly filter', () => {
    const action = actionDefs.getDevices
    expect(action.input.safeParse({ onlineOnly: true }).success).toBe(true)
    expect(action.input.safeParse({ onlineOnly: 'not-a-bool' }).success).toBe(false)
  })

  test('input schema accepts empty object', () => {
    expect(actionDefs.getDevices.input.safeParse({}).success).toBe(true)
  })
})

describe('block_device action', () => {
  test('has act tier — unsafe operation', () => {
    const action = actionDefs.blockDevice
    expect(action.ai).not.toBe(false)
    if (action.ai !== false) {
      expect(action.ai.tier).toBe('act')
    }
  })

  test('ui is false — not surfaced in dashboard directly', () => {
    expect(actionDefs.blockDevice.ui).toBe(false)
  })

  test('requires valid mac address', () => {
    const action = actionDefs.blockDevice
    expect(action.input.safeParse({ mac: 'aa:bb:cc:dd:ee:ff' }).success).toBe(true)
    expect(action.input.safeParse({ mac: 'not-a-mac' }).success).toBe(false)
    expect(action.input.safeParse({}).success).toBe(false)
  })
})

describe('get_network_audit action', () => {
  test('has advise tier — produces analysis for review', () => {
    const action = actionDefs.getNetworkAudit
    if (action.ai !== false) {
      expect(action.ai.tier).toBe('advise')
    }
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

  test('plugin provides all required network capability actions', () => {
    const actionNames = Object.values(actionDefs).map(a => a.name)
    expect(actionNames).toContain('get_devices')
    expect(actionNames).toContain('get_wan_health')
  })

  test('plugin provides all required camera capability actions', () => {
    const actionNames = Object.values(actionDefs).map(a => a.name)
    expect(actionNames).toContain('get_cameras')
    expect(actionNames).toContain('get_snapshot')
  })
})
