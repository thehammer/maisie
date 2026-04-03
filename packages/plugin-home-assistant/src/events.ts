import { defineEvent } from '@maisie/shared'
import { z } from 'zod'

export const entityStateChanged = defineEvent({
  name: 'entity_state_changed',
  schema: z.object({ entityId: z.string(), state: z.string(), previousState: z.string() }),
  description: 'A Home Assistant entity changed state',
  topic: 'home/smarthome/state_changed',
  ai: { tier: 'ignore', context: 'High-frequency state changes — agent does not respond to routine entity updates' },
  ui: { realtime: true, notify: false },
})
