import { defineEvent } from '@maisie/shared'
import { z } from 'zod'

export const lineupChanged = defineEvent({
  name: 'lineup_changed',
  description: 'The channel lineup was modified (channel added, removed, or updated)',
  schema: z.object({ action: z.enum(['added', 'removed', 'updated']), channelNumber: z.number() }),
  topic: 'home/channels/lineup',
  ai: { tier: 'inform', context: 'Lineup changed — Plex guide refresh may be needed.' },
  ui: { realtime: true, notify: false },
})

export const epgRefreshed = defineEvent({
  name: 'epg_refreshed',
  description: 'EPG guide data was refreshed',
  schema: z.object({ channelsUpdated: z.number() }),
  topic: 'home/tv/epg/updated',
  ai: { tier: 'ignore', context: 'Routine EPG refresh' },
  ui: { realtime: true, notify: false },
})

export const streamError = defineEvent({
  name: 'stream_error',
  description: 'A channel stream encountered an error',
  schema: z.object({ channelNumber: z.number(), error: z.string() }),
  topic: 'home/tv/stream/error',
  ai: { tier: 'advise', context: 'Stream error on a channel. Channing should diagnose.' },
  ui: { realtime: true, notify: true },
})
