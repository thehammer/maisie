import { describe, it, expect } from 'bun:test'
import { formatLocation, parseLocation } from '../types/location'

describe('formatLocation', () => {
  it('returns a calli:// URI from corpus_id and path', () => {
    const uri = formatLocation({ corpus_id: 'xenos', path: 'ch/3/sc/2' })
    expect(uri).toBe('calli://xenos/ch/3/sc/2')
  })

  it('includes a file path with extension', () => {
    const uri = formatLocation({ corpus_id: 'agent', path: 'pkg/agent/src/api.ts#processOrder' })
    expect(uri).toBe('calli://agent/pkg/agent/src/api.ts#processOrder')
  })

  it('handles deeply nested multi-segment paths', () => {
    const uri = formatLocation({ corpus_id: 'mylib', path: 'some/deeply/nested/path/with-many-segments' })
    expect(uri).toBe('calli://mylib/some/deeply/nested/path/with-many-segments')
  })
})

describe('parseLocation', () => {
  it('round-trips a simple chapter/scene path', () => {
    const original = { corpus_id: 'xenos', path: 'ch/3/sc/2' }
    const parsed = parseLocation(formatLocation(original))
    expect(parsed.corpus_id).toBe(original.corpus_id)
    expect(parsed.path).toBe(original.path)
  })

  it('round-trips a file path with anchor', () => {
    const original = { corpus_id: 'agent', path: 'pkg/agent/src/api.ts#processOrder' }
    const parsed = parseLocation(formatLocation(original))
    expect(parsed.corpus_id).toBe(original.corpus_id)
    expect(parsed.path).toBe(original.path)
  })

  it('round-trips a deeply nested multi-segment path exactly', () => {
    const original = { corpus_id: 'mylib', path: 'some/deeply/nested/path/with-many-segments' }
    const parsed = parseLocation(formatLocation(original))
    expect(parsed.corpus_id).toBe(original.corpus_id)
    expect(parsed.path).toBe(original.path)
  })

  it('preserves the original URI on the returned object', () => {
    const uri = 'calli://xenos/ch/3/sc/2'
    const parsed = parseLocation(uri)
    expect(parsed.uri).toBe(uri)
  })

  it('rejects URIs that do not start with calli://', () => {
    expect(() => parseLocation('http://example.com/foo')).toThrow()
    expect(() => parseLocation('xenos/ch/3')).toThrow()
    expect(() => parseLocation('')).toThrow()
  })

  it('throws an error with a helpful message for non-calli URIs', () => {
    expect(() => parseLocation('https://xenos/ch/3')).toThrow(/calli:\/\//)
  })
})
