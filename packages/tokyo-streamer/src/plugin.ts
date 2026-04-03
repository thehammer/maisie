import { defineAction, defineEvent } from '@maisie/shared'
import { z } from 'zod'
import type { MaisiePlugin } from '@maisie/shared'

const getActiveStreams = defineAction({
  name: 'get_active_streams',
  description: 'Get currently active GPU transcoding sessions.',
  input: z.object({}),
  output: z.array(z.object({
    id: z.string(),
    channelNumber: z.number().optional(),
    codec: z.string(),
    startedAt: z.string(),
  })),
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Check what streams are currently using the GPU transcoder.' },
  ui: { label: 'Active Streams', section: 'system' },
  async execute(_, _ctx) {
    return []
  },
})

const getStreamHealth = defineAction({
  name: 'get_stream_health',
  description: 'Check the health of the GPU transcoding service.',
  input: z.object({}),
  output: z.object({ healthy: z.boolean(), activeStreams: z.number(), maxStreams: z.number() }),
  http: { method: 'GET' },
  ai: false,  // infrastructure — not useful to AI
  ui: { label: 'Streamer Health', section: 'system' },
  async execute(_, _ctx) {
    return { healthy: true, activeStreams: 0, maxStreams: 2 }
  },
})

const nvencLimitReached = defineEvent({
  name: 'nvenc_limit_reached',
  description: 'GTX 1050 Ti NVENC session limit reached (max 2 concurrent)',
  schema: z.object({ activeSessions: z.number() }),
  topic: 'home/streamer/nvenc_limit',
  ai: { tier: 'advise', context: 'GPU encoding limit reached — new streams will fail until one ends.' },
  ui: { realtime: true, notify: true },
})

const streamFailed = defineEvent({
  name: 'stream_failed',
  description: 'A transcoding stream failed',
  schema: z.object({ streamId: z.string(), error: z.string() }),
  topic: 'home/streamer/error',
  ai: { tier: 'advise', context: 'Stream encoding error.' },
  ui: { realtime: true, notify: true },
})

export const tokyoStreamerPlugin: MaisiePlugin = {
  name: 'tokyo-streamer',
  version: '0.1.0',
  description: 'GPU-accelerated ffmpeg transcoding service (HLS/MPEG-TS)',
  capabilities: [],
  envVars: [
    { name: 'STREAMER_PORT', required: false, description: 'Streamer service port', example: '8888' },
  ],
  actions: [getActiveStreams, getStreamHealth],
  events: [nvencLimitReached, streamFailed],
  async init(core) {
    core.log('tokyo-streamer', 'info', 'Tokyo Streamer plugin registered')
  },
  async shutdown() {},
  async healthCheck() {
    try {
      const port = process.env.STREAMER_PORT ?? '8888'
      const res = await fetch(`http://localhost:${port}/health`)
      if (res.ok) return { status: 'healthy', lastCheck: new Date() }
      return { status: 'degraded', message: 'Health check failed', lastCheck: new Date() }
    } catch {
      return { status: 'offline', message: 'Tokyo Streamer not reachable', lastCheck: new Date() }
    }
  },
}

export default tokyoStreamerPlugin
