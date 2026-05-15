# @maisie/callimachus

Callimachus is a queryable index over arbitrary corpora — books, codebases, wikis — exposed to LLMs as a structured tool surface. It lives alongside Maisie but is not a Maisie plugin; it is a sibling system that can be used standalone or integrated into the agent runtime as a follow-on step.

See [`docs/callimachus-prd.md`](../../docs/callimachus-prd.md) for the full v1 design: corpus registry, indexing pipeline, adapters (book/code/wiki), entity/edge extraction, summaries, MCP tool surface, CLI, watcher, and corrections.

See [`docs/callimachus.md`](../../docs/callimachus.md) for the current implementation status, quickstart, and tool surface reference.
