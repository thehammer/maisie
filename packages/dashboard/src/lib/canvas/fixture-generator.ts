import type { TypeExpr, MaisieValue, MaisieRecord, MaisieFieldType } from '@maisie/shared'

export interface FixtureOptions {
  /** Number of elements for collections (default: 3). */
  collectionSize?: number
  /** Deterministic seed for reproducible fixtures (default: 0). */
  seed?: number
}

/**
 * Generate a synthetic value matching the given type contract.
 * Used by the canvas preview to render components whose data source
 * isn't wired or isn't resolvable at authoring time.
 */
export function generateFixture(type: TypeExpr, options: FixtureOptions = {}): MaisieValue {
  const opts = { collectionSize: 3, seed: 0, ...options }
  return gen(type, opts, 0)
}

function gen(type: TypeExpr, opts: Required<FixtureOptions>, depth: number): MaisieValue {
  if (depth > 8) return null  // safety

  switch (type.kind) {
    case 'scalar':
      return genScalar(type.type, opts, depth)
    case 'record': {
      const record: MaisieRecord = {}
      for (const [key, fieldType] of Object.entries(type.fields)) {
        const isOptional = type.optional?.includes(key)
        if (isOptional && depth > 2) continue  // skip optionals at deep levels
        record[key] = gen(fieldType, opts, depth + 1)
      }
      return record
    }
    case 'collection':
      return Array.from({ length: opts.collectionSize }, (_, i) =>
        gen(type.element, { ...opts, seed: opts.seed + i }, depth + 1) as MaisieRecord,
      )
    case 'function':
    case 'component':
      return null  // not fixturable
    case 'any':
      return 'example'
    case 'optional':
      return gen(type.inner, opts, depth + 1)
    case 'union':
      return type.members.length > 0 ? gen(type.members[0], opts, depth + 1) : null
    default:
      return null
  }
}

function genScalar(fieldType: MaisieFieldType, opts: Required<FixtureOptions>, depth: number): MaisieValue {
  switch (fieldType) {
    case 'string':      return example('Example', opts.seed + depth)
    case 'number':      return 42 + (opts.seed + depth) * 7
    case 'boolean':     return (opts.seed + depth) % 2 === 0
    case 'bytes':       return 1_200_000_000 + (opts.seed + depth) * 100_000
    case 'percentage':  return Math.min(100, 20 + (opts.seed + depth) * 13)
    case 'status':      return ['ok', 'warning', 'error', 'idle'][(opts.seed + depth) % 4]
    case 'image':       return `https://placehold.co/240x360?text=Example+${opts.seed + depth}`
    case 'url':         return `https://example.com/item/${opts.seed + depth}`
    case 'timestamp':   return new Date(Date.now() - (opts.seed + depth) * 3_600_000).toISOString()
    case 'epoch_ms':    return Date.now() - (opts.seed + depth) * 3_600_000
    case 'duration':    return 60 * (opts.seed + depth + 1)
    case 'temperature': return 20 + (opts.seed + depth)
    case 'signal':      return -45 - (opts.seed + depth) * 3
    case 'stream':      return `https://example.com/stream/${opts.seed + depth}`
    case 'toggle':      return (opts.seed + depth) % 2 === 0
    case 'action':      return null
    case 'progress':    return { current: 30 + opts.seed, total: 100 } as MaisieRecord
    case 'json':        return { example: true } as MaisieRecord
    case 'record':      return { value: example('Record', opts.seed + depth) } as MaisieRecord
    case 'collection':  return []
    default:            return 'example'
  }
}

function example(base: string, seed: number): string {
  const suffixes = ['One', 'Two', 'Three', 'Four', 'Five']
  return `${base} ${suffixes[seed % suffixes.length]}`
}
