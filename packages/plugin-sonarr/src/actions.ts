import { z } from 'zod'
import { defineAction } from '@maisie/shared'
import { getSonarrClient } from './client'

const showResultSchema = z.object({
  tvdbId: z.number(),
  title: z.string(),
  year: z.number().optional(),
  overview: z.string().optional(),
  inLibrary: z.boolean(),
  status: z.string().optional(),
})

const upcomingEpisodeSchema = z.object({
  show: z.string(),
  title: z.string(),
  seasonEpisode: z.string(),
  airDate: z.string(),
  status: z.string(),
  overview: z.string().optional(),
})

const showSchema = z.object({
  id: z.number(),
  title: z.string(),
  year: z.number().optional(),
  monitored: z.boolean(),
  episodeCount: z.number().optional(),
  episodeFileCount: z.number().optional(),
  status: z.string().optional(),
  overview: z.string().optional(),
})

function padNum(n: number): string {
  return String(n).padStart(2, '0')
}

export const searchShows = defineAction({
  name: 'search_shows',
  description: 'Search for TV shows in Sonarr — searches both the local library and remote sources.',
  input: z.object({
    query: z.string(),
    limit: z.number().default(10),
  }),
  output: z.array(showResultSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Search Shows', section: 'media' },
  async execute(input, _ctx) {
    const sonarr = getSonarrClient()
    if (!sonarr) throw new Error('Sonarr not configured')
    const lookup = await sonarr.lookup(input.query)
    return lookup.slice(0, input.limit).map((s: any) => ({
      tvdbId: s.tvdbId,
      title: s.title,
      year: s.year,
      overview: s.overview?.slice(0, 200),
      inLibrary: !!(s.id && s.id > 0),
      status: s.status,
    }))
  },
})

export const addShow = defineAction({
  name: 'add_show',
  description: 'Add a TV show to the Sonarr watchlist for automated downloading.',
  input: z.object({
    title: z.string(),
    tvdbId: z.number().optional(),
  }),
  output: z.object({
    id: z.number(),
    title: z.string(),
    monitored: z.boolean(),
  }),
  http: { method: 'POST' },
  ai: {
    tier: 'advise',
    description:
      'Add a TV show to the Sonarr watchlist for automated downloading. Requires title. Use advise tier because this triggers automation.',
  },
  ui: { label: 'Add Show', section: 'media' },
  async execute(input, _ctx) {
    const sonarr = getSonarrClient()
    if (!sonarr) throw new Error('Sonarr not configured')

    // Resolve tvdbId if not provided
    let tvdbId = input.tvdbId
    if (!tvdbId) {
      const results = await sonarr.lookup(input.title)
      const match =
        results.find((s: any) => s.title.toLowerCase() === input.title.toLowerCase()) || results[0]
      if (!match) throw new Error(`Show not found: ${input.title}`)
      tvdbId = match.tvdbId
    }

    // Get default root folder and quality profile
    const [rootFolders, qualityProfiles] = await Promise.all([
      sonarr.getRootFolders(),
      sonarr.getQualityProfiles(),
    ])
    if (!rootFolders.length) throw new Error('No root folders configured in Sonarr')
    if (!qualityProfiles.length) throw new Error('No quality profiles configured in Sonarr')

    const result = await sonarr.addSeries({
      title: input.title,
      tvdbId: tvdbId!,
      qualityProfileId: qualityProfiles[0].id,
      rootFolderPath: rootFolders[0].path,
    })

    return {
      id: result.id,
      title: result.title,
      monitored: result.monitored,
    }
  },
})

export const getUpcomingEpisodes = defineAction({
  name: 'get_upcoming_episodes',
  description: 'Get episodes airing in the next N days from Sonarr.',
  input: z.object({
    days: z.number().default(7),
  }),
  output: z.array(upcomingEpisodeSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: {
    label: 'Upcoming Episodes',
    section: 'media',
    realtimeTopic: 'home/media/sonarr/calendar',
  },
  async execute(input, _ctx) {
    const sonarr = getSonarrClient()
    if (!sonarr) throw new Error('Sonarr not configured')
    const start = new Date().toISOString().split('T')[0]
    const end = new Date(Date.now() + input.days * 86400000).toISOString().split('T')[0]
    const episodes = await sonarr.getCalendar(start, end)
    return episodes.map((ep: any) => ({
      show: ep.series?.title || 'Unknown',
      title: ep.title || 'TBA',
      seasonEpisode: `S${padNum(ep.seasonNumber)}E${padNum(ep.episodeNumber)}`,
      airDate: ep.airDateUtc || ep.airDate || '',
      status: ep.hasFile ? 'available' : 'upcoming',
      overview: ep.overview?.slice(0, 200),
    }))
  },
})

export const getMonitoredShows = defineAction({
  name: 'get_monitored_shows',
  description: 'Get all monitored TV shows in the Sonarr library.',
  input: z.object({
    downloaded: z.boolean().optional(),
  }),
  output: z.array(showSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Show Library', section: 'media' },
  async execute(input, _ctx) {
    const sonarr = getSonarrClient()
    if (!sonarr) throw new Error('Sonarr not configured')
    let series = await sonarr.getSeries()
    series = series.filter((s: any) => s.monitored)
    if (input.downloaded !== undefined) {
      series = series.filter((s: any) =>
        input.downloaded
          ? s.episodeFileCount > 0
          : s.episodeFileCount === 0,
      )
    }
    return series.map((s: any) => ({
      id: s.id,
      title: s.title,
      year: s.year,
      monitored: s.monitored,
      episodeCount: s.episodeCount,
      episodeFileCount: s.episodeFileCount,
      status: s.status,
      overview: s.overview?.slice(0, 200),
    }))
  },
})

export const checkShowStatus = defineAction({
  name: 'check_show_status',
  description: "Check if a specific TV show is in Sonarr — whether it's monitored and episode counts.",
  input: z.object({
    title: z.string(),
  }),
  output: z.object({
    found: z.boolean(),
    monitored: z.boolean().optional(),
    episodeCount: z.number().optional(),
    episodeFileCount: z.number().optional(),
  }),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: false,
  async execute(input, _ctx) {
    const sonarr = getSonarrClient()
    if (!sonarr) throw new Error('Sonarr not configured')
    const series = await sonarr.getSeries()
    const match = series.find((s: any) =>
      s.title.toLowerCase().includes(input.title.toLowerCase()),
    )
    if (!match) return { found: false }
    return {
      found: true,
      monitored: match.monitored,
      episodeCount: match.episodeCount,
      episodeFileCount: match.episodeFileCount,
    }
  },
})
