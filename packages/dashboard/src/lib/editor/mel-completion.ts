/**
 * CodeMirror 6 autocomplete source for MEL (Maisie Expression Language).
 *
 * Completion contexts:
 *   - After `|`  → pipe operators
 *   - After `.`  → field names from the entity named before the dot
 *   - After `:`  → type names (in field-definition position)
 *   - Bare ident → entity names + keywords
 */

import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete'

// ── Static completions ────────────────────────────────────────────────────────

const KEYWORDS: Completion[] = [
  'define', 'let', 'if', 'then', 'else', 'self', 'function', 'description',
  'true', 'false', 'null', 'and', 'or', 'not', 'contains', 'startsWith',
].map((k) => ({ label: k, type: 'keyword' }))

const PIPE_OPS: Completion[] = [
  { label: 'filter', type: 'function', info: 'filter: predicate' },
  { label: 'sort',   type: 'function', info: 'sort: field asc|desc' },
  { label: 'limit',  type: 'function', info: 'limit: n' },
  { label: 'map',    type: 'function', info: 'map: (item) => expr' },
  { label: 'pluck',  type: 'function', info: 'pluck: field' },
  { label: 'group',  type: 'function', info: 'group: field' },
  { label: 'count',  type: 'function', info: 'count' },
  { label: 'sum',    type: 'function', info: 'sum: field' },
  { label: 'any',    type: 'function', info: 'any: predicate' },
  { label: 'all',    type: 'function', info: 'all: predicate' },
]

const TYPE_NAMES: Completion[] = [
  'string', 'number', 'boolean', 'bytes', 'percentage', 'status', 'image',
  'timestamp', 'epoch_ms', 'duration', 'temperature', 'signal', 'url',
  'stream', 'collection', 'record',
].map((t) => ({ label: t, type: 'type' }))

// ── Catalog cache ─────────────────────────────────────────────────────────────

interface EntityCompletion {
  name: string
  description?: string
  fields: Record<string, { kind: 'data' | 'function'; type?: string; returnType?: string }>
}

interface ComponentCompletion {
  name: string
  kind: 'base' | 'layout' | 'derived'
  description?: string
}

let catalogCache: EntityCompletion[] = []
let componentCache: ComponentCompletion[] = []
let catalogPromise: Promise<void> | null = null

async function fetchCatalog(): Promise<void> {
  try {
    const [entitiesRes, componentsRes] = await Promise.all([
      fetch('/api/entities'),
      fetch('/api/components'),
    ])
    if (entitiesRes.ok) {
      const entities = await entitiesRes.json() as { name: string; description?: string; fields?: Record<string, { kind: 'data' | 'function'; type?: string; returnType?: string }> }[]
      catalogCache = entities.map((e) => ({
        name: e.name,
        description: e.description,
        fields: e.fields ?? {},
      }))
    }
    if (componentsRes.ok) {
      const components = await componentsRes.json() as ComponentCompletion[]
      componentCache = components.map((c) => ({
        name: c.name,
        kind: c.kind,
        description: c.description,
      }))
    }
  } catch { /* ignore — completions work without catalog */ }
}

function ensureCatalogLoaded(): void {
  if (catalogPromise === null) {
    catalogPromise = fetchCatalog()
  }
}

/** Refresh the cached catalog — call after a successful save so new entities appear. */
export function refreshCompletionCatalog(): void {
  catalogPromise = fetchCatalog()
}

// ── Completion source ─────────────────────────────────────────────────────────

export function melCompletions(context: CompletionContext): CompletionResult | null {
  ensureCatalogLoaded()

  const text = context.state.doc.toString()
  const pos = context.pos
  const before = text.slice(0, pos)

  // After `|` — offer pipe ops
  const pipeMatch = before.match(/\|\s*([a-zA-Z_][a-zA-Z0-9_-]*)?$/)
  if (pipeMatch) {
    const partial = pipeMatch[1] ?? ''
    return {
      from: pos - partial.length,
      options: PIPE_OPS,
      validFor: /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
    }
  }

  // After `.` — offer field names from the dotted path root entity
  const dotMatch = before.match(/([a-zA-Z_][a-zA-Z0-9_.\\-]*)\.([a-zA-Z_][a-zA-Z0-9_-]*)?$/)
  if (dotMatch) {
    const path = dotMatch[1]
    const partial = dotMatch[2] ?? ''
    const entity = catalogCache.find((e) => e.name === path)
    if (entity) {
      const fieldOptions: Completion[] = Object.entries(entity.fields).map(([name, f]) => ({
        label: name,
        type: f.kind === 'function' ? 'function' : 'property',
        detail: f.kind === 'function'
          ? `function → ${f.returnType ?? 'unknown'}`
          : (f.type ?? 'unknown'),
      }))
      return {
        from: pos - partial.length,
        options: fieldOptions,
        validFor: /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
      }
    }
    // Path doesn't match any known entity — no field suggestions
    return null
  }

  // After `:` — in type annotation context, offer type names.
  // Heuristic: line starts with an identifier followed by (optional whitespace +) colon.
  const lineStart = before.lastIndexOf('\n') + 1
  const line = before.slice(lineStart)
  const typeMatch = before.match(/:\s*([a-zA-Z_][a-zA-Z0-9_-]*)?$/)
  if (typeMatch) {
    const isFieldDef = /^\s*[a-zA-Z_][a-zA-Z0-9_-]*\s*:\s*[a-zA-Z_]*$/.test(line)
    if (isFieldDef) {
      const partial = typeMatch[1] ?? ''
      return {
        from: pos - partial.length,
        options: TYPE_NAMES,
        validFor: /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
      }
    }
    return null
  }

  // Bare identifier — offer entity names + component names + keywords.
  // validFor includes dots and hyphens so completion stays open while typing
  // dotted/hyphenated entity names like `home-assistant`.
  const identMatch = before.match(/([a-zA-Z_][a-zA-Z0-9_.-]*)$/)
  if (identMatch) {
    const partial = identMatch[1]
    const entityOptions: Completion[] = catalogCache.map((e) => ({
      label: e.name,
      type: 'variable',
      detail: e.description,
    }))
    const componentOptions: Completion[] = componentCache.map((c) => ({
      label: c.name,
      type: 'class',
      detail: `${c.kind} component${c.description ? ` — ${c.description}` : ''}`,
    }))
    return {
      from: pos - partial.length,
      options: [...KEYWORDS, ...entityOptions, ...componentOptions],
      validFor: /^[a-zA-Z_][a-zA-Z0-9_.-]*$/,
    }
  }

  return null
}
