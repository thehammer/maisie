import { defineEvent } from '@maisie/shared'
import { z } from 'zod'

export const printStarted = defineEvent({
  name: 'print_started',
  description: 'A print job started',
  schema: z.object({ jobName: z.string(), estimatedMinutes: z.number().optional() }),
  topic: 'home/printer/bambu/started',
  ai: { tier: 'inform', context: 'Print job began.' },
  ui: { realtime: true, notify: false },
})

export const printCompleted = defineEvent({
  name: 'print_completed',
  description: 'A print job finished successfully',
  schema: z.object({ jobName: z.string(), durationMinutes: z.number() }),
  topic: 'home/printer/bambu/completed',
  ai: { tier: 'inform', context: 'Print job complete.' },
  ui: { realtime: true, notify: true },
})

export const printFailed = defineEvent({
  name: 'print_failed',
  description: 'A print job failed or was interrupted',
  schema: z.object({ jobName: z.string(), error: z.string().optional() }),
  topic: 'home/printer/bambu/failed',
  ai: { tier: 'advise', context: 'Print failure — diagnose the error and advise what to try next.' },
  ui: { realtime: true, notify: true },
})

export const filamentLow = defineEvent({
  name: 'filament_low',
  description: 'Filament spool is below 20% remaining',
  schema: z.object({ remaining: z.number(), color: z.string().optional(), material: z.string().optional() }),
  topic: 'home/printer/bambu/filament_low',
  ai: { tier: 'advise', context: 'Filament running low. Check print queue — current job may not complete.' },
  ui: { realtime: true, notify: true },
})
