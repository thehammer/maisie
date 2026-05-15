import type { SourceAdapter } from './contract'

/**
 * Registry mapping adapter kind strings to SourceAdapter implementations.
 * No adapters are registered here — that happens when adapter packages land.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, SourceAdapter>()

  register(adapter: SourceAdapter): void {
    this.adapters.set(adapter.kind, adapter)
  }

  get(kind: string): SourceAdapter | undefined {
    return this.adapters.get(kind)
  }

  list(): string[] {
    return Array.from(this.adapters.keys())
  }
}
