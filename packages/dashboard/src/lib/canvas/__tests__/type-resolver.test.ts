import { describe, it, expect } from 'bun:test'
import { resolveEntityPorts, resolveComponentPorts, resolveFunctionPorts } from '../type-resolver'
import type { EntityDef, ComponentDef } from '@maisie/shared'

// ── Mock fetch ─────────────────────────────────────────────────────────────────

function makeFetchMock(responses: Map<string, unknown>) {
  return async (url: string): Promise<Response> => {
    const key = url.split('/api/')[1]
    if (responses.has(key)) {
      return new Response(JSON.stringify(responses.get(key)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('Not Found', { status: 404 })
  }
}

// ── Entity port resolution ─────────────────────────────────────────────────────

describe('resolveEntityPorts', () => {
  it('returns output as scalar type for a plugin entity with a single result field', async () => {
    const entity: EntityDef = {
      name: 'plex.now_playing',
      source: 'plugin',
      pluginName: 'plex',
      fields: {
        result: {
          kind: 'data',
          type: 'string',
          actionName: 'get_now_playing',
        },
      },
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock(new Map([['entities/plex.now_playing', entity]])) as unknown as typeof fetch

    const ports = await resolveEntityPorts('plex.now_playing')
    globalThis.fetch = originalFetch

    expect(ports).not.toBeNull()
    expect(ports!.output).toEqual({ kind: 'scalar', type: 'string' })
  })

  it('returns output as record for a multi-field entity', async () => {
    const entity: EntityDef = {
      name: 'weather.current',
      source: 'plugin',
      pluginName: 'weather',
      fields: {
        temperature: { kind: 'data', type: 'temperature', actionName: 'get_temp' },
        humidity: { kind: 'data', type: 'percentage', actionName: 'get_humidity' },
      },
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock(new Map([['entities/weather.current', entity]])) as unknown as typeof fetch

    const ports = await resolveEntityPorts('weather.current')
    globalThis.fetch = originalFetch

    expect(ports).not.toBeNull()
    expect(ports!.output?.kind).toBe('record')
    const output = ports!.output as { kind: 'record'; fields: Record<string, unknown> }
    expect(output.fields).toHaveProperty('temperature')
    expect(output.fields).toHaveProperty('humidity')
  })

  it('returns output as collection for a collection-type field', async () => {
    const entity: EntityDef = {
      name: 'plex.recently_added',
      source: 'plugin',
      pluginName: 'plex',
      fields: {
        result: { kind: 'data', type: 'collection', actionName: 'list_recently_added' },
      },
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock(new Map([['entities/plex.recently_added', entity]])) as unknown as typeof fetch

    const ports = await resolveEntityPorts('plex.recently_added')
    globalThis.fetch = originalFetch

    expect(ports!.output).toEqual({ kind: 'collection', element: { kind: 'any' } })
  })

  it('returns null when the server returns a non-ok response', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock(new Map()) as unknown as typeof fetch
    const ports = await resolveEntityPorts('nonexistent.entity')
    globalThis.fetch = originalFetch
    expect(ports).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => Promise.reject(new Error('network error'))) as unknown as typeof fetch
    const ports = await resolveEntityPorts('any.entity')
    globalThis.fetch = originalFetch
    expect(ports).toBeNull()
  })
})

// ── Component port resolution ──────────────────────────────────────────────────

describe('resolveComponentPorts', () => {
  it('returns input and props for a component with both declared', async () => {
    const component: ComponentDef = {
      name: 'Strip',
      kind: 'layout',
      input: { kind: 'collection', element: { kind: 'any' } },
      props: {
        label: {
          type: { kind: 'scalar', type: 'string' },
        },
      },
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock(new Map([['components/Strip', component]])) as unknown as typeof fetch

    const ports = await resolveComponentPorts('Strip')
    globalThis.fetch = originalFetch

    expect(ports).not.toBeNull()
    expect(ports!.input).toEqual({ kind: 'collection', element: { kind: 'any' } })
    expect(ports!.props).toHaveProperty('label')
  })

  it('returns undefined props when component has no props', async () => {
    const component: ComponentDef = {
      name: 'Text',
      kind: 'base',
      input: { kind: 'scalar', type: 'string' },
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock(new Map([['components/Text', component]])) as unknown as typeof fetch

    const ports = await resolveComponentPorts('Text')
    globalThis.fetch = originalFetch

    expect(ports!.input).toEqual({ kind: 'scalar', type: 'string' })
    expect(ports!.props).toBeUndefined()
  })

  it('returns undefined input when component has no input (layout primitive)', async () => {
    const component: ComponentDef = {
      name: 'Row',
      kind: 'layout',
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock(new Map([['components/Row', component]])) as unknown as typeof fetch

    const ports = await resolveComponentPorts('Row')
    globalThis.fetch = originalFetch

    expect(ports!.input).toBeUndefined()
    expect(ports!.props).toBeUndefined()
  })

  it('returns null when the server returns a non-ok response', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = makeFetchMock(new Map()) as unknown as typeof fetch
    const ports = await resolveComponentPorts('NonExistent')
    globalThis.fetch = originalFetch
    expect(ports).toBeNull()
  })
})

// ── Function port resolution ───────────────────────────────────────────────────

describe('resolveFunctionPorts', () => {
  it('returns both input and output for a known function id', () => {
    const ports = resolveFunctionPorts('std.filter')
    expect(ports).not.toBeNull()
    expect(ports!.input).toBeDefined()
    expect(ports!.output).toBeDefined()
    expect(ports!.input!.kind).toBe('collection')
    expect(ports!.output!.kind).toBe('collection')
  })

  it('std.count has collection input and scalar number output', () => {
    const ports = resolveFunctionPorts('std.count')
    expect(ports!.input!.kind).toBe('collection')
    expect(ports!.output!.kind).toBe('scalar')
    const out = ports!.output as { kind: 'scalar'; type: string }
    expect(out.type).toBe('number')
  })

  it('std.any has collection input and scalar boolean output', () => {
    const ports = resolveFunctionPorts('std.any')
    const out = ports!.output as { kind: 'scalar'; type: string }
    expect(out.type).toBe('boolean')
  })

  it('std.first has any output', () => {
    const ports = resolveFunctionPorts('std.first')
    expect(ports!.output!.kind).toBe('any')
  })

  it('returns null for an unknown function id', () => {
    expect(resolveFunctionPorts('std.unknown')).toBeNull()
    expect(resolveFunctionPorts('not.a.function')).toBeNull()
  })

  it('is synchronous (no async needed)', () => {
    // resolveFunctionPorts is sync; this test documents that
    const result = resolveFunctionPorts('std.limit')
    expect(result).not.toBeNull()
  })

  it('has no props field (functions only have input and output ports)', () => {
    const ports = resolveFunctionPorts('std.sort')
    expect(ports!.props).toBeUndefined()
  })
})
