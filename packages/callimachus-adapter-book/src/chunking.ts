// Pure chunking functions for book text.
//
// Chapter detection patterns (applied in order, first match wins per line):
//   - Markdown H1/H2: starts with one or two # characters
//   - Plain-text CHAPTER: /^chapter\s+\S+.../i  (e.g. "Chapter 1: Arrival", "CHAPTER ONE")
//
// Scene break patterns:
//   - 3+ consecutive newlines (2+ blank lines between paragraphs)
//   - A line containing only: "* * *", "###", "---"
//   - Unicode: ⁂ or ※ on their own line
//
// Minimum scene length: 200 chars. Fragments shorter than this are merged
// into the preceding scene (or dropped if they precede the first scene).

import type { DiscoveredSource } from '@maisie/callimachus'

// ---------------------------------------------------------------------------
// Heading detection
// ---------------------------------------------------------------------------

// Built once at module load.
const MARKDOWN_HEADING = /^(#{1,2})\s+(.+)$/
const PLAIN_CHAPTER = /^chapter\s+\S+[^\n]*/i

function extractHeading(line: string): string | null {
  const md = line.match(MARKDOWN_HEADING)
  if (md) return md[2].trim()
  if (PLAIN_CHAPTER.test(line)) return line.trim()
  return null
}

// ---------------------------------------------------------------------------
// Scene break detection
// ---------------------------------------------------------------------------

const DIVIDER_LINE = /^\s*(\*\s*\*\s*\*|#{3}|---+|⁂|※)\s*$/

const MIN_SCENE_LENGTH = 200

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RawChapter {
  title: string
  order: number
  text: string
  sourceRef: string
}

export interface SceneRaw {
  order: number
  text: string
}

// ---------------------------------------------------------------------------
// splitIntoChapters
// ---------------------------------------------------------------------------

/**
 * Split a plain-text source into chapters by heading detection.
 * The `loadChapter` callback receives the source id (= source.path for plain text).
 */
export async function* splitIntoChapters(
  rawSource: DiscoveredSource,
  loadChapter: (id: string) => Promise<string>,
): AsyncIterable<RawChapter> {
  const raw = await loadChapter(rawSource.path)
  const normalised = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalised.split('\n')

  // Collect chapter boundaries: { lineIndex, title }
  const boundaries: { lineIdx: number; title: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const heading = extractHeading(lines[i])
    if (heading !== null) {
      boundaries.push({ lineIdx: i, title: heading })
    }
  }

  if (boundaries.length === 0) {
    // No headings → single "Untitled" chapter
    yield { title: 'Untitled', order: 1, text: normalised.trim(), sourceRef: rawSource.path }
    return
  }

  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b].lineIdx + 1 // skip the heading line itself
    const end = b + 1 < boundaries.length ? boundaries[b + 1].lineIdx : lines.length
    const text = lines.slice(start, end).join('\n').trim()
    yield {
      title: boundaries[b].title,
      order: b + 1,
      text,
      sourceRef: rawSource.path,
    }
  }
}

// ---------------------------------------------------------------------------
// splitIntoScenes
// ---------------------------------------------------------------------------

/**
 * Split a chapter's text into scenes based on scene-break markers.
 * Tiny fragments (< MIN_SCENE_LENGTH chars) are merged into the preceding scene.
 */
export function splitIntoScenes(chapterText: string): SceneRaw[] {
  const normalised = chapterText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Strategy: split on blank-line clusters OR on divider lines.
  // We iterate line-by-line and emit a break whenever we see a divider or
  // a run of ≥2 consecutive empty lines.
  const lines = normalised.split('\n')
  const segments: string[] = []
  let current: string[] = []
  let blankRun = 0

  for (const line of lines) {
    const isBlank = line.trim() === ''
    const isDivider = DIVIDER_LINE.test(line)

    if (isDivider) {
      // Flush current segment, start new one (skip the divider line itself)
      segments.push(current.join('\n').trim())
      current = []
      blankRun = 0
      continue
    }

    if (isBlank) {
      blankRun++
      if (blankRun >= 2) {
        // 2+ consecutive blank lines = scene break
        segments.push(current.join('\n').trim())
        current = []
        blankRun = 0
        continue
      }
    } else {
      blankRun = 0
    }

    current.push(line)
  }

  // Flush tail
  const tail = current.join('\n').trim()
  if (tail) segments.push(tail)

  // Filter empty segments, then merge short fragments into predecessor
  const nonEmpty = segments.filter((s) => s.length > 0)
  if (nonEmpty.length === 0) {
    return chapterText.trim()
      ? [{ order: 1, text: chapterText.trim() }]
      : []
  }

  const merged: string[] = []
  for (const seg of nonEmpty) {
    if (merged.length > 0 && seg.length < MIN_SCENE_LENGTH) {
      merged[merged.length - 1] += '\n\n' + seg
    } else {
      merged.push(seg)
    }
  }

  return merged.map((text, i) => ({ order: i + 1, text }))
}
