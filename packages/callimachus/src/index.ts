// Public API for @maisie/callimachus

// Core domain types
export * from './types'

// Corpus registry service
export { CorpusRegistry } from './registry/corpus-registry'
export type { CorpusStatus, Run } from './registry/corpus-registry'

// Storage
export { openDb, getDefaultDb } from './storage/db'
export type { Db } from './storage/db'

// Adapter contract
export type {
  SourceAdapter,
  DiscoveredSource,
  ExtractedStructure,
  ExtractedSemantic,
  EntityMerge,
  LlmClient,
  Migration,
} from './adapter/contract'
export { AdapterRegistry } from './adapter/registry'

// Indexing pipeline
export { runIndex } from './pipeline/indexer'
export type { IndexOptions, IndexResult, PassName, PassStats } from './pipeline/types'
export { AnthropicLlmClient } from './pipeline/llm/anthropic-client'
export { DryRunLlmClient } from './pipeline/llm/dry-run-client'
