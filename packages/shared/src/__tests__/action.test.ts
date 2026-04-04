import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import { defineAction } from '../action'
import { defineEvent } from '../event'
import { CAPABILITIES } from '../capabilities'

describe('defineAction', () => {
  test('creates an action with correct shape', () => {
    const action = defineAction({
      name: 'get_devices',
      description: 'Get all network devices',
      input: z.object({ onlineOnly: z.boolean().optional() }),
      output: z.array(z.object({ mac: z.string() })),
      http: { method: 'GET' },
      ai: { tier: 'inform' },
      ui: { label: 'Network Devices', section: 'network' },
      execute: async () => [],
    })
    expect(action.name).toBe('get_devices')
    expect(action.http.method).toBe('GET')
    expect(action.ai).not.toBe(false)
    if (action.ai !== false) {
      expect(action.ai.tier).toBe('inform')
    }
  })

  test('input schema validates correctly', () => {
    const action = defineAction({
      name: 'block_device',
      description: 'Block a device',
      input: z.object({ mac: z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i) }),
      output: z.object({ success: z.boolean() }),
      http: { method: 'POST' },
      ai: { tier: 'act' },
      ui: false,
      execute: async () => ({ success: true }),
    })
    expect(action.input.safeParse({ mac: 'aa:bb:cc:dd:ee:ff' }).success).toBe(true)
    expect(action.input.safeParse({ mac: 'not-a-mac' }).success).toBe(false)
  })

  test('ai: false is a valid explicit opt-out', () => {
    const action = defineAction({
      name: 'internal_image_proxy',
      description: 'Proxy an image URL',
      input: z.object({ url: z.string() }),
      output: z.instanceof(Buffer),
      http: { method: 'GET' },
      ai: false,
      ui: false,
      execute: async () => Buffer.from(''),
    })
    expect(action.ai).toBe(false)
    expect(action.ui).toBe(false)
  })

  test('execute returns output matching declared schema', async () => {
    const action = defineAction({
      name: 'get_status',
      description: 'Get status',
      input: z.object({}),
      output: z.object({ online: z.boolean() }),
      http: { method: 'GET' },
      ai: { tier: 'inform' },
      ui: { label: 'Status', section: 'system' },
      execute: async () => ({ online: true }),
    })
    const result = await action.execute({}, {
      log: () => {},
      emit: () => {},
    })
    expect(action.output.safeParse(result).success).toBe(true)
  })
})

describe('defineEvent', () => {
  test('creates an event with correct shape', () => {
    const event = defineEvent({
      name: 'device_appeared',
      description: 'A new device appeared on the network',
      schema: z.object({ mac: z.string(), vendor: z.string().optional() }),
      topic: 'home/network/devices/new',
      ai: { tier: 'advise', context: 'Unknown device joined the network' },
      ui: { realtime: true, notify: true },
    })
    expect(event.name).toBe('device_appeared')
    expect(event.ai.tier).toBe('advise')
    expect(event.topic).toBe('home/network/devices/new')
  })

  test('ignore tier is valid for high-frequency events', () => {
    const event = defineEvent({
      name: 'heartbeat',
      description: 'Agent heartbeat',
      schema: z.object({ timestamp: z.string() }),
      ai: { tier: 'ignore', context: 'Routine heartbeat — no action needed' },
      ui: { realtime: false, notify: false },
    })
    expect(event.ai.tier).toBe('ignore')
  })
})

describe('CAPABILITIES', () => {
  test('all capabilities have at least one required action', () => {
    for (const [name, cap] of Object.entries(CAPABILITIES)) {
      expect(cap.requiredActions.length).toBeGreaterThan(0)
    }
  })

  test('media-server requires the three standard actions', () => {
    const cap = CAPABILITIES['media-server']
    expect(cap.requiredActions).toContain('list_libraries')
    expect(cap.requiredActions).toContain('get_now_playing')
    expect(cap.requiredActions).toContain('list_recently_added')
  })

  test('network requires list_devices and get_wan_health', () => {
    const cap = CAPABILITIES['network']
    expect(cap.requiredActions).toContain('list_devices')
    expect(cap.requiredActions).toContain('get_wan_health')
  })
})
