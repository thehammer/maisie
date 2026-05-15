import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import { discoverPlainText, discoverSource } from '../discover'

const FIXTURES = join(import.meta.dir, '../../test-fixtures')
const SAMPLE_TXT = join(FIXTURES, 'sample.txt')
const SAMPLE_EPUB = join(FIXTURES, 'sample.epub')

describe('discoverPlainText', () => {
  it('returns one DiscoveredSource with kind txt for a .txt file', () => {
    const sources = discoverPlainText(SAMPLE_TXT, 'mybooks')
    expect(sources).toHaveLength(1)
    const [s] = sources
    expect(s.corpus_id).toBe('mybooks')
    expect(s.kind).toBe('txt')
    expect(s.path).toBe('sample.txt')
    expect(s.uri).toBe('calli://mybooks/sample.txt')
  })

  it('returns kind md for a .md file', () => {
    const sources = discoverPlainText('/some/path/notes.md', 'corpus')
    expect(sources[0].kind).toBe('md')
    expect(sources[0].path).toBe('notes.md')
  })

  it('defaults to txt for unknown extensions', () => {
    const sources = discoverPlainText('/some/book.asciidoc', 'corpus')
    expect(sources[0].kind).toBe('txt')
  })
})

describe('discoverSource', () => {
  it('dispatches .txt to plain-text discover', async () => {
    const sources = await discoverSource(SAMPLE_TXT, 'xenos')
    expect(sources).toHaveLength(1)
    expect(sources[0].kind).toBe('txt')
  })

  it('dispatches .md to plain-text discover with md kind', async () => {
    const sources = await discoverSource('/fake/path/notes.md', 'mybooks')
    expect(sources).toHaveLength(1)
    expect(sources[0].kind).toBe('md')
  })

  it('throws for unsupported extensions', async () => {
    expect(discoverSource('/fake/path/book.pdf', 'corpus')).rejects.toThrow(
      /Unsupported file extension/,
    )
  })

  it('dispatches .epub and returns one source per spine item', async () => {
    const sources = await discoverSource(SAMPLE_EPUB, 'xenos')
    // sample.epub has 3 chapters
    expect(sources.length).toBeGreaterThanOrEqual(3)
    for (const s of sources) {
      expect(s.kind).toBe('epub-chapter')
      expect(s.corpus_id).toBe('xenos')
      expect(s.uri).toMatch(/^calli:\/\/xenos\/ch\/\d+$/)
    }
  })
})
