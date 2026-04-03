import { describe, test, expect, beforeEach } from 'bun:test'
import { createEventRouter, topicMatches } from '../event-router'
import type { MaisiePlugin } from '@maisie/shared'

const mockPlugin: MaisiePlugin = {
  name: 'unifi',
  version: '0.1.0',
  description: 'Test plugin',
  capabilities: ['network'],
  envVars: [],
  actions: [],
  events: [
    {
      name: 'device_appeared',
      description: 'New device',
      schema: {} as any,
      topic: 'home/network/devices/new',
      ai: { tier: 'advise', context: 'New device on network' },
      ui: { realtime: true, notify: true },
    },
    {
      name: 'device_disappeared',
      description: 'Device offline',
      schema: {} as any,
      topic: 'home/network/devices/missing',
      ai: { tier: 'inform', context: 'Device went offline' },
      ui: { realtime: true, notify: false },
    },
    {
      name: 'motion_detected',
      description: 'Camera motion',
      schema: {} as any,
      topic: 'home/protect/motion',
      ai: { tier: 'ignore', context: 'Routine motion' },
      ui: { realtime: true, notify: false },
    },
    {
      name: 'wan_status',
      description: 'WAN status',
      schema: {} as any,
      topic: 'home/network/+/wan',
      ai: { tier: 'act', context: 'Internet went down' },
      ui: { realtime: true, notify: true },
    },
  ],
  persona: undefined,
  async init() {},
  async shutdown() {},
  async healthCheck() { return { status: 'healthy', lastCheck: new Date() } },
}

describe('EventRouter', () => {
  let router: ReturnType<typeof createEventRouter>

  beforeEach(() => {
    router = createEventRouter([mockPlugin])
  })

  test('classifies advise-tier events correctly', () => {
    const result = router.classify('home/network/devices/new')
    expect(result).not.toBeNull()
    expect(result!.tier).toBe('advise')
    expect(result!.context).toBe('New device on network')
    expect(result!.pluginName).toBe('unifi')
    expect(result!.eventName).toBe('device_appeared')
  })

  test('classifies inform-tier events correctly', () => {
    const result = router.classify('home/network/devices/missing')
    expect(result).not.toBeNull()
    expect(result!.tier).toBe('inform')
  })

  test('classifies act-tier events correctly', () => {
    const result = router.classify('home/network/health/wan')
    expect(result).not.toBeNull()
    expect(result!.tier).toBe('act')
  })

  test('returns null for ignore-tier events', () => {
    const result = router.classify('home/protect/motion')
    expect(result).toBeNull()
  })

  test('returns null for unknown topics', () => {
    const result = router.classify('home/unknown/topic')
    expect(result).toBeNull()
  })

  test('respects cooldown between same-topic fires', () => {
    const first = router.classify('home/network/devices/new')
    expect(first).not.toBeNull()

    const second = router.classify('home/network/devices/new')
    expect(second).toBeNull()
  })

  test('builds rules from plugin events', () => {
    expect(router.rules).toHaveLength(4)
    expect(router.rules[0].topic).toBe('home/network/devices/new')
  })
})

describe('topicMatches', () => {
  test('exact match', () => {
    expect(topicMatches('home/network/devices/new', 'home/network/devices/new')).toBe(true)
    expect(topicMatches('home/network/devices/new', 'home/network/devices/old')).toBe(false)
  })

  test('# wildcard matches remaining levels', () => {
    expect(topicMatches('home/network/#', 'home/network/devices/new')).toBe(true)
    expect(topicMatches('home/network/#', 'home/network/health/wan')).toBe(true)
    expect(topicMatches('home/#', 'home/network/devices/new')).toBe(true)
    expect(topicMatches('home/network/#', 'other/network/devices')).toBe(false)
  })

  test('+ wildcard matches single level', () => {
    expect(topicMatches('home/network/+/wan', 'home/network/health/wan')).toBe(true)
    expect(topicMatches('home/network/+/wan', 'home/network/status/wan')).toBe(true)
    expect(topicMatches('home/network/+/wan', 'home/network/a/b/wan')).toBe(false)
  })

  test('pattern longer than topic does not match', () => {
    expect(topicMatches('home/network/devices/new', 'home/network/devices')).toBe(false)
  })

  test('topic longer than pattern does not match (without wildcard)', () => {
    expect(topicMatches('home/network/devices', 'home/network/devices/new')).toBe(false)
  })
})
