/**
 * Tests for the synthetic memory entity (Phase 4d).
 *
 * The memory entity is registered at EntityRegistry construction time.
 * Its fields dispatch via sentinels that the address resolver intercepts,
 * routing to memory operations provided in the actionContext.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { EntityRegistry, entityRegistry } from '../entity-registry'
import { createAddressResolver } from '../address-resolver'
import type { MaisieRecord } from '@maisie/shared'

// ── Memory entity — registry registration ─────────────────────────────────────

describe('memory entity — registry registration', () => {
  it('every new EntityRegistry includes a memory entity', () => {
    const reg = new EntityRegistry()
    const memory = reg.get('memory')

    expect(memory).toBeDefined()
    expect(memory!.name).toBe('memory')
    expect(memory!.source).toBe('plugin')
    expect(memory!.pluginName).toBe('core')
    expect(memory!.section).toBe('agent')
  })

  it('memory entity has conversations field as collection', () => {
    const reg = new EntityRegistry()
    const memory = reg.get('memory')!
    const field = memory.fields.conversations

    expect(field).toBeDefined()
    expect(field.kind).toBe('data')
    if (field.kind === 'data') {
      expect(field.type).toBe('collection')
      expect(field.actionName).toBe('__memory_conversations')
    }
  })

  it('memory entity has notes field as collection', () => {
    const reg = new EntityRegistry()
    const memory = reg.get('memory')!
    const field = memory.fields.notes

    expect(field).toBeDefined()
    expect(field.kind).toBe('data')
    if (field.kind === 'data') {
      expect(field.type).toBe('collection')
      expect(field.actionName).toBe('__memory_notes')
    }
  })

  it('memory entity has facts field as record', () => {
    const reg = new EntityRegistry()
    const memory = reg.get('memory')!
    const field = memory.fields.facts

    expect(field).toBeDefined()
    expect(field.kind).toBe('data')
    if (field.kind === 'data') {
      expect(field.type).toBe('record')
      expect(field.actionName).toBe('__memory_facts')
    }
  })

  it('memory entity has append_note function field at inform tier', () => {
    const reg = new EntityRegistry()
    const memory = reg.get('memory')!
    const field = memory.fields.append_note

    expect(field).toBeDefined()
    expect(field.kind).toBe('function')
    if (field.kind === 'function') {
      expect(field.tier).toBe('inform')
      expect(field.returnType).toBe('record')
      expect(field.actionName).toBe('__memory_append_note')
    }
  })

  it('memory entity appears in list()', () => {
    const reg = new EntityRegistry()
    const names = reg.list().map((e) => e.name)
    expect(names).toContain('memory')
  })
})

// ── Memory entity — address resolver ──────────────────────────────────────────

/** Build an actionContext that provides in-memory implementations of memory ops. */
function makeMemoryContext(store: {
  conversations: MaisieRecord[]
  notes: MaisieRecord[]
  facts: MaisieRecord
}) {
  return {
    __memory_loadConversations: () => Promise.resolve(store.conversations),
    __memory_loadNotes: () => Promise.resolve(store.notes),
    __memory_loadFacts: () => Promise.resolve(store.facts),
    __memory_appendNote: (content: string, tags: string[]) => {
      const note: MaisieRecord = {
        id: crypto.randomUUID(),
        content,
        timestamp: new Date().toISOString(),
        tags: tags as unknown as import('@maisie/shared').MaisieValue,
      }
      store.notes.push(note)
      return Promise.resolve(note)
    },
  }
}

describe('memory entity — address resolver', () => {
  beforeEach(() => {
    // Restore the singleton to its constructed state (catalog + memory).
    entityRegistry.clear()
    const fresh = new EntityRegistry()
    const memoryDef = fresh.get('memory')!
    const catalogDef = fresh.get('catalog')!
    entityRegistry.register(catalogDef)
    entityRegistry.register(memoryDef)
  })

  it('resolves memory.notes to the notes collection', async () => {
    const store = {
      conversations: [],
      notes: [
        { id: 'n1', content: 'Plumber came', timestamp: '2025-01-01T00:00:00Z', tags: ['maintenance'] },
      ],
      facts: {},
    }
    const resolver = createAddressResolver(makeMemoryContext(store))
    const result = await resolver.resolve('memory.notes')

    expect(Array.isArray(result)).toBe(true)
    const notes = result as MaisieRecord[]
    expect(notes).toHaveLength(1)
    expect(notes[0].content).toBe('Plumber came')
  })

  it('resolves memory.conversations to the conversations collection', async () => {
    const store = {
      conversations: [
        { id: 'c1', trigger: 'user_message', persona: 'maisie', summary: 'Hello', outcome: 'informed', timestamp: '2025-01-01T00:00:00Z', toolsUsed: [] },
      ],
      notes: [],
      facts: {},
    }
    const resolver = createAddressResolver(makeMemoryContext(store))
    const result = await resolver.resolve('memory.conversations')

    expect(Array.isArray(result)).toBe(true)
    const conversations = result as MaisieRecord[]
    expect(conversations).toHaveLength(1)
    expect(conversations[0].persona).toBe('maisie')
  })

  it('resolves memory.facts to the facts record', async () => {
    const store = {
      conversations: [],
      notes: [],
      facts: { 'wan.provider': 'Comcast', 'device.count': 66 },
    }
    const resolver = createAddressResolver(makeMemoryContext(store))
    const result = await resolver.resolve('memory.facts')

    expect(typeof result).toBe('object')
    expect(Array.isArray(result)).toBe(false)
    const facts = result as MaisieRecord
    expect(facts['wan.provider']).toBe('Comcast')
    expect(facts['device.count']).toBe(66)
  })

  it('invokes memory.append_note and returns inserted record', async () => {
    const store = {
      conversations: [],
      notes: [] as MaisieRecord[],
      facts: {},
    }
    const resolver = createAddressResolver(makeMemoryContext(store))
    // tags must be a JSON string since MaisieValue doesn't include string[]
    const result = await resolver.invoke('memory.append_note', {
      content: 'Remember to check the thermostat',
      tags: '["hvac"]',
    })

    expect(typeof result).toBe('object')
    const record = result as MaisieRecord
    expect(record.content).toBe('Remember to check the thermostat')
    expect(record.tags).toEqual(['hvac'])  // mock returns parsed array
    expect(typeof record.id).toBe('string')
    // Verify the store was updated
    expect(store.notes).toHaveLength(1)
  })

  it('throws when memory ops are missing from context', async () => {
    const resolver = createAddressResolver({}) // no memory ops
    await expect(resolver.resolve('memory.notes')).rejects.toThrow('Memory operations not available')
  })

  it('memory entity is queryable via the catalog', async () => {
    const store = { conversations: [], notes: [], facts: {} }
    const resolver = createAddressResolver(makeMemoryContext(store))
    const result = await resolver.resolve('catalog.items')

    const items = result as MaisieRecord[]
    const memoryDescriptor = items.find((i) => i.name === 'memory')
    expect(memoryDescriptor).toBeDefined()
    expect(memoryDescriptor!.section).toBe('agent')
  })
})
