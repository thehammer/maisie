/**
 * The ViewRegistry holds all named views in the system.
 *
 * Views are user-authored compositions of entity + function chain + component.
 * They are registered at boot from the database and managed via the CRUD API.
 */

import type { ViewDef } from '@maisie/shared'
import { validateViewDef } from '@maisie/shared'

export class ViewRegistry {
  private views = new Map<string, ViewDef>()

  /** Register a view. Throws if validation fails. */
  register(view: ViewDef): void {
    const errors = validateViewDef(view)
    if (errors.length > 0) {
      throw new Error(`Invalid view "${view.name}": ${errors.join(', ')}`)
    }
    this.views.set(view.name, view)
  }

  /** Unregister a view by name. Returns false if not found. */
  unregister(name: string): boolean {
    return this.views.delete(name)
  }

  get(name: string): ViewDef | undefined {
    return this.views.get(name)
  }

  list(): ViewDef[] {
    return [...this.views.values()]
  }

  /** Clear all views (for testing). */
  clear(): void {
    this.views.clear()
  }
}

/** Singleton instance. */
export const viewRegistry = new ViewRegistry()
