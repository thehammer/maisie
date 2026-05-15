# @maisie/callimachus-adapter-book

Book source adapter for [`@maisie/callimachus`](../callimachus). Implements `SourceAdapter` for EPUB (`.epub`) and plain-text (`.txt`, `.md`) books, chunking them into a deterministic chapter/scene tree.

## Supported source kinds

| Extension | Kind | Notes |
|---|---|---|
| `.epub` | `epub-chapter` | One source per spine item; HTML stripped to plain text |
| `.txt` | `txt` | Chapter headings: `Chapter N:` / `CHAPTER N` |
| `.md` | `md` | Chapter headings: `#` / `##` Markdown headings |

## Quickstart

```ts
import { AdapterRegistry } from '@maisie/callimachus'
import { createBookAdapter } from '@maisie/callimachus-adapter-book'

const registry = new AdapterRegistry()
registry.register(createBookAdapter({ corpus_id: 'xenos' }))

const adapter = registry.get('book')!

// Discover sources from a file
const sources = await adapter.discover('/path/to/book.txt')

// Stream chapter + scene chunks
for (const source of sources) {
  for await (const chunk of adapter.chunk(source)) {
    console.log(chunk.location.uri, chunk.kind)
    // calli://xenos/ch/1        chapter
    // calli://xenos/ch/1/sc/1   scene
    // calli://xenos/ch/1/sc/2   scene
    // ...
  }
}
```

## Chunk address scheme

- `ch/<N>` — chapter (parent_path: null)
- `ch/<N>/sc/<M>` — scene (parent_path: `ch/<N>`)

Chunk IDs are `sha256(content)` — stable across runs for identical content.

## Notes

- HTML stripping is regex-based (v1 limitation). Complex EPUB layouts may leave minor artefacts.
- `resolveAliases` uses surname-match clustering. A production implementation would use an LLM.
- Order-0 EPUB spine items (typically TOC pages) are filtered out automatically.
- PDF support is out of scope for v1.
