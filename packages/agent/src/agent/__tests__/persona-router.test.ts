import { describe, test, expect } from 'bun:test'
import { createPersonaRouter } from '../persona-router'
import type { MaisiePlugin, AgentPersona } from '@maisie/shared'

const natalie: AgentPersona = {
  name: 'Natalie',
  role: 'Network specialist',
  avatar: '🌐',
  defaultTier: 'advise',
  eventSubscriptions: ['home/network/#', 'home/protect/#', 'home/nas/#'],
  toolScopes: ['get_devices', 'get_wan_health'],
  systemPrompt: 'You are Natalie.',
}

const channing: AgentPersona = {
  name: 'Channing',
  role: 'TV specialist',
  avatar: '📺',
  defaultTier: 'advise',
  eventSubscriptions: ['home/media/plex/#', 'home/tv/#', 'home/channels/#'],
  toolScopes: ['get_lineup'],
  systemPrompt: 'You are Channing.',
}

const alexandria: AgentPersona = {
  name: 'Alexandria',
  role: 'Books specialist',
  avatar: '📚',
  defaultTier: 'advise',
  eventSubscriptions: ['home/calibre/#', 'home/books/#'],
  toolScopes: ['search_books'],
  systemPrompt: 'You are Alexandria.',
}

function makePlugin(name: string, persona: AgentPersona): MaisiePlugin {
  return {
    name,
    version: '0.1.0',
    description: 'Test',
    capabilities: [],
    envVars: [],
    actions: [],
    events: [],
    persona,
    async init() {},
    async shutdown() {},
    async healthCheck() { return { status: 'healthy', lastCheck: new Date() } },
  }
}

const plugins = [
  makePlugin('unifi', natalie),
  makePlugin('synthetic-hdhr', channing),
  makePlugin('calibre', alexandria),
]

describe('PersonaRouter', () => {
  const router = createPersonaRouter(plugins)

  test('routes network events to Natalie', () => {
    const persona = router.routeEvent('home/network/devices/new')
    expect(persona).not.toBeNull()
    expect(persona!.name).toBe('Natalie')
  })

  test('routes protect events to Natalie', () => {
    const persona = router.routeEvent('home/protect/motion')
    expect(persona).not.toBeNull()
    expect(persona!.name).toBe('Natalie')
  })

  test('routes media events to Channing', () => {
    const persona = router.routeEvent('home/media/plex/now_playing')
    expect(persona).not.toBeNull()
    expect(persona!.name).toBe('Channing')
  })

  test('routes calibre events to Alexandria', () => {
    const persona = router.routeEvent('home/calibre/book_added')
    expect(persona).not.toBeNull()
    expect(persona!.name).toBe('Alexandria')
  })

  test('returns null for unsubscribed topics (Maisie handles)', () => {
    const persona = router.routeEvent('home/smarthome/lights/on')
    expect(persona).toBeNull()
  })

  test('routes @Natalie messages to Natalie', () => {
    const persona = router.routeMessage('@Natalie what devices are online?')
    expect(persona).not.toBeNull()
    expect(persona!.name).toBe('Natalie')
  })

  test('routes @Channing messages to Channing', () => {
    const persona = router.routeMessage('@Channing what is on channel 20001?')
    expect(persona).not.toBeNull()
    expect(persona!.name).toBe('Channing')
  })

  test('routes @Alexandria messages to Alexandria', () => {
    const persona = router.routeMessage('@Alexandria find me a book about gardening')
    expect(persona).not.toBeNull()
    expect(persona!.name).toBe('Alexandria')
  })

  test('@mention is case-insensitive', () => {
    const persona = router.routeMessage('@natalie check the network')
    expect(persona).not.toBeNull()
    expect(persona!.name).toBe('Natalie')
  })

  test('returns null for unknown persona @mention', () => {
    const persona = router.routeMessage('@Unknown do something')
    expect(persona).toBeNull()
  })

  test('returns null for unaddressed messages (Maisie handles)', () => {
    const persona = router.routeMessage('Is everything okay?')
    expect(persona).toBeNull()
  })

  test('exposes loaded personas list', () => {
    expect(router.personas).toHaveLength(3)
    const names = router.personas.map(p => p.persona.name)
    expect(names).toContain('Natalie')
    expect(names).toContain('Channing')
    expect(names).toContain('Alexandria')
  })
})
