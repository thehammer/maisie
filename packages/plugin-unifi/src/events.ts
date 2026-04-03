import { defineEvent } from '@maisie/shared'
import { z } from 'zod'

export const deviceAppeared = defineEvent({
  name: 'device_appeared',
  description: 'A new device appeared on the home network',
  schema: z.object({
    mac: z.string(),
    ip: z.string().optional(),
    vendor: z.string().optional(),
    hostname: z.string().optional(),
  }),
  topic: 'home/network/devices/new',
  ai: {
    tier: 'advise',
    context: 'An unknown device joined the network. Natalie should identify it, assess if it belongs, and advise whether action is needed.',
  },
  ui: { realtime: true, notify: true },
})

export const deviceDisappeared = defineEvent({
  name: 'device_disappeared',
  description: 'A known device went offline',
  schema: z.object({ mac: z.string(), hostname: z.string().optional() }),
  topic: 'home/network/devices/missing',
  ai: { tier: 'inform', context: 'A previously online device is no longer seen on the network.' },
  ui: { realtime: true, notify: false },
})

export const wanStatusChanged = defineEvent({
  name: 'wan_status_changed',
  description: 'Internet connectivity status changed',
  schema: z.object({ online: z.boolean(), previousState: z.boolean() }),
  topic: 'home/network/health/wan',
  ai: {
    tier: 'advise',
    context: 'Internet connection state changed. If going offline, Natalie should assess impact and notify.',
  },
  ui: { realtime: true, notify: true },
})

export const motionDetected = defineEvent({
  name: 'motion_detected',
  description: 'Motion detected by a Protect camera',
  schema: z.object({ cameraId: z.string(), cameraName: z.string(), timestamp: z.string() }),
  topic: 'home/protect/motion',
  ai: { tier: 'ignore', context: 'Routine motion event — too frequent for agent response' },
  ui: { realtime: true, notify: false },
})
