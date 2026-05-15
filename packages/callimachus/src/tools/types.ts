import { z } from 'zod'
import { LocationSchema } from '../types/location'
import { ScopeSchema } from '../types/scope'
import { EntitySchema } from '../types/entity'
import { EdgeSchema } from '../types/edge'

// ---------------------------------------------------------------------------
// corpus_list
// ---------------------------------------------------------------------------

export const CorpusListInputSchema = z.object({}).passthrough()

export const CorpusListEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  last_indexed: z.string().nullable(),
  chunk_count: z.number().int().nonnegative(),
  entity_count: z.number().int().nonnegative(),
})

export const CorpusListOutputSchema = z.array(CorpusListEntrySchema)

export type CorpusListInput = z.infer<typeof CorpusListInputSchema>
export type CorpusListEntry = z.infer<typeof CorpusListEntrySchema>
export type CorpusListOutput = z.infer<typeof CorpusListOutputSchema>

// ---------------------------------------------------------------------------
// corpus_overview
// ---------------------------------------------------------------------------

export const CorpusOverviewInputSchema = z.object({
  corpus_id: z.string(),
})

export const CorpusOverviewOutputSchema = z.object({
  title: z.string(),
  kind: z.string(),
  structure_summary: z.string().nullable(),
  top_entities: z.array(EntitySchema),
  top_level_summary: z.string().nullable(),
  last_indexed: z.string().nullable(),
})

export type CorpusOverviewInput = z.infer<typeof CorpusOverviewInputSchema>
export type CorpusOverviewOutput = z.infer<typeof CorpusOverviewOutputSchema>

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

export const SearchModeSchema = z.enum(['semantic', 'structural', 'hybrid'])

export const SearchInputSchema = z.object({
  corpus_id: z.string(),
  query: z.string().min(1),
  mode: SearchModeSchema.default('hybrid'),
  scope: ScopeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
})

export const SearchResultSchema = z.object({
  location: LocationSchema,
  snippet: z.string(),
  relevance: z.number().min(0).max(1),
  kind: z.string(),
})

export const SearchOutputSchema = z.object({
  results: z.array(SearchResultSchema),
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
})

export type SearchInput = z.infer<typeof SearchInputSchema>
export type SearchResult = z.infer<typeof SearchResultSchema>
export type SearchOutput = z.infer<typeof SearchOutputSchema>

// ---------------------------------------------------------------------------
// entity
// ---------------------------------------------------------------------------

export const EntityInputSchema = z.object({
  corpus_id: z.string(),
  name_or_id: z.string(),
})

export type EntityInput = z.infer<typeof EntityInputSchema>
// Output is the full Entity shape from types/entity.ts

// ---------------------------------------------------------------------------
// entity_edges
// ---------------------------------------------------------------------------

export const EntityEdgesInputSchema = z.object({
  corpus_id: z.string(),
  entity_id: z.string(),
  direction: z.enum(['inbound', 'outbound', 'both']),
  kind: z.string().optional(),
  scope: ScopeSchema.optional(),
  limit: z.number().int().min(1).max(1000).default(50),
})

export const EntityEdgesOutputSchema = z.object({
  edges: z.array(EdgeSchema),
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
})

export type EntityEdgesInput = z.infer<typeof EntityEdgesInputSchema>
export type EntityEdgesOutput = z.infer<typeof EntityEdgesOutputSchema>

// ---------------------------------------------------------------------------
// entity_meet
// ---------------------------------------------------------------------------

export const EntityMeetInputSchema = z.object({
  corpus_id: z.string(),
  entity_a: z.string(),
  entity_b: z.string(),
  scope: ScopeSchema.optional(),
})

export const EntityMeetOutputSchema = z.object({
  first_co_occurrence: LocationSchema,
  all: z.array(LocationSchema),
  count: z.number().int().nonnegative(),
})

export type EntityMeetInput = z.infer<typeof EntityMeetInputSchema>
export type EntityMeetOutput = z.infer<typeof EntityMeetOutputSchema>

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

export const ReadDepthSchema = z.enum(['summary', 'scenes', 'full'])

export const ReadInputSchema = z.object({
  corpus_id: z.string().optional(),
  location: z.string().min(1),
  depth: ReadDepthSchema.default('summary'),
})

export const ReadOutputSchema = z.object({
  location: LocationSchema,
  summary: z.string().optional(),
  content: z.string().optional(),
  entities_present: z.array(EntitySchema),
  child_locations: z.array(LocationSchema),
})

export type ReadInput = z.infer<typeof ReadInputSchema>
export type ReadOutput = z.infer<typeof ReadOutputSchema>

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

export const SummarizeTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('corpus') }),
  z.object({ kind: z.literal('entity'), entity_id: z.string() }),
  z.object({ kind: z.literal('location'), location: z.string() }),
  z.object({ kind: z.literal('range'), from: z.string(), to: z.string() }),
])

export const SummarizeInputSchema = z.object({
  corpus_id: z.string(),
  target: SummarizeTargetSchema,
  depth: z.string().optional(),
})

export const SummarizeOutputSchema = z.object({
  text: z.string(),
  level: z.string(),
  generated_at: z.string(),
})

export type SummarizeInput = z.infer<typeof SummarizeInputSchema>
export type SummarizeOutput = z.infer<typeof SummarizeOutputSchema>

// ---------------------------------------------------------------------------
// related
// ---------------------------------------------------------------------------

export const RelatedInputSchema = z.object({
  corpus_id: z.string(),
  location: z.string().min(1),
  kinds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).default(10),
})

export const RelatedItemSchema = z.object({
  location: LocationSchema,
  relationship: z.string(),
  score: z.number().min(0).max(1),
})

export const RelatedOutputSchema = z.object({
  related: z.array(RelatedItemSchema),
})

export type RelatedInput = z.infer<typeof RelatedInputSchema>
export type RelatedItem = z.infer<typeof RelatedItemSchema>
export type RelatedOutput = z.infer<typeof RelatedOutputSchema>
