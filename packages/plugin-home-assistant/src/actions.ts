import { z } from 'zod'
import { defineAction } from '@maisie/shared'
import type { HaClient } from './client'

let _client: HaClient | null = null

export function setClient(client: HaClient | null) {
  _client = client
}

function getClient(): HaClient {
  if (!_client) throw new Error('Home Assistant not configured')
  return _client
}

const entitySchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  last_changed: z.string(),
  last_updated: z.string(),
})

const lightSchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  last_changed: z.string(),
  last_updated: z.string(),
})

const sceneSchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  last_changed: z.string(),
  last_updated: z.string(),
})

const switchSchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  last_changed: z.string(),
  last_updated: z.string(),
})

export const getEntities = defineAction({
  name: 'get_entities',
  description: 'Get Home Assistant entities — lights, switches, sensors, etc. Filter by domain (light, switch, sensor) or area.',
  input: z.object({
    domain: z.string().optional(),
    area: z.string().optional(),
  }),
  output: z.array(entitySchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Entities', section: 'smarthome', realtimeTopic: 'home/smarthome/entities/+' },
  async execute(input, _ctx) {
    const client = getClient()
    if (input.domain) {
      return client.getByDomain(input.domain)
    }
    return client.getStates()
  },
})

export const callService = defineAction({
  name: 'call_service',
  description: 'Call a Home Assistant service to control a device. Example: turn on a light (domain: light, service: turn_on, entityId: light.kitchen).',
  input: z.object({
    domain: z.string(),
    service: z.string(),
    entityId: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST' },
  ai: {
    tier: 'act',
    description: 'Call a Home Assistant service to control a device. Example: turn on a light (domain: light, service: turn_on, entityId: light.kitchen).',
  },
  ui: false,
  async execute(input, _ctx) {
    const client = getClient()
    const data: Record<string, any> = { ...input.data }
    if (input.entityId) data.entity_id = input.entityId
    await client.callService(input.domain, input.service, data)
    return { success: true }
  },
})

export const getLights = defineAction({
  name: 'get_lights',
  description: 'Get all lights and their current on/off/brightness state.',
  input: z.object({}),
  output: z.array(lightSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Get all lights and their current on/off/brightness state.' },
  ui: { label: 'Lights', section: 'smarthome' },
  async execute(_input, _ctx) {
    return getClient().getLights()
  },
})

export const toggleEntity = defineAction({
  name: 'toggle_entity',
  description: 'Toggle a light or switch on/off.',
  input: z.object({ entityId: z.string() }),
  output: z.object({ success: z.boolean(), newState: z.string() }),
  http: { method: 'POST' },
  ai: { tier: 'act', description: 'Toggle a light or switch on/off.' },
  ui: { label: 'Toggle', section: 'smarthome' },
  async execute(input, _ctx) {
    const client = getClient()
    const current = await client.getState(input.entityId)
    const domain = input.entityId.split('.')[0]
    const newState = current.state === 'on' ? 'off' : 'on'
    if (newState === 'on') {
      await client.turnOn(input.entityId)
    } else {
      await client.turnOff(input.entityId)
    }
    return { success: true, newState }
  },
})

export const getScenes = defineAction({
  name: 'get_scenes',
  description: 'Get all Home Assistant scenes.',
  input: z.object({}),
  output: z.array(sceneSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Scenes', section: 'smarthome' },
  async execute(_input, _ctx) {
    return getClient().getScenes()
  },
})

export const triggerScene = defineAction({
  name: 'trigger_scene',
  description: 'Activate a Home Assistant scene.',
  input: z.object({ sceneId: z.string() }),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST' },
  ai: { tier: 'act', description: 'Activate a Home Assistant scene.' },
  ui: { label: 'Activate Scene', section: 'smarthome' },
  async execute(input, _ctx) {
    await getClient().triggerScene(input.sceneId)
    return { success: true }
  },
})

export const getSwitches = defineAction({
  name: 'get_switches',
  description: 'Get all switches and their current on/off state.',
  input: z.object({}),
  output: z.array(switchSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { label: 'Switches', section: 'smarthome' },
  async execute(_input, _ctx) {
    return getClient().getSwitches()
  },
})
