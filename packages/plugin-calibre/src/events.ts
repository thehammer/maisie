import { z } from 'zod'
import { defineEvent } from '@maisie/shared'

export const enrichmentProposed = defineEvent({
  name: 'enrichment_proposed',
  description: 'New metadata enrichment proposals are ready for review',
  schema: z.object({ count: z.number() }),
  topic: 'home/calibre/enrichment/proposed',
  ai: { tier: 'inform', context: 'Enrichment proposals ready. Alexandria can summarize what was found.' },
  ui: { realtime: true, notify: true },
})

export const enrichmentApplied = defineEvent({
  name: 'enrichment_applied',
  description: 'Metadata changes were applied to Calibre',
  schema: z.object({
    bookId: z.number(),
    title: z.string(),
    fieldsUpdated: z.array(z.string()),
  }),
  topic: 'home/calibre/enrichment/applied',
  ai: { tier: 'ignore', context: 'Applied changes — no action needed' },
  ui: { realtime: true, notify: false },
})
