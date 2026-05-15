import { z } from 'zod'

export const LocationSchema = z.object({
  corpus_id: z.string(),
  path: z.string(),
  uri: z.string(),
})

export type Location = z.infer<typeof LocationSchema>

/**
 * Format a corpus_id + path into a calli:// URI.
 * e.g. { corpus_id: 'xenos', path: 'ch/3/sc/2' } → 'calli://xenos/ch/3/sc/2'
 */
export function formatLocation({ corpus_id, path }: { corpus_id: string; path: string }): string {
  return `calli://${corpus_id}/${path}`
}

/**
 * Parse a calli:// URI back into its structured form.
 * Throws if the URI does not start with 'calli://'.
 */
export function parseLocation(uri: string): Location {
  if (!uri.startsWith('calli://')) {
    throw new Error(`Invalid calli URI — must start with 'calli://': ${uri}`)
  }
  const rest = uri.slice('calli://'.length)
  const slashIdx = rest.indexOf('/')
  if (slashIdx === -1) {
    throw new Error(`Invalid calli URI — missing path segment: ${uri}`)
  }
  const corpus_id = rest.slice(0, slashIdx)
  const path = rest.slice(slashIdx + 1)
  return { corpus_id, path, uri }
}
