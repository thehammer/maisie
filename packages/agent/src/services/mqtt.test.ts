import { describe, it, expect } from 'bun:test'
import { topicMatches } from './mqtt'

describe('topicMatches', () => {
  it('exact match', () => {
    expect(topicMatches('home/network/devices/new', 'home/network/devices/new')).toBe(true)
  })

  it('exact mismatch', () => {
    expect(topicMatches('home/network/devices/new', 'home/network/devices/missing')).toBe(false)
  })

  it('# matches all remaining levels', () => {
    expect(topicMatches('home/#', 'home/network/devices/new')).toBe(true)
    expect(topicMatches('home/#', 'home/entity/exterior-lights/invalidated')).toBe(true)
    expect(topicMatches('home/#', 'home/a')).toBe(true)
  })

  it('# does not match a different root', () => {
    expect(topicMatches('home/#', 'other/thing')).toBe(false)
  })

  it('+ matches exactly one level', () => {
    expect(topicMatches('home/entity/+/invalidated', 'home/entity/exterior-lights/invalidated')).toBe(true)
    expect(topicMatches('home/entity/+/invalidated', 'home/entity/foo/invalidated')).toBe(true)
  })

  it('+ does not match multiple levels', () => {
    expect(topicMatches('home/entity/+/invalidated', 'home/entity/foo/bar/invalidated')).toBe(false)
  })

  it('subscription longer than topic → false', () => {
    expect(topicMatches('home/a/b/c', 'home/a/b')).toBe(false)
  })

  it('topic longer than subscription (no wildcard) → false', () => {
    expect(topicMatches('home/a/b', 'home/a/b/c')).toBe(false)
  })

  it('mixed + and # wildcards', () => {
    expect(topicMatches('home/+/#', 'home/entity/foo/invalidated')).toBe(true)
    expect(topicMatches('home/+/#', 'home/ble/devices/discovered')).toBe(true)
  })

  it('gateway pattern from mqtt-bridge', () => {
    expect(topicMatches('home/ble/gateway/+/status', 'home/ble/gateway/node1/status')).toBe(true)
    expect(topicMatches('home/ble/gateway/+/status', 'home/ble/gateway/node1/other')).toBe(false)
  })
})
