import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { splitIntoChapters, splitIntoScenes } from '../chunking'
import type { RawChapter } from '../chunking'
import type { DiscoveredSource } from '@maisie/callimachus'

const FIXTURES = join(import.meta.dir, '../../test-fixtures')
const SAMPLE_TXT = join(FIXTURES, 'sample.txt')

function makeSource(filePath: string): DiscoveredSource {
  return {
    corpus_id: 'test',
    path: filePath,
    uri: `calli://test/${filePath}`,
    kind: 'txt',
  }
}

async function collectChapters(source: DiscoveredSource): Promise<RawChapter[]> {
  const chapters: RawChapter[] = []
  for await (const ch of splitIntoChapters(source, (id) => readFile(id, 'utf-8'))) {
    chapters.push(ch)
  }
  return chapters
}

describe('splitIntoChapters', () => {
  it('finds three chapters in sample.txt', async () => {
    const source = makeSource(SAMPLE_TXT)
    const chapters = await collectChapters(source)
    expect(chapters).toHaveLength(3)
    expect(chapters[0].title).toContain('Arrival')
    expect(chapters[1].title).toContain('Inquiry')
    expect(chapters[2].title).toContain('Confrontation')
    expect(chapters[0].order).toBe(1)
    expect(chapters[1].order).toBe(2)
    expect(chapters[2].order).toBe(3)
  })

  it('each chapter text is non-empty', async () => {
    const source = makeSource(SAMPLE_TXT)
    const chapters = await collectChapters(source)
    for (const ch of chapters) {
      expect(ch.text.length).toBeGreaterThan(0)
    }
  })

  it('returns a single Untitled chapter when no headings are found', async () => {
    const noHeadings = 'Just some text with no headings at all.\n\nAnother paragraph here.'
    const source = makeSource('/fake/flat.txt')
    const chapters: RawChapter[] = []
    for await (const ch of splitIntoChapters(
      source,
      (_id) => Promise.resolve(noHeadings),
    )) {
      chapters.push(ch)
    }
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('Untitled')
    expect(chapters[0].text).toContain('Just some text')
  })
})

describe('splitIntoScenes', () => {
  it('splits chapter 1 text into 3 scenes on "* * *" dividers', async () => {
    const source = makeSource(SAMPLE_TXT)
    const chapters = await collectChapters(source)
    const ch1 = chapters.find((c) => c.order === 1)!
    const scenes = splitIntoScenes(ch1.text)
    expect(scenes).toHaveLength(3)
    expect(scenes[0].order).toBe(1)
    expect(scenes[1].order).toBe(2)
    expect(scenes[2].order).toBe(3)
  })

  it('merges tiny fragments (< 200 chars) into the preceding scene', () => {
    const big = 'A'.repeat(250)
    const tiny = 'She nodded.' // < 200 chars
    const text = `${big}\n\n\n${tiny}`
    const scenes = splitIntoScenes(text)
    // tiny should merge into big
    expect(scenes).toHaveLength(1)
    expect(scenes[0].text).toContain('She nodded.')
  })

  it('returns a single scene when no scene breaks are found', () => {
    const text = 'A'.repeat(500)
    const scenes = splitIntoScenes(text)
    expect(scenes).toHaveLength(1)
    expect(scenes[0].order).toBe(1)
  })

  it('splits on --- dividers', () => {
    const a = 'A'.repeat(250)
    const b = 'B'.repeat(250)
    const text = `${a}\n---\n${b}`
    const scenes = splitIntoScenes(text)
    expect(scenes).toHaveLength(2)
  })

  it('splits on unicode ⁂ divider', () => {
    const a = 'A'.repeat(250)
    const b = 'B'.repeat(250)
    const text = `${a}\n⁂\n${b}`
    const scenes = splitIntoScenes(text)
    expect(scenes).toHaveLength(2)
  })

  it('returns empty array for empty text', () => {
    expect(splitIntoScenes('')).toHaveLength(0)
  })
})
