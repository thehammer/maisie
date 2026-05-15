import type { Scope } from '../types/scope'

/**
 * Returns true if the given locationUri passes the scope filter.
 *
 * Rules:
 * - No scope (undefined) or empty scope → always true
 * - `include` — at least one pattern must match; patterns match against the URI path portion
 * - `exclude` — no pattern may match; checked after include
 * - When both include and exclude match the same URI, exclude wins
 */
export function matchScope(locationUri: string, scope: Scope | undefined): boolean {
  if (!scope) return true

  const { include, exclude } = scope

  // Extract the path portion from the URI (everything after calli://<corpus_id>/)
  const path = extractPath(locationUri)

  if (include && include.length > 0) {
    const matched = include.some((pattern) => globMatch(pattern, path))
    if (!matched) return false
  }

  if (exclude && exclude.length > 0) {
    const matched = exclude.some((pattern) => globMatch(pattern, path))
    if (matched) return false
  }

  return true
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Extract the path portion from a calli:// URI.
 * `calli://corpus_id/some/path` → `some/path`
 * Falls back to the full URI if not a calli URI.
 */
function extractPath(uri: string): string {
  if (!uri.startsWith('calli://')) return uri
  const rest = uri.slice('calli://'.length)
  const slash = rest.indexOf('/')
  return slash === -1 ? '' : rest.slice(slash + 1)
}

/**
 * Tiny glob matcher.
 *
 * Supported wildcards:
 * - `**`  matches any sequence of characters including `/` (path separators)
 * - `*`   matches any sequence of characters EXCEPT `/`
 * - `?`   matches exactly one character that is not `/`
 *
 * All other characters match literally.
 */
function globMatch(pattern: string, str: string): boolean {
  const regex = globToRegex(pattern)
  return regex.test(str)
}

function globToRegex(pattern: string): RegExp {
  let reStr = ''
  let i = 0

  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      reStr += '.*'
      i += 2
      // Skip trailing slash after ** if present
      if (pattern[i] === '/') i++
    } else if (pattern[i] === '*') {
      reStr += '[^/]*'
      i++
    } else if (pattern[i] === '?') {
      reStr += '[^/]'
      i++
    } else {
      // Escape regex special chars
      reStr += escapeRegex(pattern[i])
      i++
    }
  }

  return new RegExp(`^${reStr}$`)
}

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g

function escapeRegex(ch: string): string {
  return ch.replace(REGEX_SPECIAL, '\\$&')
}
