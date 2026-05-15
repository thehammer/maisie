/**
 * Extract a text snippet from `content` anchored on the first occurrence of
 * any whitespace-separated term in `query`.
 *
 * - If a match is found, returns a window of up to `max` chars centered on
 *   the match start, with `...` padding where text is omitted.
 * - If no match is found, returns the first `max` chars (no leading ellipsis).
 * - If content is shorter than `max`, returns it unchanged.
 */
export function extractSnippet(content: string, query: string, max: number = 100): string {
  if (content.length <= max) return content

  const terms = query.split(/\s+/).filter(Boolean)
  const lower = content.toLowerCase()

  // Find the earliest occurrence of any query term
  let matchPos = -1
  for (const term of terms) {
    const pos = lower.indexOf(term.toLowerCase())
    if (pos !== -1 && (matchPos === -1 || pos < matchPos)) {
      matchPos = pos
    }
  }

  if (matchPos === -1) {
    // No match — return first max chars
    return content.slice(0, max)
  }

  // Center window on match
  const half = Math.floor(max / 2)
  let start = Math.max(0, matchPos - half)
  let end = start + max

  if (end > content.length) {
    end = content.length
    start = Math.max(0, end - max)
  }

  const prefix = start > 0 ? '...' : ''
  const suffix = end < content.length ? '...' : ''

  return prefix + content.slice(start, end) + suffix
}
