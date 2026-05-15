/**
 * LLM prompt templates for the book adapter.
 * Each export is a pure function (chunk, opts) → string so templates are testable.
 */

import type { Chunk } from '@maisie/callimachus'

// ---------------------------------------------------------------------------
// extractWithLlm prompt
// ---------------------------------------------------------------------------

export interface ExtractPromptOpts {
  /** Extra context to append (e.g. known character list from corpus) */
  context?: string
}

/**
 * Build the extraction prompt for a scene chunk.
 * Expects a JSON response from the LLM with shape:
 * { entities: [{canonical_name, kind, aliases, description}], summary_text: string }
 */
export function buildExtractPrompt(chunk: Chunk, opts: ExtractPromptOpts = {}): string {
  const contextBlock = opts.context ? `\n\nAdditional context:\n${opts.context}` : ''
  return `You are a literary analysis assistant. Extract structured information from the following book passage.

Location: ${chunk.location.uri}
Kind: ${chunk.kind}
${contextBlock}

Passage:
"""
${chunk.content}
"""

Respond with a single JSON object (no markdown fences) matching this shape:
{
  "entities": [
    {
      "canonical_name": "<string>",
      "kind": "<character|place|organization|object|concept>",
      "aliases": ["<alias1>", "<alias2>"],
      "description": "<one sentence or null>"
    }
  ],
  "summary_text": "<2-4 sentence summary of this passage, or null if the passage is too fragmentary>"
}

Rules:
- Include only entities that appear clearly in the passage.
- Do not invent entities not present in the text.
- Aliases must be alternate names used within the text.
- summary_text should be a factual prose summary, not a literary review.`
}

// ---------------------------------------------------------------------------
// summarize prompt
// ---------------------------------------------------------------------------

export interface SummarizePromptOpts {
  /** Depth label: 'scene' | 'chapter' | 'corpus' */
  depth: string
  /** For chapter summaries, the concatenated scene summaries to fan-in */
  childSummaries?: string
}

/**
 * Build the summarization prompt for a chunk at the given depth.
 *
 * Chapter summaries use child scene summaries as input (fan-in pattern).
 * The actual fan-in is orchestrated by the indexing pipeline — this adapter
 * accepts already-concatenated child summaries via opts.childSummaries.
 */
export function buildSummarizePrompt(chunk: Chunk, opts: SummarizePromptOpts): string {
  const { depth, childSummaries } = opts

  if (depth === 'chapter' && childSummaries) {
    return `You are a literary analysis assistant. Summarize the following chapter based on its scene summaries.

Chapter location: ${chunk.location.uri}

Scene summaries:
"""
${childSummaries}
"""

Write a 3-6 sentence summary of the chapter. Focus on plot, character development, and thematic significance. Respond with only the summary text — no headers, no markdown.`
  }

  return `You are a literary analysis assistant. Summarize the following ${depth} from a book.

Location: ${chunk.location.uri}

${chunk.kind === 'scene' ? 'Scene text' : 'Text'}:
"""
${chunk.content}
"""

Write a 2-4 sentence summary. Focus on what happens and who is involved. Respond with only the summary text — no headers, no markdown.`
}
