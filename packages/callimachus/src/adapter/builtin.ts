import type { AdapterRegistry } from './registry'

/**
 * Soft-register built-in adapters.
 * Uses dynamic import so @maisie/callimachus has no hard runtime dependency
 * on adapter packages. If the package is not present, logs a warning and continues.
 */
export async function registerBuiltinAdapters(registry: AdapterRegistry): Promise<void> {
  // Book adapter
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — optional peer dependency; may not be installed
    const mod = await import('@maisie/callimachus-adapter-book')
    if (typeof mod.createBookAdapter === 'function') {
      // createBookAdapter requires a corpus_id at construction time, but the
      // registry pattern expects a single registered adapter for the 'book' kind.
      // We register a factory-built instance with an empty corpus_id as a
      // placeholder; the actual corpus_id is always passed through the Corpus
      // object during indexing — adapters that need it read it from the chunk.
      const adapter = mod.createBookAdapter({ corpus_id: '' })
      registry.register(adapter)
    }
  } catch {
    console.warn(
      '[callimachus] @maisie/callimachus-adapter-book is not available. ' +
        'Install the package to enable book indexing.',
    )
  }
}
