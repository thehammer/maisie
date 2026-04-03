import { defineEvent } from '@maisie/shared'
import { z } from 'zod'

export const movieDownloaded = defineEvent({
  name: 'movie_downloaded',
  description: 'A movie finished downloading',
  schema: z.object({ title: z.string(), year: z.number(), quality: z.string() }),
  topic: 'home/media/radarr/downloaded',
  ai: { tier: 'inform', context: 'Movie download complete.' },
  ui: { realtime: false, notify: false },
})
