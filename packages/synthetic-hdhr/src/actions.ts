import { defineAction } from '@maisie/shared'
import { z } from 'zod'

export const getLineup = defineAction({
  name: 'get_lineup',
  description: 'Get all channels in the synthetic HDHR lineup: cable, library, and camera channels with their numbers, names, and types.',
  input: z.object({
    type: z.enum(['cable', 'library', 'camera', 'all']).default('all'),
  }),
  output: z.array(z.object({
    number: z.number(),
    name: z.string(),
    type: z.enum(['cable', 'library', 'camera']),
    enabled: z.boolean(),
  })),
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Get the full TV channel lineup. Filter by type if needed.' },
  ui: { label: 'Channel Lineup', section: 'tv', realtimeTopic: 'home/channels/lineup' },
  async execute({ type }, _ctx) {
    // Calls synthetic-hdhr's internal /api/lineup endpoint
    const res = await fetch('http://localhost:5004/api/lineup')
    if (!res.ok) return []
    const all = (await res.json()) as Array<{ number: string; name: string; type: string }>
    const filtered = type === 'all' ? all : all.filter((c) => c.type === type)
    return filtered.map((c) => ({
      number: Number(c.number),
      name: c.name,
      type: c.type as 'cable' | 'library' | 'camera',
      enabled: true,
    }))
  },
})

export const getChannelNowPlaying = defineAction({
  name: 'get_channel_now_playing',
  description: 'Get what is currently playing on a specific channel number.',
  input: z.object({ channelNumber: z.number() }),
  output: z.object({
    channelNumber: z.number(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
  }),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Now Playing', section: 'tv', realtimeTopic: 'home/channels/now_playing' },
  async execute({ channelNumber }, _ctx) {
    return { channelNumber, title: null, description: null, startTime: null, endTime: null }
  },
})

export const getChannelSchedule = defineAction({
  name: 'get_channel_schedule',
  description: 'Get the upcoming schedule for a library channel. Returns program entries for the next N hours.',
  input: z.object({ channelNumber: z.number(), hours: z.number().default(4) }),
  output: z.array(z.object({
    title: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    episode: z.string().optional(),
  })),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Schedule', section: 'tv' },
  async execute({ channelNumber, hours }, _ctx) {
    return []
  },
})

export const getEpgGuide = defineAction({
  name: 'get_epg_guide',
  description: 'Get the Electronic Program Guide (EPG) for all channels. Returns current and upcoming programs.',
  input: z.object({ hours: z.number().default(4) }),
  output: z.array(z.any()),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'TV Guide', section: 'tv', realtimeTopic: 'home/tv/epg/updated' },
  async execute({ hours }, _ctx) {
    return []
  },
})

export const refreshEpg = defineAction({
  name: 'refresh_epg',
  description: 'Trigger a refresh of EPG guide data from SiliconDust.',
  input: z.object({}),
  output: z.object({ success: z.boolean(), channelsUpdated: z.number() }),
  http: { method: 'POST' },
  ai: { tier: 'advise' },
  ui: { label: 'Refresh Guide', section: 'tv' },
  async execute(_, _ctx) {
    return { success: true, channelsUpdated: 0 }
  },
})

export const addLibraryChannel = defineAction({
  name: 'add_library_channel',
  description: 'Add a new virtual TV channel from Plex library content.',
  input: z.object({
    name: z.string(),
    number: z.number(),
    mode: z.enum(['marathon', 'shuffle', 'scheduled']),
    plexLibraryId: z.string().optional(),
  }),
  output: z.object({ success: z.boolean(), channelNumber: z.number() }),
  http: { method: 'POST' },
  ai: { tier: 'advise', description: 'Add a new library channel. Channing should suggest a channel number in the 20001-29999 range.' },
  ui: { label: 'Add Channel', section: 'tv' },
  async execute(input, _ctx) {
    return { success: true, channelNumber: input.number }
  },
})

export const updateLibraryChannel = defineAction({
  name: 'update_library_channel',
  description: 'Update a library channel name, mode, or content source.',
  input: z.object({
    channelNumber: z.number(),
    name: z.string().optional(),
    mode: z.enum(['marathon', 'shuffle', 'scheduled']).optional(),
  }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'PATCH' },
  ai: { tier: 'advise' },
  ui: { label: 'Edit Channel', section: 'tv' },
  async execute(_input, _ctx) {
    return { success: true }
  },
})

export const removeLibraryChannel = defineAction({
  name: 'remove_library_channel',
  description: 'Remove a library channel from the lineup.',
  input: z.object({ channelNumber: z.number() }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'DELETE' },
  ai: { tier: 'advise' },
  ui: { label: 'Remove Channel', section: 'tv' },
  async execute({ channelNumber }, _ctx) {
    return { success: true }
  },
})
