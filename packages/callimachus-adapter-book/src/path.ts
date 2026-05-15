/**
 * Canonical path helpers for book chunks.
 * These are the single source of truth for how chapters and scenes are addressed.
 * Both formatLocation and extractStructure compose from these helpers.
 */

/** e.g. chapterPath(3) → 'ch/3' */
export function chapterPath(order: number): string {
  return `ch/${order}`
}

/** e.g. scenePath(3, 2) → 'ch/3/sc/2' */
export function scenePath(chapterOrder: number, sceneOrder: number): string {
  return `ch/${chapterOrder}/sc/${sceneOrder}`
}

export type ParsedPath =
  | { kind: 'chapter'; order: number }
  | { kind: 'scene'; chapterOrder: number; sceneOrder: number }

/**
 * Parse a canonical book path back into its structured form.
 * Throws if the path doesn't match a known pattern.
 */
export function parsePath(path: string): ParsedPath {
  // scene: ch/<N>/sc/<M>
  const sceneMatch = path.match(/^ch\/(\d+)\/sc\/(\d+)$/)
  if (sceneMatch) {
    return { kind: 'scene', chapterOrder: Number(sceneMatch[1]), sceneOrder: Number(sceneMatch[2]) }
  }
  // chapter: ch/<N>
  const chapterMatch = path.match(/^ch\/(\d+)$/)
  if (chapterMatch) {
    return { kind: 'chapter', order: Number(chapterMatch[1]) }
  }
  throw new Error(`Unrecognised book path: ${path}`)
}
