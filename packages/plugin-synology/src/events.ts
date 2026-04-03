import { defineEvent } from '@maisie/shared'
import { z } from 'zod'

export const volumeDegraded = defineEvent({
  name: 'volume_degraded',
  description: 'A storage volume is in a degraded state',
  schema: z.object({ volumeId: z.string(), status: z.string() }),
  topic: 'home/nas/volume/degraded',
  ai: { tier: 'act', context: 'RAID volume is degraded — immediate attention required. Check disk health.' },
  ui: { realtime: true, notify: true },
})

export const storageLow = defineEvent({
  name: 'storage_low',
  description: 'A volume has less than 10% free space',
  schema: z.object({ volumeId: z.string(), freePercent: z.number() }),
  topic: 'home/nas/storage/low',
  ai: { tier: 'advise', context: 'Storage is running low. Natalie should assess what can be cleaned up.' },
  ui: { realtime: true, notify: true },
})

export const containerStopped = defineEvent({
  name: 'container_stopped',
  description: 'A Docker container on the NAS stopped unexpectedly',
  schema: z.object({ name: z.string() }),
  topic: 'home/nas/container/stopped',
  ai: { tier: 'inform', context: 'Container stopped — may need restart.' },
  ui: { realtime: true, notify: false },
})
