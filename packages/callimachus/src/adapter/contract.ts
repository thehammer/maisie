import type { Chunk } from '../types/chunk'
import type { Entity } from '../types/entity'
import type { Summary } from '../types/summary'

// ---------------------------------------------------------------------------
// Supporting placeholder types
// These will firm up as concrete adapters land. Each has a TODO comment
// pointing to the PRD section that specifies the real shape.
// ---------------------------------------------------------------------------

/**
 * A file, URL, or logical unit discovered by the adapter inside a source.
 * TODO: PRD §5.3 — add mime type, last_modified, size_bytes, metadata once adapters land.
 */
export interface DiscoveredSource {
  corpus_id: string
  path: string
  uri: string
  /** Adapter-defined kind, e.g. 'epub', 'ts-file', 'markdown' */
  kind: string
}

/**
 * Structural extraction result from a single chunk (no LLM required).
 * TODO: PRD §5.3 — add heading_level, toc_entry, imports, exports, etc.
 */
export interface ExtractedStructure {
  parent_path: string | null
  /** Child paths directly under this chunk in the document tree */
  children: string[]
  /** Structured metadata the adapter can derive without an LLM */
  metadata: Record<string, unknown>
}

/**
 * Semantic extraction result from a chunk using an LLM.
 * TODO: PRD §5.3 — add entity_candidates, edge_candidates, tags.
 */
export interface ExtractedSemantic {
  entities: Partial<Entity>[]
  summary_text: string | null
}

/**
 * Describes a set of entities that should be merged into one canonical entity.
 * TODO: PRD §5.3 — add confidence, merge_strategy.
 */
export interface EntityMerge {
  canonical: string
  aliases: string[]
  entity_ids: string[]
}

/**
 * A SQL migration script (forward only).
 * TODO: PRD §7 — add rollback once multi-pass migrations are designed.
 */
export interface Migration {
  name: string
  sql: string
}

/**
 * Minimal LLM client interface for adapter use.
 * TODO: PRD §4.2 — replace with the real LlmClient contract once the
 * agent integration plan lands.
 */
export interface LlmClient {
  complete(prompt: string, opts?: { model?: string; max_tokens?: number }): Promise<string>
}

// ---------------------------------------------------------------------------
// SourceAdapter interface (PRD §5.3)
// ---------------------------------------------------------------------------

/**
 * Contract every corpus adapter must satisfy.
 *
 * An adapter is responsible for:
 * 1. Discovering indexable units within a source (discover)
 * 2. Streaming those units as raw Chunks (chunk)
 * 3. Extracting structural metadata without an LLM (extractStructure)
 * 4. Optionally extracting semantic metadata via an LLM (extractWithLlm)
 * 5. Optionally generating summaries at a given depth (summarize)
 * 6. Optionally resolving near-duplicate entity names to canonicals (resolveAliases)
 * 7. Optionally providing schema extensions for adapter-specific data (schemaExtensions)
 *
 * All methods returning promises. `extractWithLlm`, `summarize`, `resolveAliases`,
 * and `schemaExtensions` are optional escape hatches — adapters that don't need them
 * simply omit them.
 */
export interface SourceAdapter {
  /** Unique adapter name — used as the corpus `kind` value */
  readonly kind: string
  /** Semver string for the adapter */
  readonly version: string

  /**
   * Discover all indexable units within `source` (filesystem path or URL).
   * Returns a flat list; structural hierarchy is inferred from paths during indexing.
   */
  discover(source: string): Promise<DiscoveredSource[]>

  /**
   * Stream the raw text chunks from a discovered source.
   * The adapter controls chunking strategy (by chapter, function, file, etc.).
   */
  chunk(source: DiscoveredSource): AsyncIterable<Chunk>

  /**
   * Extract structural metadata from a chunk without calling an LLM.
   * Runs in pass 1 of the indexing pipeline.
   */
  extractStructure(chunk: Chunk): Promise<ExtractedStructure>

  /**
   * Extract semantic content (entities, edges, summary text) using an LLM.
   * Optional — adapters that don't use LLMs for extraction omit this.
   * Runs in pass 2 of the indexing pipeline.
   */
  extractWithLlm?(chunk: Chunk, llm: LlmClient): Promise<ExtractedSemantic>

  /**
   * Generate a summary at the given depth level for a chunk.
   * Optional — adapters may prefer offline summarisation.
   */
  summarize?(chunk: Chunk, llm: LlmClient, depth: string): Promise<Summary>

  /**
   * Resolve near-duplicate entity candidates into canonical entities.
   * Called once after all entities in a pass have been extracted.
   * Optional — adapters without aliasing needs omit this.
   */
  resolveAliases?(entities: Entity[]): Promise<EntityMerge[]>

  /**
   * Return adapter-specific SQL migrations to run before indexing.
   * Used when an adapter needs its own tables beyond the core schema.
   * Optional.
   */
  schemaExtensions?(): Migration[]

  /**
   * Format a chunk's location as a calli:// URI.
   * Must be the inverse of parseLocation.
   */
  formatLocation(chunk: Chunk): string

  /**
   * Parse a calli:// URI back into corpus_id + path.
   */
  parseLocation(uri: string): { corpus_id: string; path: string }
}
