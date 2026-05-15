/**
 * @maisie/callimachus-adapter-book
 *
 * Book source adapter for @maisie/callimachus.
 * Implements SourceAdapter for EPUB (.epub) and plain-text (.txt, .md) books.
 */

export { BookAdapter } from './adapter'
export type { BookAdapterOptions } from './adapter'
export type { EpubDiscoveredSource } from './discover'
export { chapterPath, scenePath, parsePath } from './path'
export type { ParsedPath } from './path'
export type { RawChapter, SceneRaw } from './chunking'

import { BookAdapter } from './adapter'
import type { BookAdapterOptions } from './adapter'

/**
 * Factory function. Returns a ready-to-use BookAdapter.
 *
 * @param opts.corpus_id - Default corpus_id embedded in discovered sources.
 *   The indexing pipeline sets this per corpus. Tests pass it explicitly.
 */
export function createBookAdapter(opts: BookAdapterOptions = {}): BookAdapter {
  return new BookAdapter(opts)
}
