/**
 * Discovery functions for the book adapter.
 *
 * Plain-text sources (.txt, .md):
 *   One DiscoveredSource per file, representing the whole book.
 *   Kind: 'txt' or 'md'.
 *
 * EPUB sources (.epub):
 *   One DiscoveredSource per spine item (chapter), using the spine order
 *   to produce canonical ch/<N> paths.
 *   Kind: 'epub-chapter'.
 *
 * Unsupported extensions throw an error.
 */

import nodePath from 'node:path'
import { formatLocation } from '@maisie/callimachus'
import type { DiscoveredSource } from '@maisie/callimachus'
import { loadEpub } from './epub'

// ---------------------------------------------------------------------------
// Internal extended types used by the adapter to carry file-system context.
// The extra fields (prefixed __) are invisible to callers who only
// type-check DiscoveredSource, but BookAdapter.chunk() casts back to these
// to retrieve the concrete file paths needed for I/O.
// ---------------------------------------------------------------------------

/** Plain-text / Markdown source carrying the original absolute file path. */
export interface TextDiscoveredSource extends DiscoveredSource {
  /** Absolute path to the source file on disk. */
  __filePath: string
}

export interface EpubDiscoveredSource extends DiscoveredSource {
  /** Absolute path to the .epub file (for cache lookup) */
  __epubPath: string
  /** The epub2 spine id for this chapter */
  __spineId: string
}

// ---------------------------------------------------------------------------
// Plain text / Markdown
// ---------------------------------------------------------------------------

export function discoverPlainText(filePath: string, corpus_id: string): TextDiscoveredSource[] {
  const absPath = nodePath.resolve(filePath)
  const ext = nodePath.extname(filePath).toLowerCase()
  const kind = ext === '.md' ? 'md' : 'txt'
  const path = nodePath.basename(filePath)
  return [
    {
      corpus_id,
      path,
      uri: formatLocation({ corpus_id, path }),
      kind,
      __filePath: absPath,
    },
  ]
}

// ---------------------------------------------------------------------------
// EPUB
// ---------------------------------------------------------------------------

export async function discoverEpub(
  filePath: string,
  corpus_id: string,
): Promise<EpubDiscoveredSource[]> {
  const absPath = nodePath.resolve(filePath)
  const epub = await loadEpub(absPath)

  // Filter out order-0 spine items (typically TOC / nav pages, not content chapters).
  const contentSpine = epub.spine.filter((item) => item.order > 0)

  return contentSpine.map((item) => {
    const path = `ch/${item.order}`
    const source: EpubDiscoveredSource = {
      corpus_id,
      path,
      uri: formatLocation({ corpus_id, path }),
      kind: 'epub-chapter',
      __epubPath: absPath,
      __spineId: item.id,
    }
    return source
  })
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

export async function discoverSource(
  filePath: string,
  corpus_id: string,
): Promise<DiscoveredSource[]> {
  const ext = nodePath.extname(filePath).toLowerCase()
  if (ext === '.epub') {
    return discoverEpub(filePath, corpus_id)
  }
  if (ext === '.txt' || ext === '.md') {
    return discoverPlainText(filePath, corpus_id)
  }
  throw new Error(
    `Unsupported file extension '${ext}'. BookAdapter supports: .epub, .txt, .md`,
  )
}
