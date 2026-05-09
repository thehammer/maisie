import { BASE_COMPONENTS, LAYOUT_PRIMITIVES } from '@maisie/shared'
import type { ComponentDef } from '@maisie/shared'

/**
 * ComponentRegistry — the runtime index of all platform-registered components.
 *
 * At construction time, all BASE_COMPONENTS and LAYOUT_PRIMITIVES from
 * @maisie/shared are pre-registered. Plugins may not add to this registry;
 * new components require a deliberate protocol change (editing
 * packages/shared/src/component-registry-data.ts).
 *
 * Access the singleton via `componentRegistry`.
 */
export class ComponentRegistry {
  private components = new Map<string, ComponentDef>()

  constructor() {
    for (const component of Object.values(BASE_COMPONENTS)) {
      this.components.set(component.name, component)
    }
    for (const component of Object.values(LAYOUT_PRIMITIVES)) {
      this.components.set(component.name, component)
    }
  }

  /** Retrieve a component definition by name, or undefined if not registered. */
  get(name: string): ComponentDef | undefined {
    return this.components.get(name)
  }

  /** All registered base components (excludes layout primitives). */
  getBaseComponents(): ComponentDef[] {
    return [...this.components.values()].filter((c) => c.kind === 'base')
  }

  /** All registered layout primitives (excludes base components). */
  getLayoutPrimitives(): ComponentDef[] {
    return [...this.components.values()].filter((c) => c.kind === 'layout')
  }

  /** All registered component names. */
  getNames(): string[] {
    return [...this.components.keys()]
  }

  /** True if the named component is registered. */
  has(name: string): boolean {
    return this.components.has(name)
  }
}

/** Singleton component registry — pre-populated at module load time. */
export const componentRegistry = new ComponentRegistry()
