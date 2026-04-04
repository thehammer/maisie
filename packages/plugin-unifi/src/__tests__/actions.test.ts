import { describe, test, expect } from 'bun:test'
import * as actionDefs from '../actions'

describe('list_devices action', () => {
  test('has correct action shape', () => {
    const action = actionDefs.listDevices
    expect(action.name).toBe('list_devices')
    expect(action.http.method).toBe('GET')
    expect(action.ai).not.toBe(false)
    expect(action.ui).not.toBe(false)
  })

  test('input schema accepts vlan filter', () => {
    const action = actionDefs.listDevices
    expect(action.input.safeParse({ vlan: 20 }).success).toBe(true)
    expect(action.input.safeParse({ vlan: 'not-a-number' }).success).toBe(false)
  })

  test('input schema accepts empty object', () => {
    expect(actionDefs.listDevices.input.safeParse({}).success).toBe(true)
  })

  test('ui surface has type declared', () => {
    const action = actionDefs.listDevices
    if (action.ui !== false) {
      expect(action.ui.type).toBe('data')
    }
  })
})

describe('invoke_block_device action', () => {
  test('has advise tier — requires human approval before blocking', () => {
    const action = actionDefs.invokeBlockDevice
    expect(action.ai).not.toBe(false)
    if (action.ai !== false) {
      expect(action.ai.tier).toBe('advise')
    }
  })

  test('ui is false — not surfaced in dashboard directly', () => {
    expect(actionDefs.invokeBlockDevice.ui).toBe(false)
  })

  test('requires valid mac address', () => {
    const action = actionDefs.invokeBlockDevice
    expect(action.input.safeParse({ mac: 'aa:bb:cc:dd:ee:ff' }).success).toBe(true)
    expect(action.input.safeParse({ mac: 'not-a-mac' }).success).toBe(false)
    expect(action.input.safeParse({}).success).toBe(false)
  })
})

describe('invoke_network_audit action', () => {
  test('has advise tier — produces analysis for review', () => {
    const action = actionDefs.invokeNetworkAudit
    if (action.ai !== false) {
      expect(action.ai.tier).toBe('advise')
    }
  })

  test('ui surface type is action', () => {
    const action = actionDefs.invokeNetworkAudit
    if (action.ui !== false) {
      expect(action.ui.type).toBe('action')
    }
  })
})

describe('list_cameras action', () => {
  test('has correct action shape', () => {
    const action = actionDefs.listCameras
    expect(action.name).toBe('list_cameras')
    expect(action.http.method).toBe('GET')
    expect(action.ai).not.toBe(false)
    expect(action.ui).not.toBe(false)
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
    expect(actionNames).toContain('list_devices')
    expect(actionNames).toContain('get_wan_health')
  })

  test('plugin provides all required camera capability actions', () => {
    const actionNames = Object.values(actionDefs).map(a => a.name)
    expect(actionNames).toContain('list_cameras')
    expect(actionNames).toContain('get_snapshot')
  })

  test('all action names follow verb prefix convention', () => {
    const validPrefixes = ['list_', 'get_', 'set_', 'create_', 'delete_', 'invoke_', 'stream_', 'subscribe_']
    for (const action of Object.values(actionDefs)) {
      const valid = validPrefixes.some(p => action.name.startsWith(p))
      expect(valid, `action "${action.name}" must start with a valid verb prefix`).toBe(true)
    }
  })

  test('data actions have ui.type declared', () => {
    for (const action of Object.values(actionDefs)) {
      if (action.ui !== false) {
        expect(
          action.ui.type,
          `action "${action.name}" should have ui.type declared`
        ).toBeDefined()
      }
    }
  })
})
