# Callimachus

Callimachus is a queryable index over arbitrary corpora — books, codebases, wikis — exposed to LLMs as a structured tool surface. It lives alongside Maisie as a sibling system: not a plugin, not integrated into the running agent yet, but designed to be wired in as a follow-on step.

See [`docs/callimachus-prd.md`](callimachus-prd.md) for the full v1 design including the complete feature roadmap, adapter specifications, tool surface design, and the corrections/watcher subsystems.

---

## What's here today (skeleton only)

This package delivers the **foundation** that follow-on implementation plans build on. Nothing indexes yet; nothing calls an LLM yet.

| Area | Status |
|---|---|
| Core domain types (`Corpus`, `Chunk`, `Entity`, `Edge`, `Summary`, `Scope`, `ToolResult`) | ✅ done |
| Zod schemas for all types | ✅ done |
| `formatLocation` / `parseLocation` (calli:// URIs) | ✅ done |
| `SourceAdapter` contract interface | ✅ done |
| `AdapterRegistry` (empty — no adapters yet) | ✅ done |
| SQLite schema (Drizzle) | ✅ done |
| SQL migration (`migrations/0000_init.sql`) | ✅ done |
| `CorpusRegistry` service (`add`, `list`, `get`, `status`, `remove`) | ✅ done |
| `calli corpus` CLI subcommands | ✅ done |
| Stub CLI subcommands (`index`, `reindex`, `watch`, `inspect`, `correct`, `export`) | ✅ stub — exit 2 |
| `book` adapter — EPUB + plain-text ingestion (`@maisie/callimachus-adapter-book`) | ✅ done |
| `code` and `wiki` adapters | ❌ follow-on |
| Indexing pipeline | ❌ follow-on |
| LLM integration | ❌ follow-on |
| MCP tool surface | ❌ follow-on |
| Watcher | ❌ follow-on |
| Agent persona (Calli/Callista) | ❌ follow-on |

---

## Quickstart

```bash
# Run the callimachus test suite
bun run --filter @maisie/callimachus test

# Typecheck
bun run --filter @maisie/callimachus lint

# List registered corpora (empty to start)
bun packages/callimachus/src/cli/index.ts corpus list

# Register a corpus (skeleton does NOT validate source path existence — that's the adapter's job)
bun packages/callimachus/src/cli/index.ts corpus add book xenos /path/to/book.epub

# Check status
bun packages/callimachus/src/cli/index.ts corpus status xenos

# Remove
bun packages/callimachus/src/cli/index.ts corpus remove xenos
```

The DB path defaults to `./data/callimachus.db` (relative to cwd) or the `CALLIMACHUS_DB` env var:

```bash
CALLIMACHUS_DB=/tmp/test.db bun packages/callimachus/src/cli/index.ts corpus list
```

---

## Book adapter

```ts
import { AdapterRegistry } from '@maisie/callimachus'
import { createBookAdapter } from '@maisie/callimachus-adapter-book'

const registry = new AdapterRegistry()
registry.register(createBookAdapter({ corpus_id: 'xenos' }))

const adapter = registry.get('book')!
const sources = await adapter.discover('/path/to/book.epub')
for (const source of sources) {
  for await (const chunk of adapter.chunk(source)) {
    console.log(chunk.location.uri, chunk.kind, chunk.byte_length)
  }
}
```

Supports `.epub`, `.txt`, and `.md`. Each source is chunked into a chapter/scene tree:
- `ch/<N>` — chapter chunk
- `ch/<N>/sc/<M>` — scene chunk

---

## Next

Follow-on background jobs needed (see PRD §5 for specifications):

1. ~~**Book adapter** — EPUB/PDF chunker, chapter/scene splitting~~ ✅ done
2. **Code adapter** — TypeScript/Python AST chunker, file/function splitting (`packages/callimachus-adapter-code`)
3. **Wiki adapter** — Markdown/Obsidian chunker (`packages/callimachus-adapter-wiki`)
4. **Indexing pipeline** — Pass 1 (structure), Pass 2 (LLM semantic extraction), entity deduplication
5. **MCP tool surface** — `corpus_list`, `search`, `entity`, `read`, `summarize` tools
6. **Watcher** — Filesystem watch + incremental reindex on change
7. **Corrections subsystem** — Persist and apply user-authored corrections
8. **Agent persona wiring** — Wire Calli/Callista persona into `packages/agent`
