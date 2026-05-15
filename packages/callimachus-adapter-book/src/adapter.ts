/**
 * BookAdapter — SourceAdapter implementation for EPUB and plain-text books.
 *
 * Supports:
 *   .epub   → one DiscoveredSource per spine item; chapters detected via spine order
 *   .txt    → chapter headings via regex; plain-text CHAPTER N / Markdown H1-H2
 *   .md     → same as .txt with Markdown heading preference
 *
 * Chunking produces a chapter/scene tree:
 *   ch/<N>       — one chapter chunk per chapter
 *   ch/<N>/sc/<M> — one scene chunk per scene within that chapter
 *
 * Chunk IDs are sha256(content) — stable across runs for identical content.
 */

import nodePath from 'node:path'
import nodeFsPromises from 'node:fs/promises'
import {
  formatLocation,
  parseLocation,
  hashChunk,
} from '@maisie/callimachus'
import type {
  DiscoveredSource,
  SourceAdapter,
  ExtractedStructure,
  ExtractedSemantic,
  EntityMerge,
  LlmClient,
  Chunk,
  Entity,
  Summary,
} from '@maisie/callimachus'

import { discoverSource } from './discover'
import type { EpubDiscoveredSource, TextDiscoveredSource } from './discover'
import { splitIntoChapters, splitIntoScenes } from './chunking'
import { loadEpub } from './epub'
import type { EpubHandle } from './epub'
import { chapterPath, scenePath, parsePath } from './path'
import { buildExtractPrompt, buildSummarizePrompt } from './prompts'

// ---------------------------------------------------------------------------
// BookAdapter options
// ---------------------------------------------------------------------------

export interface BookAdapterOptions {
  /**
   * Default corpus_id to embed in discovered sources.
   * The indexing pipeline may override this per-corpus invocation.
   */
  corpus_id?: string
}

// ---------------------------------------------------------------------------
// BookAdapter
// ---------------------------------------------------------------------------

export class BookAdapter implements SourceAdapter {
  readonly kind = 'book'
  readonly version = '0.1.0'

  private readonly defaultCorpusId: string
  /** Cache of parsed EPUB handles keyed by absolute epub file path */
  private readonly epubCache = new Map<string, EpubHandle>()

  constructor(opts: BookAdapterOptions = {}) {
    this.defaultCorpusId = opts.corpus_id ?? ''
  }

  // -------------------------------------------------------------------------
  // discover
  // -------------------------------------------------------------------------

  async discover(source: string): Promise<DiscoveredSource[]> {
    return discoverSource(source, this.defaultCorpusId)
  }

  // -------------------------------------------------------------------------
  // chunk
  // -------------------------------------------------------------------------

  async *chunk(source: DiscoveredSource): AsyncIterable<Chunk> {
    if (source.kind === 'epub-chapter') {
      yield* this.chunkEpubChapter(source as EpubDiscoveredSource)
    } else {
      yield* this.chunkPlainTextSource(source)
    }
  }

  // --- Plain-text / Markdown path ------------------------------------------

  private async *chunkPlainTextSource(source: DiscoveredSource): AsyncIterable<Chunk> {
    // discoverPlainText embeds the original absolute file path in __filePath.
    // The public DiscoveredSource.path is the corpus-relative basename used for
    // addressing chunks — it's not suitable for readFile.
    const textSource = source as TextDiscoveredSource
    const filePath = textSource.__filePath ?? source.path

    const loadChapter = async (_id: string): Promise<string> => {
      return nodeFsPromises.readFile(filePath, 'utf-8')
    }

    for await (const rawChapter of splitIntoChapters(source, loadChapter)) {
      const cOrder = rawChapter.order
      const scenes = splitIntoScenes(rawChapter.text)
      const corpus_id = source.corpus_id

      // Yield chapter chunk
      yield this.makeChunk({
        corpus_id,
        path: chapterPath(cOrder),
        kind: 'chapter',
        content: rawChapter.text,
        parent_path: null,
      })

      // Yield scene chunks
      for (const scene of scenes) {
        yield this.makeChunk({
          corpus_id,
          path: scenePath(cOrder, scene.order),
          kind: 'scene',
          content: scene.text,
          parent_path: chapterPath(cOrder),
        })
      }
    }
  }

  // --- EPUB path -----------------------------------------------------------

  private async *chunkEpubChapter(source: EpubDiscoveredSource): AsyncIterable<Chunk> {
    const epubHandle = await this.getOrLoadEpub(source.__epubPath)
    const { plainText } = await epubHandle.getChapterText(source.__spineId)
    const corpus_id = source.corpus_id

    // Parse the chapter order from the source path (ch/<N>)
    const parsed = parsePath(source.path)
    if (parsed.kind !== 'chapter') {
      throw new Error(`Expected chapter path, got: ${source.path}`)
    }
    const cOrder = parsed.order

    const scenes = splitIntoScenes(plainText)

    // Yield chapter chunk
    yield this.makeChunk({
      corpus_id,
      path: chapterPath(cOrder),
      kind: 'chapter',
      content: plainText,
      parent_path: null,
    })

    // Yield scene chunks
    for (const scene of scenes) {
      yield this.makeChunk({
        corpus_id,
        path: scenePath(cOrder, scene.order),
        kind: 'scene',
        content: scene.text,
        parent_path: chapterPath(cOrder),
      })
    }
  }

  private async getOrLoadEpub(epubPath: string): Promise<EpubHandle> {
    const cached = this.epubCache.get(epubPath)
    if (cached) return cached
    const handle = await loadEpub(epubPath)
    this.epubCache.set(epubPath, handle)
    return handle
  }

  // -------------------------------------------------------------------------
  // extractStructure
  // -------------------------------------------------------------------------

  async extractStructure(chunk: Chunk): Promise<ExtractedStructure> {
    const parsed = parsePath(chunk.location.path)
    const wordCount = chunk.content.split(/\s+/).filter(Boolean).length

    if (parsed.kind === 'chapter') {
      const scenes = splitIntoScenes(chunk.content)
      const children = scenes.map((s) => scenePath(parsed.order, s.order))
      // Try to extract title from first heading line
      const titleLine = chunk.content.split('\n')[0]?.trim() ?? ''
      return {
        parent_path: null,
        children,
        metadata: {
          word_count: wordCount,
          title: titleLine || null,
          chapter_order: parsed.order,
        },
      }
    }

    // Scene
    return {
      parent_path: chapterPath(parsed.chapterOrder),
      children: [],
      metadata: {
        word_count: wordCount,
        position_in_chapter: parsed.sceneOrder,
        chapter_order: parsed.chapterOrder,
      },
    }
  }

  // -------------------------------------------------------------------------
  // extractWithLlm (optional)
  // -------------------------------------------------------------------------

  async extractWithLlm(chunk: Chunk, llm: LlmClient): Promise<ExtractedSemantic> {
    // Only extract from scenes — chapter summaries are derived from scene summaries.
    if (chunk.kind !== 'scene') {
      return { entities: [], summary_text: null }
    }

    const prompt = buildExtractPrompt(chunk)
    const raw = await llm.complete(prompt, { model: 'claude-sonnet-4', max_tokens: 1500 })

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(
        `BookAdapter.extractWithLlm: LLM returned malformed JSON for ${chunk.location.uri}. ` +
        `Raw response (first 200 chars): ${raw.slice(0, 200)}`,
      )
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('entities' in parsed) ||
      !Array.isArray((parsed as { entities: unknown }).entities)
    ) {
      throw new Error(
        `BookAdapter.extractWithLlm: LLM response missing 'entities' array for ${chunk.location.uri}`,
      )
    }

    const result = parsed as { entities: Partial<Entity>[]; summary_text?: string | null }
    return {
      entities: result.entities,
      summary_text: result.summary_text ?? null,
    }
  }

  // -------------------------------------------------------------------------
  // summarize (optional)
  // -------------------------------------------------------------------------

  async summarize(chunk: Chunk, llm: LlmClient, depth: string): Promise<Summary> {
    const prompt = buildSummarizePrompt(chunk, { depth })
    const text = await llm.complete(prompt, { model: 'claude-sonnet-4', max_tokens: 800 })

    return {
      id: hashChunk(text),
      corpus_id: chunk.corpus_id,
      target_kind: 'chunk',
      target_id: chunk.id,
      depth,
      text: text.trim(),
      model: 'claude-sonnet-4',
      generated_at: new Date(),
    }
  }

  // -------------------------------------------------------------------------
  // resolveAliases (optional)
  // -------------------------------------------------------------------------

  /**
   * Simple v1 alias resolver: case-insensitive surname-match clustering.
   *
   * Groups entities by their last token (surname / final word). The canonical
   * entity is the one with the longest alias string. For example:
   *   "Gregor Eisenhorn", "Eisenhorn", "Inquisitor Eisenhorn"
   *   → cluster key "eisenhorn", canonical "Gregor Eisenhorn" (longest)
   *
   * Limitation: this heuristic has false positives (common surnames) and
   * false negatives (aliases with no surname overlap). A production
   * implementation would use an LLM call. This is documented as a known
   * limitation in the README.
   */
  async resolveAliases(entities: Entity[]): Promise<EntityMerge[]> {
    const clusters = new Map<string, Entity[]>()

    for (const entity of entities) {
      const key = surname(entity.canonical_name)
      const existing = clusters.get(key)
      if (existing) {
        existing.push(entity)
      } else {
        clusters.set(key, [entity])
      }
    }

    const merges: EntityMerge[] = []
    for (const [, group] of clusters) {
      if (group.length < 2) continue

      // Canonical = entity with the longest canonical_name
      const sorted = [...group].sort(
        (a, b) => b.canonical_name.length - a.canonical_name.length,
      )
      const canonical = sorted[0]

      const allAliases = new Set<string>()
      for (const e of group) {
        allAliases.add(e.canonical_name)
        for (const alias of e.aliases) allAliases.add(alias)
      }
      allAliases.delete(canonical.canonical_name)

      merges.push({
        canonical: canonical.canonical_name,
        aliases: Array.from(allAliases),
        entity_ids: group.map((e) => e.id),
      })
    }

    return merges
  }

  // -------------------------------------------------------------------------
  // formatLocation / parseLocation
  // -------------------------------------------------------------------------

  formatLocation(chunk: Chunk): string {
    return chunk.location.uri
  }

  parseLocation(uri: string): { corpus_id: string; path: string } {
    const loc = parseLocation(uri)
    return { corpus_id: loc.corpus_id, path: loc.path }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private makeChunk(opts: {
    corpus_id: string
    path: string
    kind: string
    content: string
    parent_path: string | null
  }): Chunk {
    const { corpus_id, path, kind, content, parent_path } = opts
    const uri = formatLocation({ corpus_id, path })
    return {
      id: hashChunk(content),
      corpus_id,
      parent_path,
      kind,
      location: { corpus_id, path, uri },
      content,
      byte_length: Buffer.byteLength(content, 'utf-8'),
      created_at: new Date(),
    }
  }
}

// ---------------------------------------------------------------------------
// Surname helper (for resolveAliases)
// ---------------------------------------------------------------------------

function surname(name: string): string {
  const tokens = name.trim().split(/\s+/)
  return (tokens[tokens.length - 1] ?? name).toLowerCase()
}
