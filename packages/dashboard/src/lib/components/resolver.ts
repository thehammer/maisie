/**
 * Client-side component resolver.
 *
 * Maintains a cache of derived components fetched from /api/components.
 * Base and layout components are always available from static shared data.
 * Built-in special components (DefaultTile) are also always available.
 */

import type { ComponentDef } from '@maisie/shared'
import { BASE_COMPONENTS, LAYOUT_PRIMITIVES } from '@maisie/shared'

/** Built-in virtual components that are resolved client-side only (not in registry). */
const BUILTIN_COMPONENTS: Record<string, ComponentDef> = {
  DefaultTile: {
    name: 'DefaultTile',
    kind: 'base',
    description: 'Auto-renders any record with sensible defaults (image + title + badge or label-value list)',
    input: { kind: 'any' },
  },
}

let derivedCache: Record<string, ComponentDef> = {}
let fetchPromise: Promise<void> | null = null

async function fetchDerived(): Promise<void> {
  try {
    const res = await fetch('/api/components')
    if (!res.ok) return
    const list = await res.json() as ComponentDef[]
    const cache: Record<string, ComponentDef> = {}
    for (const c of list) {
      if (c.kind === 'derived') cache[c.name] = c
    }
    derivedCache = cache
  } catch {
    // Ignore network errors — fall back to empty derived set
  }
}

/**
 * Ensures derived components have been fetched at least once.
 * Safe to call repeatedly — returns the same in-flight promise.
 */
export function ensureComponentsLoaded(): Promise<void> {
  if (fetchPromise === null) fetchPromise = fetchDerived()
  return fetchPromise
}

/**
 * Force a re-fetch of derived components from /api/components.
 */
export function refreshComponents(): Promise<void> {
  fetchPromise = fetchDerived()
  return fetchPromise
}

/**
 * Resolve a component by name. Checks base, layout, builtin, then derived caches.
 * Returns undefined if not found.
 */
export function resolveComponent(name: string): ComponentDef | undefined {
  return BASE_COMPONENTS[name] ?? LAYOUT_PRIMITIVES[name] ?? BUILTIN_COMPONENTS[name] ?? derivedCache[name]
}
