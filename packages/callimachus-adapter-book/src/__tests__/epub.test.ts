import { describe, it, expect, beforeAll } from 'bun:test'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const FIXTURES = join(import.meta.dir, '../../test-fixtures')
const SAMPLE_EPUB = join(FIXTURES, 'sample.epub')
const SAMPLE_TXT = join(FIXTURES, 'sample.txt')

const epubPresent = existsSync(SAMPLE_EPUB)

describe('EPUB fixture', () => {
  if (!epubPresent) {
    it.skip('sample.epub not present — run build-sample-epub.ts to generate it', () => {})
    return
  }

  it('sample.epub exists on disk', () => {
    expect(epubPresent).toBe(true)
  })

  describe('loadEpub', () => {
    it('parses metadata and spine from sample.epub', async () => {
      const { loadEpub } = await import('../epub')
      const handle = await loadEpub(SAMPLE_EPUB)
      expect(handle.spine.length).toBeGreaterThanOrEqual(3)
      expect(handle.metadata).toBeDefined()
    })

    it('each spine item has an id and order', async () => {
      const { loadEpub } = await import('../epub')
      const handle = await loadEpub(SAMPLE_EPUB)
      for (const item of handle.spine) {
        expect(typeof item.id).toBe('string')
        expect(typeof item.order).toBe('number')
      }
    })

    it('getChapterText returns non-empty plainText for each spine item', async () => {
      const { loadEpub } = await import('../epub')
      const handle = await loadEpub(SAMPLE_EPUB)
      for (const item of handle.spine) {
        const { plainText } = await handle.getChapterText(item.id)
        expect(plainText.length).toBeGreaterThan(0)
      }
    })
  })

  describe('discoverSource on EPUB', () => {
    it('returns one source per content chapter (excluding order-0 TOC items)', async () => {
      const { discoverSource } = await import('../discover')
      const { loadEpub } = await import('../epub')
      const handle = await loadEpub(SAMPLE_EPUB)
      const contentSpine = handle.spine.filter((item) => item.order > 0)
      const sources = await discoverSource(SAMPLE_EPUB, 'xenos')
      expect(sources.length).toBe(contentSpine.length)
    })
  })

  describe('BookAdapter end-to-end on EPUB', () => {
    it('produces the same chapter count as the plain-text fixture', async () => {
      const { BookAdapter } = await import('../adapter')
      const adapter = new BookAdapter({ corpus_id: 'xenos' })

      // Collect chapters from EPUB
      const epubSources = await adapter.discover(SAMPLE_EPUB)
      const epubChapters: import('@maisie/callimachus').Chunk[] = []
      for (const source of epubSources) {
        for await (const chunk of adapter.chunk(source)) {
          if (chunk.kind === 'chapter') epubChapters.push(chunk)
        }
      }

      // Collect chapters from plain text
      const txtSources = await adapter.discover(SAMPLE_TXT)
      const txtChapters: import('@maisie/callimachus').Chunk[] = []
      for (const source of txtSources) {
        for await (const chunk of adapter.chunk(source)) {
          if (chunk.kind === 'chapter') txtChapters.push(chunk)
        }
      }

      expect(epubChapters.length).toBe(txtChapters.length)
    })
  })
})
