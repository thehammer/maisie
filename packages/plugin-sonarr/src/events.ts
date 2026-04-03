import { defineEvent } from '@maisie/shared'
import { z } from 'zod'

export const episodeDownloaded = defineEvent({
  name: 'episode_downloaded',
  description: 'A TV episode finished downloading',
  schema: z.object({ show: z.string(), season: z.number(), episode: z.number() }),
  topic: 'home/media/sonarr/downloaded',
  ai: { tier: 'inform', context: 'Episode download complete.' },
  ui: { realtime: false, notify: false },
})

export const seasonComplete = defineEvent({
  name: 'season_complete',
  description: 'All episodes of a TV season are now available',
  schema: z.object({ show: z.string(), season: z.number() }),
  topic: 'home/media/sonarr/season_complete',
  ai: { tier: 'inform', context: 'Full season now available in Plex.' },
  ui: { realtime: false, notify: true },
})
