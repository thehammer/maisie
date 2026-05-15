import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import { AdapterRegistry } from '@maisie/callimachus'
import type { Chunk, LlmClient, Entity } from '@maisie/callimachus'
import { BookAdapter, createBookAdapter } from '../index'
import { chapterPath, scenePath } from '../path'

const FIXTURES = join(import.meta.dir, '../../test-fixtures')
const SAMPLE_TXT = join(FIXTURES, 'sample.txt')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(corpus_id = 'xenos') {
  return new BookAdapter({ corpus_id })
}

async function collectChunks(adapter: BookAdapter, sourcePath: string): Promise<Chunk[]> {
  const sources = await adapter.discover(sourcePath)
  const chunks: Chunk[] = []
  for (const source of sources) {
    for await (const chunk of adapter.chunk(source)) {
      chunks.push(chunk)
    }
  }
  return chunks
}

// Fake LLM client that returns canned JSON
function makeFakeLlm(response: string): LlmClient {
  return {
    complete: (_prompt: string, _opts?: { model?: string; max_tokens?: number }) =>
      Promise.resolve(response),
  }
}

// ---------------------------------------------------------------------------
// discover
// ---------------------------------------------------------------------------

describe('BookAdapter.discover', () => {
  it('returns one source for a plain-text file', async () => {
    const adapter = makeAdapter()
    const sources = await adapter.discover(SAMPLE_TXT)
    expect(sources).toHaveLength(1)
    expect(sources[0].kind).toBe('txt')
    expect(sources[0].corpus_id).toBe('xenos')
  })

  it('throws for unsupported extension', async () => {
    const adapter = makeAdapter()
    expect(adapter.discover('/fake/book.docx')).rejects.toThrow(/Unsupported/)
  })
})

// ---------------------------------------------------------------------------
// chunk — plain text
// ---------------------------------------------------------------------------

describe('BookAdapter.chunk (plain text)', () => {
  it('yields chapter and scene chunks for sample.txt', async () => {
    const adapter = makeAdapter()
    const chunks = await collectChunks(adapter, SAMPLE_TXT)

    const chapterChunks = chunks.filter((c) => c.kind === 'chapter')
    const sceneChunks = chunks.filter((c) => c.kind === 'scene')

    expect(chapterChunks).toHaveLength(3)
    expect(sceneChunks.length).toBeGreaterThanOrEqual(3) // at least one scene per chapter
  })

  it('chapter chunks have null parent_path', async () => {
    const adapter = makeAdapter()
    const chunks = await collectChunks(adapter, SAMPLE_TXT)
    for (const ch of chunks.filter((c) => c.kind === 'chapter')) {
      expect(ch.parent_path).toBeNull()
    }
  })

  it('scene chunks have correct parent_path matching their chapter', async () => {
    const adapter = makeAdapter()
    const chunks = await collectChunks(adapter, SAMPLE_TXT)
    const scenes = chunks.filter((c) => c.kind === 'scene')
    for (const scene of scenes) {
      // parent_path should be ch/<N>
      expect(scene.parent_path).toMatch(/^ch\/\d+$/)
    }
  })

  it('chunk IDs are deterministic — two runs produce identical IDs', async () => {
    const adapter1 = makeAdapter()
    const adapter2 = makeAdapter()
    const chunks1 = await collectChunks(adapter1, SAMPLE_TXT)
    const chunks2 = await collectChunks(adapter2, SAMPLE_TXT)

    expect(chunks1.map((c) => c.id)).toEqual(chunks2.map((c) => c.id))
  })

  it('all chunks carry the correct corpus_id', async () => {
    const adapter = makeAdapter('mylib')
    const chunks = await collectChunks(adapter, SAMPLE_TXT)
    for (const chunk of chunks) {
      expect(chunk.corpus_id).toBe('mylib')
    }
  })

  it('byte_length matches content', async () => {
    const adapter = makeAdapter()
    const chunks = await collectChunks(adapter, SAMPLE_TXT)
    for (const chunk of chunks) {
      expect(chunk.byte_length).toBe(Buffer.byteLength(chunk.content, 'utf-8'))
    }
  })
})

// ---------------------------------------------------------------------------
// extractStructure
// ---------------------------------------------------------------------------

describe('BookAdapter.extractStructure', () => {
  it('chapter returns null parent_path and scene children', async () => {
    const adapter = makeAdapter()
    const chunks = await collectChunks(adapter, SAMPLE_TXT)
    const ch1 = chunks.find((c) => c.kind === 'chapter' && c.location.path === chapterPath(1))!
    expect(ch1).toBeDefined()

    const structure = await adapter.extractStructure(ch1)
    expect(structure.parent_path).toBeNull()
    expect(structure.children.length).toBeGreaterThanOrEqual(1)
    for (const child of structure.children) {
      expect(child).toMatch(/^ch\/1\/sc\/\d+$/)
    }
    expect(structure.metadata.word_count).toBeGreaterThan(0)
  })

  it('scene returns correct parent_path and empty children', async () => {
    const adapter = makeAdapter()
    const chunks = await collectChunks(adapter, SAMPLE_TXT)
    const scene = chunks.find((c) => c.kind === 'scene' && c.location.path === scenePath(1, 1))!
    expect(scene).toBeDefined()

    const structure = await adapter.extractStructure(scene)
    expect(structure.parent_path).toBe(chapterPath(1))
    expect(structure.children).toHaveLength(0)
    expect(structure.metadata.position_in_chapter).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// formatLocation / parseLocation
// ---------------------------------------------------------------------------

describe('BookAdapter.formatLocation / parseLocation', () => {
  it('round-trips chapter location', async () => {
    const adapter = makeAdapter('xenos')
    const chunks = await collectChunks(adapter, SAMPLE_TXT)
    const ch1 = chunks.find((c) => c.kind === 'chapter')!

    const uri = adapter.formatLocation(ch1)
    const parsed = adapter.parseLocation(uri)
    expect(parsed.corpus_id).toBe('xenos')
    expect(parsed.path).toBe(ch1.location.path)
  })

  it('round-trips scene location', async () => {
    const adapter = makeAdapter('xenos')
    const chunks = await collectChunks(adapter, SAMPLE_TXT)
    const scene = chunks.find((c) => c.kind === 'scene')!

    const uri = adapter.formatLocation(scene)
    const parsed = adapter.parseLocation(uri)
    expect(parsed.corpus_id).toBe('xenos')
    expect(parsed.path).toBe(scene.location.path)
  })
})

// ---------------------------------------------------------------------------
// extractWithLlm
// ---------------------------------------------------------------------------

describe('BookAdapter.extractWithLlm', () => {
  it('returns well-shaped ExtractedSemantic for a scene chunk', async () => {
    const adapter = makeAdapter()
    const chunks = await collectChunks(adapter, SAMPLE_TXT)
    const scene = chunks.find((c) => c.kind === 'scene')!

    const cannedResponse = JSON.stringify({
      entities: [
        { canonical_name: 'Vance', kind: 'character', aliases: ['Investigator Vance'], description: 'An investigator.' },
        { canonical_name: 'Marit', kind: 'character', aliases: [], description: null },
      ],
      summary_text: 'Vance and Marit arrive at the facility.',
    })

    const llm = makeFakeLlm(cannedResponse)
    const result = await adapter.extractWithLlm!(scene, llm)

    expect(result.entities).toHaveLength(2)
    expect(result.entities[0].canonical_name).toBe('Vance')
    expect(result.summary_text).toBe('Vance and Marit arrive at the facility.')
  })

  it('returns empty entities and null summary for chapter chunks', async () => {
    const adapter = makeAdapter()
    const chunks = await collectChunks(adapter, SAMPLE_TXT)
    const chapter = chunks.find((c) => c.kind === 'chapter')!

    const llm = makeFakeLlm('{}') // should not be called
    const result = await adapter.extractWithLlm!(chapter, llm)
    expect(result.entities).toHaveLength(0)
    expect(result.summary_text).toBeNull()
  })

  it('throws on malformed JSON', async () => {
    const adapter = makeAdapter()
    const chunks = await collectChunks(adapter, SAMPLE_TXT)
    const scene = chunks.find((c) => c.kind === 'scene')!
    const llm = makeFakeLlm('not json at all')
    expect(adapter.extractWithLlm!(scene, llm)).rejects.toThrow(/malformed JSON/)
  })
})

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

describe('BookAdapter.summarize', () => {
  it('returns a well-shaped Summary', async () => {
    const adapter = makeAdapter('xenos')
    const chunks = await collectChunks(adapter, SAMPLE_TXT)
    const scene = chunks.find((c) => c.kind === 'scene')!

    const llm = makeFakeLlm('Vance and Marit explore the facility and uncover secrets.')
    const summary = await adapter.summarize!(scene, llm, 'scene')

    expect(summary.corpus_id).toBe('xenos')
    expect(summary.target_kind).toBe('chunk')
    expect(summary.target_id).toBe(scene.id)
    expect(summary.depth).toBe('scene')
    expect(summary.text).toContain('Vance')
    expect(summary.model).toBe('claude-sonnet-4')
  })
})

// ---------------------------------------------------------------------------
// resolveAliases
// ---------------------------------------------------------------------------

describe('BookAdapter.resolveAliases', () => {
  it('clusters entities by surname', async () => {
    const adapter = makeAdapter()

    const baseEntity: Entity = {
      id: '',
      corpus_id: 'xenos',
      canonical_name: '',
      kind: 'character',
      aliases: [],
      description: null,
      first_location: null,
      last_location: null,
      appearance_count: 1,
      confidence: 0.9,
    }

    const entities: Entity[] = [
      { ...baseEntity, id: 'e1', canonical_name: 'Vance' },
      { ...baseEntity, id: 'e2', canonical_name: 'Investigator Vance' },
      { ...baseEntity, id: 'e3', canonical_name: 'Marit' },
    ]

    const merges = await adapter.resolveAliases!(entities)
    expect(merges).toHaveLength(1) // only Vance/Investigator Vance cluster
    const merge = merges[0]
    expect(merge.canonical).toBe('Investigator Vance') // longest
    expect(merge.aliases).toContain('Vance')
    expect(merge.entity_ids).toContain('e1')
    expect(merge.entity_ids).toContain('e2')
  })
})

// ---------------------------------------------------------------------------
// AdapterRegistry integration
// ---------------------------------------------------------------------------

describe('createBookAdapter + AdapterRegistry', () => {
  it('registers and retrieves the adapter by kind', () => {
    const registry = new AdapterRegistry()
    const adapter = createBookAdapter({ corpus_id: 'xenos' })
    registry.register(adapter)

    const retrieved = registry.get('book')
    expect(retrieved).toBe(adapter)
    expect(retrieved?.kind).toBe('book')
    expect(retrieved?.version).toBe('0.1.0')
  })

  it('createBookAdapter returns a SourceAdapter-compatible object', () => {
    const adapter = createBookAdapter()
    // Check all required interface members are present
    expect(typeof adapter.kind).toBe('string')
    expect(typeof adapter.version).toBe('string')
    expect(typeof adapter.discover).toBe('function')
    expect(typeof adapter.chunk).toBe('function')
    expect(typeof adapter.extractStructure).toBe('function')
    expect(typeof adapter.formatLocation).toBe('function')
    expect(typeof adapter.parseLocation).toBe('function')
    // Optional hooks
    expect(typeof adapter.extractWithLlm).toBe('function')
    expect(typeof adapter.summarize).toBe('function')
    expect(typeof adapter.resolveAliases).toBe('function')
  })
})
