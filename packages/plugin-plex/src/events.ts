import { defineEvent } from '@maisie/shared'
import { z } from 'zod'

export const nowPlayingUpdated = defineEvent({
  name: 'now_playing_updated',
  description: 'Plex playback sessions changed',
  schema: z.object({ sessionCount: z.number() }),
  topic: 'home/media/plex/now_playing',
  ai: { tier: 'ignore', context: 'Routine playback status update' },
  ui: { realtime: true, notify: false },
})

export const mediaAdded = defineEvent({
  name: 'media_added',
  description: 'New media was added to Plex',
  schema: z.object({ title: z.string(), type: z.string(), libraryId: z.string() }),
  topic: 'home/media/plex/new',
  ai: { tier: 'inform', context: 'New content added to the library.' },
  ui: { realtime: true, notify: false },
})
