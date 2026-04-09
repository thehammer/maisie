import { z } from 'zod'
import { defineAction, field } from '@maisie/shared'
import { getPlexClient } from './client'

const librarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  count: z.number(),
})

const nowPlayingSchema = z.object({
  title: z.string(),
  type: z.string(),
  year: z.number().optional(),
  seriesTitle: z.string().optional(),
  seasonEpisode: z.string().optional(),
  user: z.string(),
  player: z.string(),
  state: z.enum(['playing', 'paused', 'buffering']),
  transcoding: z.boolean(),
  progress: z.number(),
  duration: z.number(),
  /** Poster/cover art URL (full URL with token). */
  thumb: field(z.string().optional(), 'image'),
  /** Background art URL (full URL with token). */
  art: field(z.string().optional(), 'image'),
})

const mediaItemSchema = z.object({
  ratingKey: z.string(),
  title: z.string(),
  type: z.string(),
  year: z.number().optional(),
  seriesTitle: z.string().optional(),
  seasonEpisode: z.string().optional(),
  addedAt: z.string(),
  thumb: z.string().optional(),
})

const searchResultSchema = z.object({
  ratingKey: z.string(),
  title: z.string(),
  type: z.string(),
  year: z.number().optional(),
  thumb: z.string().optional(),
  grandparentTitle: z.string().optional(),
  parentIndex: z.number().optional(),
  index: z.number().optional(),
})

const showSchema = z.object({
  ratingKey: z.string(),
  title: z.string(),
  year: z.number().optional(),
  leafCount: z.number(),
  librarySection: z.string().optional(),
  libraryTitle: z.string().optional(),
})

const episodeSchema = z.object({
  ratingKey: z.string(),
  title: z.string(),
  parentIndex: z.number(),
  index: z.number(),
  duration: z.number(),
  filePath: z.string(),
  thumb: z.string().optional(),
})

function formatSeasonEpisode(parentIndex?: number, index?: number): string | undefined {
  if (parentIndex == null || index == null) return undefined
  return `S${String(parentIndex).padStart(2, '0')}E${String(index).padStart(2, '0')}`
}

export const getLibraries = defineAction({
  name: 'list_libraries',
  description: 'Get all Plex media libraries (movies, TV shows, music, etc.).',
  input: z.object({}),
  output: z.array(librarySchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Libraries', section: 'media' },
  async execute(_input, _ctx) {
    const plex = getPlexClient()
    if (!plex) throw new Error('Plex not configured')
    const libraries = await plex.getLibraries()
    for (const lib of libraries) {
      lib.count = await plex.getLibraryCount(lib.key)
    }
    return libraries.map((l) => ({
      id: l.key,
      name: l.title,
      type: l.type,
      count: l.count,
    }))
  },
})

export const getNowPlaying = defineAction({
  name: 'get_now_playing',
  description:
    'Get currently active Plex sessions — who is watching what, progress, player info.',
  input: z.object({}),
  output: z.array(nowPlayingSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Now Playing', section: 'media', realtimeTopic: 'home/media/plex/now_playing' },
  async execute(_input, _ctx) {
    const plex = getPlexClient()
    if (!plex) throw new Error('Plex not configured')
    const raw = await plex.getNowPlaying()
    return raw.map((m) => ({
      title: m.title,
      type: m.type,
      year: m.year,
      seriesTitle: m.grandparentTitle,
      seasonEpisode: formatSeasonEpisode(m.parentIndex, m.index),
      user: m.User.title,
      player: m.Player.title,
      state: (
        m.Player.state === 'playing'
          ? 'playing'
          : m.Player.state === 'paused'
            ? 'paused'
            : 'buffering'
      ) as 'playing' | 'paused' | 'buffering',
      transcoding: !!m.TranscodeSession,
      progress: m.viewOffset,
      duration: m.duration,
      thumb: m.thumb ? `/api/plex/image?path=${encodeURIComponent(m.thumb)}` : undefined,
      art: m.art ? `/api/plex/image?path=${encodeURIComponent(m.art)}` : undefined,
    }))
  },
})

export const getRecentlyAdded = defineAction({
  name: 'list_recently_added',
  description: 'Get recently added media from the Plex library.',
  input: z.object({
    limit: z.number().default(20),
    libraryId: z.string().optional(),
  }),
  output: z.array(mediaItemSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: {
    type: 'data',
    label: 'Recently Added',
    section: 'media',
    realtimeTopic: 'home/media/plex/recently_added',
  },
  async execute(input, _ctx) {
    const plex = getPlexClient()
    if (!plex) throw new Error('Plex not configured')
    const raw = await plex.getRecentlyAdded(input.limit)
    const isTv = (type: string) => type === 'season' || type === 'episode'
    return raw.map((m) => ({
      ratingKey: String(m.ratingKey ?? ''),
      title: m.title,
      type: isTv(m.type) ? 'episode' : m.type,
      year: m.year,
      seriesTitle: m.grandparentTitle || m.parentTitle,
      seasonEpisode: isTv(m.type)
        ? `S${String(m.parentIndex ?? 0).padStart(2, '0')}`
        : undefined,
      addedAt: new Date(m.addedAt * 1000).toISOString(),
      thumb: m.thumb,
    }))
  },
})

export const searchMedia = defineAction({
  name: 'list_media',
  description: 'Search the Plex library for movies, shows, or episodes by title.',
  input: z.object({
    query: z.string(),
    limit: z.number().default(10),
  }),
  output: z.array(searchResultSchema),
  http: { method: 'GET' },
  ai: {
    tier: 'inform',
    description: 'Search the Plex library for movies, shows, or episodes by title.',
  },
  ui: { type: 'data', label: 'Search Library', section: 'media' },
  async execute(input, _ctx) {
    const plex = getPlexClient()
    if (!plex) throw new Error('Plex not configured')
    return plex.search(input.query, input.limit)
  },
})

export const getPlexImage = defineAction({
  name: 'get_plex_image',
  description: 'Proxy a Plex image URL with authentication token.',
  input: z.object({ path: z.string() }),
  output: z.object({ url: z.string() }),
  http: { method: 'GET' },
  ai: false,
  ui: false,
  async execute(input, _ctx) {
    const plex = getPlexClient()
    if (!plex) throw new Error('Plex not configured')
    const url = await plex.getImageUrl(input.path)
    return { url }
  },
})

export const getShows = defineAction({
  name: 'list_shows',
  description: 'Get TV shows from the Plex library, optionally filtered by library section.',
  input: z.object({
    libraryId: z.string().optional(),
  }),
  output: z.array(showSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'TV Shows', section: 'media' },
  async execute(input, _ctx) {
    const plex = getPlexClient()
    if (!plex) throw new Error('Plex not configured')

    const libraries = await plex.getLibraries()
    const showSections = libraries.filter((l) =>
      input.libraryId ? l.key === input.libraryId : l.type === 'show',
    )

    const results: z.infer<typeof showSchema>[] = []
    for (const lib of showSections) {
      const shows = await plex.searchShows('', lib.key)
      results.push(
        ...shows.map((s) => ({
          ratingKey: s.ratingKey,
          title: s.title,
          year: s.year,
          leafCount: s.leafCount,
          librarySection: lib.key,
          libraryTitle: lib.title,
        })),
      )
    }
    return results
  },
})

export const getEpisodes = defineAction({
  name: 'list_episodes',
  description: 'Get episodes for a TV show, optionally filtered by season.',
  input: z.object({
    showId: z.string(),
    season: z.number().optional(),
  }),
  output: z.array(episodeSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: false,
  async execute(input, _ctx) {
    const plex = getPlexClient()
    if (!plex) throw new Error('Plex not configured')
    let episodes = await plex.getShowEpisodes(input.showId)
    if (input.season !== undefined) {
      episodes = episodes.filter((ep) => ep.parentIndex === input.season)
    }
    return episodes
  },
})

const onDeckItemSchema = z.object({
  title: z.string(),
  type: z.string(),
  seriesTitle: z.string().optional(),
  seasonEpisode: z.string().optional(),
  progress: field(z.number(), 'percentage'),
  thumb: field(z.string().optional(), 'image'),
})

const watchHistoryItemSchema = z.object({
  title: z.string(),
  type: z.string(),
  seriesTitle: z.string().optional(),
  viewedAt: field(z.number(), 'timestamp'),
  accountId: z.number().optional(),
})

export const getOnDeck = defineAction({
  name: 'list_on_deck',
  description: 'Get on-deck content — in-progress or next to watch across all Plex libraries.',
  input: z.object({}),
  output: z.array(onDeckItemSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Get on-deck content — in-progress or next to watch' },
  ui: { type: 'data', label: 'On Deck', section: 'media' },
  async execute(_input, _ctx) {
    const plex = getPlexClient()
    if (!plex) throw new Error('Plex not configured')
    const raw = await plex.getOnDeck()
    return raw.map((m) => ({
      title: m.title,
      type: m.type,
      seriesTitle: m.grandparentTitle,
      seasonEpisode: formatSeasonEpisode(m.parentIndex, m.index),
      progress:
        m.viewOffset != null && m.duration
          ? Math.round((m.viewOffset / m.duration) * 100)
          : 0,
      thumb: m.thumb,
    }))
  },
})

export const getWatchHistory = defineAction({
  name: 'list_watch_history',
  description: 'Get recent watch history across all Plex users.',
  input: z.object({}),
  output: z.array(watchHistoryItemSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Get recent watch history' },
  ui: { type: 'data', label: 'Watch History', section: 'media' },
  async execute(_input, _ctx) {
    const plex = getPlexClient()
    if (!plex) throw new Error('Plex not configured')
    const raw = await plex.getWatchHistory()
    return raw.map((m) => ({
      title: m.title,
      type: m.type,
      seriesTitle: m.grandparentTitle,
      viewedAt: m.viewedAt,
      accountId: m.accountId,
    }))
  },
})

export const getPlexStatus = defineAction({
  name: 'get_plex_status',
  description: 'Get combined Plex server status: server info, libraries, now playing, and recently added.',
  input: z.object({}),
  output: z.object({
    name: z.string(),
    version: z.string(),
    online: z.boolean(),
    libraries: z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), count: z.number() })),
    nowPlaying: z.array(z.any()),
    recentlyAdded: z.array(z.any()),
    timestamp: z.string(),
  }),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Plex Status', section: 'media', realtimeTopic: 'home/media/plex/now_playing' },
  async execute(_input, _ctx) {
    const plex = getPlexClient()
    if (!plex) throw new Error('Plex not configured')
    const { getPlexStatus: fetchStatus } = await import('../../agent/src/skills/media/plex-status')
    return fetchStatus(plex)
  },
})
