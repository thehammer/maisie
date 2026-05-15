import { z } from 'zod'
import { LocationSchema } from './location'

/**
 * A Scope narrows tool calls to a region of a corpus.
 * All fields are optional — an empty scope means unrestricted.
 */
export const ScopeSchema = z.object({
  /** Current reading position — used as context anchor */
  position: LocationSchema.optional(),
  /** Glob-style path patterns to include */
  include: z.array(z.string()).optional(),
  /** Glob-style path patterns to exclude */
  exclude: z.array(z.string()).optional(),
  /** For code corpora: restrict to a specific git branch */
  branch: z.string().optional(),
  /** Restrict to chunks/entities that carry any of these tags */
  tags: z.array(z.string()).optional(),
})

export type Scope = z.infer<typeof ScopeSchema>
