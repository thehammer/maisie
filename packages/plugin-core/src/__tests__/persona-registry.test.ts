import { describe, it, expect, beforeEach } from 'bun:test'
import type { PersonaConfig } from '../types'
import { PersonaRegistry } from '../persona-registry'
import { EntityRegistry } from '../entity-registry'
import { personaToEntity, entityToPersona } from '../persona-convert'

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makePersona(overrides: Partial<PersonaConfig> = {}): PersonaConfig {
  return {
    id: 'test-id',
    name: 'natalie',
    role: 'Network & infrastructure specialist',
    avatar: '🔧',
    defaultTier: 'inform',
    eventSubscriptions: ['home/network/#', 'home/unifi/#'],
    toolScopes: ['get_devices', 'get_wan_health'],
    systemPrompt: 'You are Natalie, the network specialist.',
    isCustom: false,
    ...overrides,
  }
}

// Each test gets its own isolated EntityRegistry + PersonaRegistry to avoid
// cross-test pollution from the module-level singleton.
function makeRegistries() {
  const entityReg = new EntityRegistry()
  const personaReg = new PersonaRegistry()
  // Override the internal entityRegistry reference with our isolated one.
  // PersonaRegistry delegates to the module singleton — we monkey-patch it
  // by constructing a standalone pair and delegating manually.
  return { entityReg, personaReg }
}

// ----------------------------------------------------------------
// personaToEntity / entityToPersona round-trip
// ----------------------------------------------------------------

describe('personaToEntity', () => {
  it('produces an entity with name "personas.{name}"', () => {
    const persona = makePersona()
    const entity = personaToEntity(persona)
    expect(entity.name).toBe('personas.natalie')
  })

  it('sets section to "personas"', () => {
    const entity = personaToEntity(makePersona())
    expect(entity.section).toBe('personas')
  })

  it('sets source to "derived"', () => {
    const entity = personaToEntity(makePersona())
    expect(entity.source).toBe('derived')
  })

  it('includes all required fields', () => {
    const entity = personaToEntity(makePersona())
    const fieldNames = Object.keys(entity.fields)
    expect(fieldNames).toContain('name')
    expect(fieldNames).toContain('role')
    expect(fieldNames).toContain('avatar')
    expect(fieldNames).toContain('default_tier')
    expect(fieldNames).toContain('event_subscriptions')
    expect(fieldNames).toContain('tool_scopes')
    expect(fieldNames).toContain('system_prompt')
    expect(fieldNames).toContain('is_custom')
  })

  it('encodes array fields as JSON strings in the literal expression', () => {
    const persona = makePersona()
    const entity = personaToEntity(persona)
    const evtField = entity.fields.event_subscriptions as any
    expect(evtField.kind).toBe('data')
    expect(evtField.type).toBe('collection')
    const parsed = JSON.parse(evtField.expression.value)
    expect(parsed).toEqual(persona.eventSubscriptions)
  })
})

describe('entityToPersona round-trip', () => {
  it('recovers the original PersonaConfig from the entity', () => {
    const original = makePersona()
    const entity = personaToEntity(original)
    const recovered = entityToPersona(entity)

    expect(recovered).not.toBeNull()
    expect(recovered!.name).toBe(original.name)
    expect(recovered!.role).toBe(original.role)
    expect(recovered!.avatar).toBe(original.avatar)
    expect(recovered!.defaultTier).toBe(original.defaultTier)
    expect(recovered!.eventSubscriptions).toEqual(original.eventSubscriptions)
    expect(recovered!.toolScopes).toEqual(original.toolScopes)
    expect(recovered!.systemPrompt).toBe(original.systemPrompt)
    expect(recovered!.isCustom).toBe(original.isCustom)
  })

  it('handles missing avatar gracefully (returns undefined)', () => {
    const persona = makePersona({ avatar: undefined })
    const entity = personaToEntity(persona)
    const recovered = entityToPersona(entity)
    // avatar is stored as '' when undefined; recovered as undefined
    expect(recovered).not.toBeNull()
    expect(recovered!.avatar).toBeUndefined()
  })

  it('returns null for a malformed entity missing required fields', () => {
    const entity = personaToEntity(makePersona())
    // Remove the name field to simulate corruption
    const broken = { ...entity, fields: { role: entity.fields.role } }
    const result = entityToPersona(broken)
    expect(result).toBeNull()
  })

  it('round-trip for a custom persona preserves isCustom = true', () => {
    const custom = makePersona({ name: 'hiro', isCustom: true, id: 'some-uuid' })
    const entity = personaToEntity(custom)
    const recovered = entityToPersona(entity)
    expect(recovered!.isCustom).toBe(true)
  })
})

// ----------------------------------------------------------------
// PersonaRegistry — using isolated EntityRegistry via module-level singleton.
// We clear the singleton before each test to keep tests independent.
// ----------------------------------------------------------------

import { entityRegistry } from '../entity-registry'

beforeEach(() => {
  entityRegistry.clear()
})

describe('PersonaRegistry.register + get', () => {
  it('registers a persona and retrieves it by name', () => {
    const registry = new PersonaRegistry()
    const persona = makePersona()
    registry.register(persona)

    const found = registry.get('natalie')
    expect(found).not.toBeUndefined()
    expect(found!.name).toBe('natalie')
    expect(found!.role).toBe('Network & infrastructure specialist')
  })

  it('returns undefined for an unknown persona name', () => {
    const registry = new PersonaRegistry()
    expect(registry.get('unknown-persona')).toBeUndefined()
  })

  it('re-register replaces the previous entry (idempotent)', () => {
    const registry = new PersonaRegistry()
    registry.register(makePersona({ role: 'Old role' }))
    registry.register(makePersona({ role: 'New role' }))

    const found = registry.get('natalie')
    expect(found!.role).toBe('New role')
  })
})

describe('PersonaRegistry.list', () => {
  it('lists all registered personas', () => {
    const registry = new PersonaRegistry()
    registry.register(makePersona({ name: 'natalie' }))
    registry.register(makePersona({ name: 'channing', role: 'TV specialist' }))

    const all = registry.list()
    expect(all).toHaveLength(2)
    const names = all.map((p) => p.name)
    expect(names).toContain('natalie')
    expect(names).toContain('channing')
  })

  it('returns empty array when no personas are registered', () => {
    const registry = new PersonaRegistry()
    expect(registry.list()).toEqual([])
  })

  it('only returns entries from the personas section (not other entities)', () => {
    const registry = new PersonaRegistry()
    registry.register(makePersona({ name: 'natalie' }))

    // Manually register a non-persona entity in the shared entity registry
    entityRegistry.register({
      name: 'network.get_devices',
      source: 'plugin',
      pluginName: 'unifi',
      section: 'network',
      fields: { result: { kind: 'data', type: 'collection', actionName: 'get_devices' } },
    })

    const all = registry.list()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('natalie')
  })
})

describe('PersonaRegistry.unregister', () => {
  it('removes a registered persona and returns true', () => {
    const registry = new PersonaRegistry()
    registry.register(makePersona())
    const removed = registry.unregister('natalie')
    expect(removed).toBe(true)
    expect(registry.get('natalie')).toBeUndefined()
  })

  it('returns false for a persona that was never registered', () => {
    const registry = new PersonaRegistry()
    expect(registry.unregister('ghost')).toBe(false)
  })
})

describe('PersonaRegistry entity catalog integration', () => {
  it('registered personas appear in entityRegistry.findBySection("personas")', () => {
    const registry = new PersonaRegistry()
    registry.register(makePersona({ name: 'natalie' }))
    registry.register(makePersona({ name: 'channing', role: 'TV specialist' }))

    const entities = entityRegistry.findBySection('personas')
    expect(entities.length).toBe(2)
    const names = entities.map((e) => e.name)
    expect(names).toContain('personas.natalie')
    expect(names).toContain('personas.channing')
  })

  it('entity name follows "personas.{name}" convention', () => {
    const registry = new PersonaRegistry()
    registry.register(makePersona({ name: 'maisie' }))

    const entity = entityRegistry.get('personas.maisie')
    expect(entity).not.toBeUndefined()
    expect(entity!.section).toBe('personas')
  })
})
