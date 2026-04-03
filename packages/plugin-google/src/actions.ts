import { z } from 'zod'
import { defineAction } from '@maisie/shared'
import type { GoogleAuth } from './auth'
import { getRecentEmails, getUnreadCount } from './gmail'
import { getUpcomingEvents } from './calendar'
import { getSubscriptions } from './youtube'
import { runCleanup, getStatus as getCleanupStatus } from './youtube-cleanup'

let _auth: GoogleAuth | null = null

export function setAuth(auth: GoogleAuth | null) {
  _auth = auth
}

function getAuth(): GoogleAuth {
  if (!_auth) throw new Error('Google not authorized — visit /api/google-auth/auth to connect')
  return _auth
}

const messageSchema = z.object({
  id: z.string(),
  snippet: z.string(),
  from: z.string(),
  subject: z.string(),
  date: z.string(),
  unread: z.boolean(),
  labelIds: z.array(z.string()),
})

const eventSchema = z.object({
  id: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  status: z.string(),
  calendarId: z.string(),
  calendarName: z.string().optional(),
})

const subscriptionSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  title: z.string(),
  description: z.string(),
  thumbnail: z.string(),
  publishedAt: z.string(),
})

export const getAuthStatus = defineAction({
  name: 'get_auth_status',
  description: 'Check whether Google OAuth is connected and which account is authorized.',
  input: z.object({}),
  output: z.object({ isAuthenticated: z.boolean(), email: z.string().optional() }),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Google Auth', section: 'integrations' },
  async execute(_input, _ctx) {
    if (!_auth) return { isAuthenticated: false }
    const isAuthenticated = _auth.isAuthorized()
    if (!isAuthenticated) return { isAuthenticated: false }
    // Try to get email from the token info
    try {
      const info = await _auth.apiRequest('https://www.googleapis.com/oauth2/v2/userinfo')
      return { isAuthenticated: true, email: info.email }
    } catch {
      return { isAuthenticated: true }
    }
  },
})

export const getUnreadEmails = defineAction({
  name: 'get_unread_emails',
  description: 'Get count and preview of unread Gmail messages.',
  input: z.object({ limit: z.number().default(10) }),
  output: z.object({ unreadCount: z.number(), messages: z.array(z.any()) }),
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Get count and preview of unread Gmail messages.' },
  ui: { label: 'Inbox', section: 'personal' },
  async execute(input, _ctx) {
    const auth = getAuth()
    const [unreadCount, messages] = await Promise.all([
      getUnreadCount(auth),
      getRecentEmails(auth, input.limit),
    ])
    const unread = messages.filter(m => m.unread)
    return { unreadCount, messages: unread }
  },
})

export const searchEmails = defineAction({
  name: 'search_emails',
  description: 'Search Gmail for messages matching a query.',
  input: z.object({ query: z.string(), limit: z.number().default(10) }),
  output: z.array(messageSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Search Gmail for messages matching a query.' },
  ui: { label: 'Search Email', section: 'personal' },
  async execute(input, _ctx) {
    const auth = getAuth()
    // getRecentEmails doesn't take a query — bridge via Gmail search API directly
    const params = new URLSearchParams({
      q: input.query,
      maxResults: String(input.limit),
    })
    const list = await auth.apiRequest(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    )
    if (!list.messages || list.messages.length === 0) return []

    const emails = []
    for (const msg of list.messages) {
      const detail = await auth.apiRequest(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      )
      const headers = detail.payload?.headers || []
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || ''
      emails.push({
        id: detail.id,
        snippet: detail.snippet,
        from: getHeader('From'),
        subject: getHeader('Subject'),
        date: getHeader('Date'),
        unread: detail.labelIds?.includes('UNREAD') ?? false,
        labelIds: detail.labelIds || [],
      })
    }
    return emails
  },
})

export const getUpcomingCalendarEvents = defineAction({
  name: 'get_upcoming_events',
  description: 'Get Google Calendar events for the next N days.',
  input: z.object({ days: z.number().default(7) }),
  output: z.array(eventSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Get Google Calendar events for the next N days.' },
  ui: { label: 'Calendar', section: 'personal', realtimeTopic: 'home/google/calendar/+' },
  async execute(input, _ctx) {
    return getUpcomingEvents(getAuth(), input.days)
  },
})

export const getYoutubeSubscriptions = defineAction({
  name: 'get_youtube_subscriptions',
  description: 'Get all YouTube channel subscriptions.',
  input: z.object({}),
  output: z.array(subscriptionSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Subscriptions', section: 'personal' },
  async execute(_input, _ctx) {
    return getSubscriptions(getAuth())
  },
})

export const cleanupYoutube = defineAction({
  name: 'cleanup_youtube',
  description: 'Run YouTube cleanup — removes old subscriptions and liked videos. Irreversible, requires confirmation.',
  input: z.object({ dryRun: z.boolean().default(true) }),
  output: z.object({ removed: z.number(), dryRun: z.boolean() }),
  http: { method: 'POST' },
  ai: { tier: 'advise', description: 'Run YouTube cleanup — removes old subscriptions and liked videos. Irreversible, requires confirmation.' },
  ui: { label: 'Cleanup YouTube', section: 'personal' },
  async execute(input, _ctx) {
    if (input.dryRun) {
      const status = getCleanupStatus()
      return {
        removed: 0,
        dryRun: true,
      }
    }
    const auth = getAuth()
    const result = await runCleanup(auth)
    return {
      removed: result.likesRemovedTotal + result.subsRemovedTotal,
      dryRun: false,
    }
  },
})
