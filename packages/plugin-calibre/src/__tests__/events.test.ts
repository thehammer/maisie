import { describe, test, expect } from 'bun:test'
import * as eventDefs from '../events'

describe('enrichmentProposed event', () => {
  test('has notify: true — surfaces to user when proposals are ready', () => {
    expect(eventDefs.enrichmentProposed.ui.notify).toBe(true)
  })
  test('has realtime: true', () => {
    expect(eventDefs.enrichmentProposed.ui.realtime).toBe(true)
  })
  test('publishes to the correct MQTT topic', () => {
    expect(eventDefs.enrichmentProposed.topic).toBe('home/calibre/enrichment/proposed')
  })
  test('ai tier is inform — agent logs but does not act', () => {
    expect(eventDefs.enrichmentProposed.ai.tier).toBe('inform')
  })
  test('payload schema requires count', () => {
    expect(eventDefs.enrichmentProposed.schema.safeParse({ count: 5 }).success).toBe(true)
    expect(eventDefs.enrichmentProposed.schema.safeParse({}).success).toBe(false)
    expect(eventDefs.enrichmentProposed.schema.safeParse({ count: 'not-a-number' }).success).toBe(false)
  })
})

describe('enrichmentApplied event', () => {
  test('has tier ignore — no agent action needed after apply', () => {
    expect(eventDefs.enrichmentApplied.ai.tier).toBe('ignore')
  })
  test('has notify: false — silent confirmation', () => {
    expect(eventDefs.enrichmentApplied.ui.notify).toBe(false)
  })
  test('has realtime: true — dashboard updates live', () => {
    expect(eventDefs.enrichmentApplied.ui.realtime).toBe(true)
  })
  test('publishes to the correct MQTT topic', () => {
    expect(eventDefs.enrichmentApplied.topic).toBe('home/calibre/enrichment/applied')
  })
  test('payload schema requires bookId, title, fieldsUpdated', () => {
    expect(eventDefs.enrichmentApplied.schema.safeParse({
      bookId: 42,
      title: 'Dune',
      fieldsUpdated: ['tags', 'series'],
    }).success).toBe(true)
    expect(eventDefs.enrichmentApplied.schema.safeParse({ bookId: 42 }).success).toBe(false)
    expect(eventDefs.enrichmentApplied.schema.safeParse({}).success).toBe(false)
  })
})
