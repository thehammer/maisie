import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { eq, desc } from 'drizzle-orm'
import { agentEpisodes, agentFacts, agentPreferences } from '../services/schema'

export interface Episode {
  id: string
  timestamp: Date
  trigger: string
  persona: string
  summary: string
  toolsUsed: string[]
  outcome: 'informed' | 'advised' | 'acted'
  userApproved?: boolean
}

export function createMemoryStore(db: BunSQLiteDatabase<any>) {
  async function logEpisode(episode: Episode): Promise<void> {
    await db.insert(agentEpisodes).values({
      id: episode.id,
      timestamp: episode.timestamp,
      trigger: episode.trigger,
      persona: episode.persona,
      summary: episode.summary,
      toolsUsed: JSON.stringify(episode.toolsUsed),
      outcome: episode.outcome,
      userApproved: episode.userApproved ?? null,
    })
  }

  async function getRecentEpisodes(limit = 10, persona?: string): Promise<Episode[]> {
    const rows = persona
      ? await db.select().from(agentEpisodes)
          .where(eq(agentEpisodes.persona, persona))
          .orderBy(desc(agentEpisodes.timestamp))
          .limit(limit)
      : await db.select().from(agentEpisodes)
          .orderBy(desc(agentEpisodes.timestamp))
          .limit(limit)

    return rows.map((row: typeof agentEpisodes.$inferSelect) => ({
      id: row.id,
      timestamp: row.timestamp as Date,
      trigger: row.trigger,
      persona: row.persona,
      summary: row.summary,
      toolsUsed: row.toolsUsed ? JSON.parse(row.toolsUsed) : [],
      outcome: row.outcome as Episode['outcome'],
      userApproved: row.userApproved ?? undefined,
    }))
  }

  async function setFact(key: string, value: unknown, options?: { confidence?: number; source?: string }): Promise<void> {
    const now = new Date()
    await db.insert(agentFacts)
      .values({
        id: crypto.randomUUID(),
        key,
        value: JSON.stringify(value),
        confidence: options?.confidence ?? null,
        source: options?.source ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: agentFacts.key,
        set: {
          value: JSON.stringify(value),
          confidence: options?.confidence ?? null,
          source: options?.source ?? null,
          updatedAt: now,
        },
      })
  }

  async function getFact(key: string): Promise<unknown | null> {
    const row = await db.select().from(agentFacts).where(eq(agentFacts.key, key)).limit(1)
    if (!row[0]) return null
    return JSON.parse(row[0].value)
  }

  async function getAllFacts(): Promise<Record<string, unknown>> {
    const rows = await db.select().from(agentFacts)
    return Object.fromEntries(rows.map((r: typeof agentFacts.$inferSelect) => [r.key, JSON.parse(r.value)]))
  }

  async function setPreference(domain: string, key: string, value: unknown): Promise<void> {
    const now = new Date()
    const compositeKey = `${domain}:${key}`
    await db.insert(agentPreferences)
      .values({
        id: crypto.randomUUID(),
        domain,
        key: compositeKey,
        value: JSON.stringify(value),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: agentPreferences.key,
        set: { value: JSON.stringify(value), updatedAt: now },
      })
  }

  async function getPreferences(domain?: string): Promise<Record<string, unknown>> {
    const rows = domain
      ? await db.select().from(agentPreferences).where(eq(agentPreferences.domain, domain))
      : await db.select().from(agentPreferences)
    return Object.fromEntries(rows.map((r: typeof agentPreferences.$inferSelect) => [r.key, JSON.parse(r.value)]))
  }

  return { logEpisode, getRecentEpisodes, setFact, getFact, getAllFacts, setPreference, getPreferences }
}

export type MemoryStore = ReturnType<typeof createMemoryStore>
