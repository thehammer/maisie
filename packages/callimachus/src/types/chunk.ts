import { z } from 'zod'
import { LocationSchema } from './location'

export const ChunkSchema = z.object({
  /** Content hash — sha256 hex of the chunk content */
  id: z.string(),
  corpus_id: z.string(),
  parent_path: z.string().nullable(),
  /** Adapter-defined chunk kind, e.g. 'chapter', 'scene', 'function', 'file' */
  kind: z.string(),
  location: LocationSchema,
  content: z.string(),
  byte_length: z.number().int().nonnegative(),
  created_at: z.date(),
})

export type Chunk = z.infer<typeof ChunkSchema>

/**
 * SHA-256 hash of the given content string, returned as a hex string.
 * Used to derive the stable id for a chunk.
 */
export function hashChunk(content: string): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(content)
  return hasher.digest('hex')
}
