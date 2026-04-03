import { describe, test, expect } from 'bun:test'
import * as eventDefs from '../events'

describe('deviceAppeared event', () => {
  test('has advise tier — unknown devices need classification', () => {
    expect(eventDefs.deviceAppeared.ai.tier).toBe('advise')
  })

  test('uses standard network topic', () => {
    expect(eventDefs.deviceAppeared.topic).toBe('home/network/devices/new')
  })

  test('notify is true — surfaces in notification feed', () => {
    expect(eventDefs.deviceAppeared.ui.notify).toBe(true)
  })
})

describe('motionDetected event', () => {
  test('has ignore tier — too frequent for agent response', () => {
    expect(eventDefs.motionDetected.ai.tier).toBe('ignore')
  })
})

describe('wanStatusChanged event', () => {
  test('has advise tier — internet outage needs attention', () => {
    expect(eventDefs.wanStatusChanged.ai.tier).toBe('advise')
  })

  test('notify is true', () => {
    expect(eventDefs.wanStatusChanged.ui.notify).toBe(true)
  })
})
