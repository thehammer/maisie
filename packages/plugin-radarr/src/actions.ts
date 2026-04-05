import { z } from 'zod'
import { defineAction, field } from '@maisie/shared'
import { getRadarrClient } from './client'

const movieResultSchema = z.object({
  tmdbId: z.number(),
  title: z.string(),
  year: z.number().optional(),
  overview: z.string().optional(),
  inLibrary: z.boolean(),
  hasFile: z.boolean().optional(),
})

const upcomingMovieSchema = z.object({
  title: z.string(),
  year: z.number().optional(),
  releaseDate: z.string(),
  status: z.string(),
  overview: z.string().optional(),
})

const movieSchema = z.object({
  id: z.number(),
  title: z.string(),
  year: z.number().optional(),
  monitored: z.boolean(),
  hasFile: z.boolean(),
  status: z.string().optional(),
  overview: z.string().optional(),
})

export const searchMovies = defineAction({
  name: 'list_movies',
  description:
    'Search for movies in Radarr — searches both the local library and remote sources.',
  input: z.object({
    query: z.string(),
    limit: z.number().default(10),
  }),
  output: z.array(movieResultSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Search Movies', section: 'media' },
  async execute(input, _ctx) {
    const radarr = getRadarrClient()
    if (!radarr) throw new Error('Radarr not configured')
    const lookup = await radarr.lookup(input.query)
    return lookup.slice(0, input.limit).map((m: any) => ({
      tmdbId: m.tmdbId,
      title: m.title,
      year: m.year,
      overview: m.overview?.slice(0, 200),
      inLibrary: !!(m.id && m.id > 0),
      hasFile: m.hasFile,
    }))
  },
})

export const addMovie = defineAction({
  name: 'invoke_add_movie',
  description: 'Add a movie to the Radarr watchlist for automated downloading.',
  input: z.object({
    title: z.string(),
    year: z.number(),
    tmdbId: z.number().optional(),
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
      'Add a movie to the Radarr watchlist for automated downloading. Requires title and year. Use advise tier because this triggers automation.',
  },
  ui: { type: 'action', label: 'Add Movie', section: 'media' },
  async execute(input, _ctx) {
    const radarr = getRadarrClient()
    if (!radarr) throw new Error('Radarr not configured')

    // Resolve tmdbId if not provided
    let tmdbId = input.tmdbId
    if (!tmdbId) {
      const results = await radarr.lookup(`${input.title} ${input.year}`)
      const match = results.find(
        (m: any) =>
          m.title.toLowerCase() === input.title.toLowerCase() && m.year === input.year,
      ) || results[0]
      if (!match) throw new Error(`Movie not found: ${input.title} (${input.year})`)
      tmdbId = match.tmdbId
    }

    // Get default root folder and quality profile
    const [rootFolders, qualityProfiles] = await Promise.all([
      radarr.getRootFolders(),
      radarr.getQualityProfiles(),
    ])
    if (!rootFolders.length) throw new Error('No root folders configured in Radarr')
    if (!qualityProfiles.length) throw new Error('No quality profiles configured in Radarr')

    const result = await radarr.addMovie({
      title: input.title,
      tmdbId: tmdbId!,
      year: input.year,
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

export const getUpcomingMovies = defineAction({
  name: 'list_upcoming_movies',
  description: 'Get movies releasing in the next N days from Radarr.',
  input: z.object({
    days: z.number().default(30),
  }),
  output: z.array(upcomingMovieSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: {
    type: 'data',
    label: 'Upcoming Movies',
    section: 'media',
    realtimeTopic: 'home/media/radarr/calendar',
  },
  async execute(input, _ctx) {
    const radarr = getRadarrClient()
    if (!radarr) throw new Error('Radarr not configured')
    const start = new Date().toISOString().split('T')[0]
    const end = new Date(Date.now() + input.days * 86400000).toISOString().split('T')[0]
    const movies = await radarr.getCalendar(start, end)
    return movies.map((m: any) => ({
      title: m.title,
      year: m.year,
      releaseDate: m.digitalRelease || m.physicalRelease || m.inCinemas || '',
      status: m.hasFile ? 'available' : 'upcoming',
      overview: m.overview?.slice(0, 200),
    }))
  },
})

export const getMonitoredMovies = defineAction({
  name: 'list_monitored_movies',
  description: 'Get all monitored movies in the Radarr library.',
  input: z.object({
    downloaded: z.boolean().optional(),
  }),
  output: z.array(movieSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Movie Library', section: 'media' },
  async execute(input, _ctx) {
    const radarr = getRadarrClient()
    if (!radarr) throw new Error('Radarr not configured')
    let movies = await radarr.getMovies()
    movies = movies.filter((m: any) => m.monitored)
    if (input.downloaded !== undefined) {
      movies = movies.filter((m: any) => m.hasFile === input.downloaded)
    }
    return movies.map((m: any) => ({
      id: m.id,
      title: m.title,
      year: m.year,
      monitored: m.monitored,
      hasFile: m.hasFile,
      status: m.status,
      overview: m.overview?.slice(0, 200),
    }))
  },
})

const missingMovieSchema = z.object({
  title: z.string(),
  year: z.number(),
  status: field(z.string(), 'status'),
  inCinemas: field(z.string().optional(), 'timestamp'),
})

const downloadHistoryEntrySchema = z.object({
  title: z.string(),
  eventType: z.string(),
  date: field(z.string(), 'timestamp'),
  quality: z.string(),
})

export const listMissingMovies = defineAction({
  name: 'list_missing_movies',
  description: 'Get monitored movies that have not been downloaded yet, sorted by cinema release date descending.',
  input: z.object({}),
  output: z.array(missingMovieSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Missing Movies', section: 'media' },
  async execute(_input, _ctx) {
    const radarr = getRadarrClient()
    if (!radarr) throw new Error('Radarr not configured')
    const result = await radarr.getMissingMovies()
    const records = result.records ?? []
    return records.map((m: any) => ({
      title: m.title,
      year: m.year ?? 0,
      status: m.monitored ? 'warning' : 'idle',
      inCinemas: m.inCinemas || undefined,
    }))
  },
})

export const listDownloadHistory = defineAction({
  name: 'list_download_history',
  description: 'Get recent grab and import events from Radarr download history.',
  input: z.object({}),
  output: z.array(downloadHistoryEntrySchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Download History', section: 'media' },
  async execute(_input, _ctx) {
    const radarr = getRadarrClient()
    if (!radarr) throw new Error('Radarr not configured')
    const result = await radarr.getHistory()
    const records = result.records ?? []
    return records.map((h: any) => ({
      title: h.movie?.title || 'Unknown',
      eventType: h.eventType || '',
      date: h.date || '',
      quality: h.quality?.quality?.name || '',
    }))
  },
})

export const invokeMovieSearch = defineAction({
  name: 'invoke_movie_search',
  description: 'Trigger Radarr to search for a specific movie.',
  input: z.object({
    movieId: z.number(),
  }),
  output: z.object({
    commandId: z.number(),
    status: z.string(),
  }),
  http: { method: 'POST' },
  ai: { tier: 'act' },
  ui: false,
  async execute(input, _ctx) {
    const radarr = getRadarrClient()
    if (!radarr) throw new Error('Radarr not configured')
    const result = await radarr.sendCommand({ name: 'MoviesSearch', movieIds: [input.movieId] })
    return {
      commandId: result.id,
      status: result.status || 'queued',
    }
  },
})

export const checkMovieStatus = defineAction({
  name: 'get_movie_status',
  description:
    "Check if a specific movie is in Radarr — whether it's monitored and if it's been downloaded.",
  input: z.object({
    title: z.string(),
    year: z.number().optional(),
  }),
  output: z.object({
    found: z.boolean(),
    monitored: z.boolean().optional(),
    downloaded: z.boolean().optional(),
  }),
  http: { method: 'GET' },
  ai: {
    tier: 'inform',
    description:
      "Check if a specific movie is in Radarr — whether it's monitored and if it's been downloaded.",
  },
  ui: false,
  async execute(input, _ctx) {
    const radarr = getRadarrClient()
    if (!radarr) throw new Error('Radarr not configured')
    const movies = await radarr.getMovies()
    const match = movies.find((m: any) => {
      const titleMatch = m.title.toLowerCase().includes(input.title.toLowerCase())
      const yearMatch = input.year === undefined || m.year === input.year
      return titleMatch && yearMatch
    })
    if (!match) return { found: false }
    return {
      found: true,
      monitored: match.monitored,
      downloaded: match.hasFile,
    }
  },
})
