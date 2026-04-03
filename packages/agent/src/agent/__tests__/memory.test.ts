import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { createMemoryStore } from '../memory'
import * as schema from '../../services/schema'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE agent_episodes (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      trigger TEXT NOT NULL,
      persona TEXT NOT NULL,
      summary TEXT NOT NULL,
      tools_used TEXT,
      outcome TEXT NOT NULL,
      user_approved INTEGER
    );
    CREATE TABLE agent_facts (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      confidence REAL,
      source TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE agent_preferences (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  return drizzle(sqlite, { schema })
}

describe('MemoryStore', () => {
  let store: ReturnType<typeof createMemoryStore>

  beforeEach(() => {
    store = createMemoryStore(makeDb())
  })

  test('logEpisode and getRecentEpisodes round-trip', async () => {
    const episode = {
      id: 'ep-1',
      timestamp: new Date('2025-01-01T00:00:00Z'),
      trigger: 'home/network/devices/new',
      persona: 'natalie',
      summary: 'A new device appeared',
      toolsUsed: ['get_devices'],
      outcome: 'advised' as const,
    }

    await store.logEpisode(episode)
    const results = await store.getRecentEpisodes(10)

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('ep-1')
    expect(results[0].trigger).toBe('home/network/devices/new')
    expect(results[0].persona).toBe('natalie')
    expect(results[0].summary).toBe('A new device appeared')
    expect(results[0].toolsUsed).toEqual(['get_devices'])
    expect(results[0].outcome).toBe('advised')
  })

  test('getRecentEpisodes filters by persona', async () => {
    await store.logEpisode({
      id: 'ep-1', timestamp: new Date(), trigger: 'home/network/devices/new',
      persona: 'natalie', summary: 'Network event', toolsUsed: [], outcome: 'advised',
    })
    await store.logEpisode({
      id: 'ep-2', timestamp: new Date(), trigger: 'home/calibre/book_added',
      persona: 'alexandria', summary: 'Book event', toolsUsed: [], outcome: 'informed',
    })

    const natalieEpisodes = await store.getRecentEpisodes(10, 'natalie')
    expect(natalieEpisodes).toHaveLength(1)
    expect(natalieEpisodes[0].persona).toBe('natalie')

    const alexandriaEpisodes = await store.getRecentEpisodes(10, 'alexandria')
    expect(alexandriaEpisodes).toHaveLength(1)
    expect(alexandriaEpisodes[0].persona).toBe('alexandria')
  })

  test('setFact and getFact round-trip', async () => {
    await store.setFact('wan.provider', 'Comcast', { confidence: 0.95, source: 'natalie' })
    const value = await store.getFact('wan.provider')
    expect(value).toBe('Comcast')
  })

  test('getFact returns null for unknown key', async () => {
    const value = await store.getFact('nonexistent.key')
    expect(value).toBeNull()
  })

  test('setFact updates existing key', async () => {
    await store.setFact('device.count', 42)
    await store.setFact('device.count', 45)
    const value = await store.getFact('device.count')
    expect(value).toBe(45)
  })

  test('getAllFacts returns all stored facts', async () => {
    await store.setFact('wan.provider', 'Comcast')
    await store.setFact('device.count', 42)

    const facts = await store.getAllFacts()
    expect(Object.keys(facts)).toHaveLength(2)
    expect(facts['wan.provider']).toBe('Comcast')
    expect(facts['device.count']).toBe(42)
  })

  test('setPreference and getPreferences by domain', async () => {
    await store.setPreference('network', 'alert_new_devices', true)
    await store.setPreference('network', 'scan_interval_minutes', 5)
    await store.setPreference('media', 'default_quality', '1080p')

    const networkPrefs = await store.getPreferences('network')
    expect(Object.keys(networkPrefs)).toHaveLength(2)
    expect(networkPrefs['network:alert_new_devices']).toBe(true)
    expect(networkPrefs['network:scan_interval_minutes']).toBe(5)

    const mediaPrefs = await store.getPreferences('media')
    expect(Object.keys(mediaPrefs)).toHaveLength(1)
    expect(mediaPrefs['media:default_quality']).toBe('1080p')
  })

  test('getPreferences without domain returns all', async () => {
    await store.setPreference('network', 'alert_new_devices', true)
    await store.setPreference('media', 'default_quality', '1080p')

    const all = await store.getPreferences()
    expect(Object.keys(all)).toHaveLength(2)
  })
})
