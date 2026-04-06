import { z } from 'zod'
import { defineEvent } from '@maisie/shared'

export const supplyLow = defineEvent({
  name: 'supply_low',
  description: 'An ink or toner cartridge has dropped below 20%',
  schema: z.object({
    cartridge: z.string(),
    levelPercent: z.number().nullable(),
  }),
  topic: 'home/hp-printer/supply_low',
  ai: {
    tier: 'advise',
    context: 'Printer ink is running low. Let the user know which cartridge needs replacing.',
  },
  ui: { realtime: true, notify: true },
})

export const printerError = defineEvent({
  name: 'printer_error',
  description: 'The HP printer has entered an error state (paper jam, hardware fault, etc.)',
  schema: z.object({
    state: z.string(),
    raw: z.string(),
  }),
  topic: 'home/hp-printer/error',
  ai: {
    tier: 'advise',
    context: 'Printer is in an error state. Inform the user and suggest checking for paper jams or hardware issues.',
  },
  ui: { realtime: true, notify: true },
})
