/**
 * The ComponentRegistry holds all components in the system.
 *
 * Base components and layout primitives are pre-registered at construction
 * time. Derived (user-authored) components are registered at boot from the
 * database and via the CRUD API.
 */

import type { ComponentDef, TypeExpr } from '@maisie/shared'
import { validateComponentDef, BASE_COMPONENTS, LAYOUT_PRIMITIVES, satisfies } from '@maisie/shared'

export class ComponentRegistry {
  private components = new Map<string, ComponentDef>()

  constructor() {
    // Pre-register all base components and layout primitives
    for (const c of Object.values(BASE_COMPONENTS)) this.components.set(c.name, c)
    for (const c of Object.values(LAYOUT_PRIMITIVES)) this.components.set(c.name, c)
  }

  /** Register a component. Throws if validation fails. */
  register(component: ComponentDef): void {
    const errors = validateComponentDef(component)
    if (errors.length > 0) {
      throw new Error(`Invalid component "${component.name}": ${errors.join(', ')}`)
    }
    this.components.set(component.name, component)
  }

  /**
   * Unregister a derived component by name.
   * Returns false if the component doesn't exist or is a base/layout component
   * (which cannot be removed).
   */
  unregister(name: string): boolean {
    const existing = this.components.get(name)
    if (!existing || existing.kind !== 'derived') return false
    return this.components.delete(name)
  }

  get(name: string): ComponentDef | undefined {
    return this.components.get(name)
  }

  list(): ComponentDef[] {
    return [...this.components.values()]
  }

  /** Find components whose input contract is satisfied by the given candidate type. */
  findByInputShape(candidate: TypeExpr): ComponentDef[] {
    return this.list().filter((c) => {
      if (!c.input) return false
      return satisfies(candidate, c.input).ok
    })
  }

  findByKind(kind: 'base' | 'layout' | 'derived'): ComponentDef[] {
    return this.list().filter((c) => c.kind === kind)
  }

  /** Clear derived components only; base and layout remain registered. */
  clear(): void {
    for (const [name, comp] of this.components) {
      if (comp.kind === 'derived') this.components.delete(name)
    }
  }
}

/** Singleton instance. */
export const componentRegistry = new ComponentRegistry()
