import {
  CorpusListInputSchema,
  CorpusOverviewInputSchema,
  SearchInputSchema,
  EntityInputSchema,
  EntityEdgesInputSchema,
  EntityMeetInputSchema,
  ReadInputSchema,
  SummarizeInputSchema,
  RelatedInputSchema,
} from '../tools/types'
import type { QueryService } from '../tools/query-service'
import { toJsonSchema } from './json-schema'

// ---------------------------------------------------------------------------
// Tool descriptions
// ---------------------------------------------------------------------------

const TOOL_DESCRIPTIONS: Record<string, string> = {
  corpus_list: 'List all registered corpora with their chunk and entity counts.',
  corpus_overview: 'Get a high-level overview of a corpus including top entities and summary.',
  search: 'Search a corpus by keyword or entity name, returning ranked chunks with snippets.',
  entity: 'Look up a specific entity by id, name, or alias.',
  entity_edges: 'Get the relationship edges for an entity, filtered by direction and kind.',
  entity_meet: 'Find all locations where two entities co-occur in the corpus.',
  read: 'Read a chunk at a specific location, with selectable depth (summary/scenes/full).',
  summarize: 'Retrieve a stored summary for a corpus, entity, or location.',
  related: 'Find chunks related to a given location based on shared entities.',
}

// ---------------------------------------------------------------------------
// Pre-computed JSON Schemas
// ---------------------------------------------------------------------------

const INPUT_SCHEMAS = {
  corpus_list: toJsonSchema(CorpusListInputSchema),
  corpus_overview: toJsonSchema(CorpusOverviewInputSchema),
  search: toJsonSchema(SearchInputSchema),
  entity: toJsonSchema(EntityInputSchema),
  entity_edges: toJsonSchema(EntityEdgesInputSchema),
  entity_meet: toJsonSchema(EntityMeetInputSchema),
  read: toJsonSchema(ReadInputSchema),
  summarize: toJsonSchema(SummarizeInputSchema),
  related: toJsonSchema(RelatedInputSchema),
}

// ---------------------------------------------------------------------------
// Tool list
// ---------------------------------------------------------------------------

const TOOL_LIST = Object.entries(TOOL_DESCRIPTIONS).map(([name, description]) => ({
  name,
  description,
  inputSchema: INPUT_SCHEMAS[name as keyof typeof INPUT_SCHEMAS],
}))

// ---------------------------------------------------------------------------
// Minimal server interface (works with both MCP SDK and test stubs)
// ---------------------------------------------------------------------------

type Handler = (request: unknown) => Promise<unknown>

export interface ToolServer {
  setRequestHandler(schema: { method: string }, handler: Handler): void
}

// ---------------------------------------------------------------------------
// registerTools
// ---------------------------------------------------------------------------

/**
 * Register all 9 Callimachus tools on the given server.
 *
 * The `server` parameter is typed as a minimal interface so this function
 * works with both the real MCP SDK server (via a thin adapter) and the
 * test stub server.
 */
export function registerTools(server: ToolServer, queryService: QueryService): void {
  // List tools handler
  server.setRequestHandler({ method: 'tools/list' }, async () => ({
    tools: TOOL_LIST,
  }))

  // Call tool handler
  server.setRequestHandler({ method: 'tools/call' }, async (request: unknown) => {
    const req = request as { params: { name: string; arguments: unknown } }
    const { name, arguments: args } = req.params

    const result = await dispatch(queryService, name, args) as { ok?: boolean }

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: result.ok === false,
    }
  })
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatch(qs: QueryService, name: string, args: unknown): Promise<unknown> {
  switch (name) {
    case 'corpus_list':     return qs.corpus_list(args)
    case 'corpus_overview': return qs.corpus_overview(args)
    case 'search':          return qs.search(args)
    case 'entity':          return qs.entity(args)
    case 'entity_edges':    return qs.entity_edges(args)
    case 'entity_meet':     return qs.entity_meet(args)
    case 'read':            return qs.read(args)
    case 'summarize':       return qs.summarize(args)
    case 'related':         return qs.related(args)
    default:
      return { ok: false, kind: 'error', code: 'unknown_tool', message: `Unknown tool: ${name}`, retriable: false }
  }
}
