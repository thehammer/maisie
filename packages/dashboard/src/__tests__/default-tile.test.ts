/**
 * default-tile.test.ts
 *
 * Tests for DefaultTile field classification logic — pure logic, no React rendering.
 */
import { describe, it, expect } from 'bun:test'

// ── Pure logic extracted from DefaultTile for unit testing ────────────────────

/** Mirrors the field-detection logic in default-tile.tsx. */
function classifyRecord(record: Record<string, unknown>) {
  const fields = Object.entries(record)

  const imageEntry = fields.find(
    ([k, v]) =>
      typeof v === 'string' &&
      (v as string).startsWith('http') &&
      /coverUrl|thumbnail|image|poster|art|thumb|url/i.test(k),
  )

  const titleEntry = fields.find(
    ([k, v]) => typeof v === 'string' && /^(title|name|label|heading)$/i.test(k),
  )

  const statusEntry = fields.find(
    ([k, v]) => typeof v === 'string' && /^(status|state|type|kind)$/i.test(k),
  )

  const percentEntry = fields.find(
    ([k, v]) =>
      typeof v === 'number' &&
      (v as number) >= 0 &&
      (v as number) <= 100 &&
      /percent|progress|level|usage|completion/i.test(k),
  )

  return { imageEntry, titleEntry, statusEntry, percentEntry }
}

describe('DefaultTile field classification', () => {
  it('detects coverUrl as an image field', () => {
    const { imageEntry } = classifyRecord({
      coverUrl: 'https://example.com/cover.jpg',
      title: 'The Movie',
    })
    expect(imageEntry).toBeDefined()
    expect(imageEntry?.[0]).toBe('coverUrl')
  })

  it('detects thumbnail as an image field', () => {
    const { imageEntry } = classifyRecord({
      thumbnail: 'https://example.com/thumb.jpg',
    })
    expect(imageEntry).toBeDefined()
    expect(imageEntry?.[0]).toBe('thumbnail')
  })

  it('does not detect non-http values as image', () => {
    const { imageEntry } = classifyRecord({
      image: '/local/path.jpg',
    })
    expect(imageEntry).toBeUndefined()
  })

  it('detects title field', () => {
    const { titleEntry } = classifyRecord({
      title: 'The Movie',
      year: 2023,
    })
    expect(titleEntry).toBeDefined()
    expect(titleEntry?.[1]).toBe('The Movie')
  })

  it('detects name as a title field', () => {
    const { titleEntry } = classifyRecord({
      name: 'Some Device',
    })
    expect(titleEntry?.[0]).toBe('name')
  })

  it('detects status field', () => {
    const { statusEntry } = classifyRecord({
      status: 'playing',
      title: 'Show',
    })
    expect(statusEntry).toBeDefined()
    expect(statusEntry?.[1]).toBe('playing')
  })

  it('detects state field as status', () => {
    const { statusEntry } = classifyRecord({
      state: 'on',
    })
    expect(statusEntry?.[0]).toBe('state')
  })

  it('detects percent field', () => {
    const { percentEntry } = classifyRecord({
      progress: 75,
      title: 'Download',
    })
    expect(percentEntry).toBeDefined()
    expect(percentEntry?.[1]).toBe(75)
  })

  it('does not detect out-of-range numbers as percent', () => {
    const { percentEntry } = classifyRecord({
      progress: 150,
    })
    expect(percentEntry).toBeUndefined()
  })

  it('handles empty record', () => {
    const { imageEntry, titleEntry, statusEntry, percentEntry } = classifyRecord({})
    expect(imageEntry).toBeUndefined()
    expect(titleEntry).toBeUndefined()
    expect(statusEntry).toBeUndefined()
    expect(percentEntry).toBeUndefined()
  })

  it('full movie record — detects all fields', () => {
    const { imageEntry, titleEntry, statusEntry } = classifyRecord({
      coverUrl: 'https://plex.tv/cover.jpg',
      title: 'Breaking Bad',
      status: 'watched',
      year: 2008,
    })
    expect(imageEntry?.[0]).toBe('coverUrl')
    expect(titleEntry?.[0]).toBe('title')
    expect(statusEntry?.[0]).toBe('status')
  })
})

describe('DefaultTile layout selection', () => {
  it('prefers image-first layout when coverUrl present', () => {
    const record = {
      coverUrl: 'https://example.com/cover.jpg',
      title: 'The Movie',
    }
    const { imageEntry } = classifyRecord(record)
    expect(imageEntry).toBeDefined()
    // When imageEntry is defined, DefaultTile renders image-first layout
  })

  it('falls back to text layout when no image', () => {
    const record = { title: 'Some Show', status: 'new' }
    const { imageEntry, titleEntry } = classifyRecord(record)
    expect(imageEntry).toBeUndefined()
    expect(titleEntry).toBeDefined()
    // When no image but has title, DefaultTile renders text layout
  })

  it('falls back to label-value list when no image and no title', () => {
    const record = { deviceId: 'abc123', rssi: -70, channel: 6 }
    const { imageEntry, titleEntry } = classifyRecord(record)
    expect(imageEntry).toBeUndefined()
    expect(titleEntry).toBeUndefined()
    // Falls back to field list
  })
})
