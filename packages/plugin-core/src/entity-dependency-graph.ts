import type { EntityDef, ExprNode } from '@maisie/shared'

/**
 * Tracks which derived entities depend on which base entities.
 * When a base entity emits an event, the graph identifies all affected
 * derived entities so they can be invalidated.
 */
export class EntityDependencyGraph {
  // Map from base entity name → set of derived entity names that depend on it
  private dependents = new Map<string, Set<string>>()
  // Map from derived entity name → set of base entity names it depends on
  private dependencies = new Map<string, Set<string>>()

  /** Register a derived entity's dependencies based on its expressions. */
  register(entity: EntityDef, knownEntityNames: Set<string>): void {
    if (entity.source !== 'derived') return
    const deps = new Set<string>()
    for (const field of Object.values(entity.fields)) {
      if (field.expression) {
        collectRefs(field.expression, deps, knownEntityNames)
      }
    }
    this.dependencies.set(entity.name, deps)
    for (const base of deps) {
      if (!this.dependents.has(base)) this.dependents.set(base, new Set())
      this.dependents.get(base)!.add(entity.name)
    }
  }

  /** Unregister a derived entity (used on delete or update). */
  unregister(entityName: string): void {
    const deps = this.dependencies.get(entityName)
    if (deps) {
      for (const base of deps) {
        this.dependents.get(base)?.delete(entityName)
      }
    }
    this.dependencies.delete(entityName)
  }

  /** Find all derived entities that directly depend on the given base entity. */
  dependentsOf(baseEntityName: string): string[] {
    return [...(this.dependents.get(baseEntityName) ?? [])]
  }

  /**
   * Transitive: find all derived entities reachable from a base entity.
   * A derived entity can itself depend on another derived entity.
   */
  transitiveDependentsOf(baseEntityName: string): string[] {
    const visited = new Set<string>()
    const queue = [baseEntityName]
    const result: string[] = []
    while (queue.length > 0) {
      const name = queue.shift()!
      for (const dep of this.dependentsOf(name)) {
        if (!visited.has(dep)) {
          visited.add(dep)
          result.push(dep)
          queue.push(dep)
        }
      }
    }
    return result
  }

  clear(): void {
    this.dependents.clear()
    this.dependencies.clear()
  }
}

/**
 * Walk an expression tree, collecting RefNode names that match known entity
 * names. We match the longest prefix — "home-assistant.list_switches.name"
 * should collect "home-assistant.list_switches" (an entity), not
 * "home-assistant" (not an entity).
 */
function collectRefs(node: ExprNode, into: Set<string>, knownEntityNames: Set<string>): void {
  switch (node.kind) {
    case 'literal':
      return

    case 'ref': {
      // Find longest matching entity name prefix
      const name = node.name
      let bestMatch: string | null = null
      for (const entityName of knownEntityNames) {
        if (name === entityName || name.startsWith(entityName + '.')) {
          if (!bestMatch || entityName.length > bestMatch.length) {
            bestMatch = entityName
          }
        }
      }
      if (bestMatch) into.add(bestMatch)
      return
    }

    case 'lambda':
      collectRefs(node.body, into, knownEntityNames)
      return

    case 'apply':
      for (const arg of node.args) collectRefs(arg, into, knownEntityNames)
      return

    case 'let':
      for (const b of node.bindings) collectRefs(b.value, into, knownEntityNames)
      collectRefs(node.body, into, knownEntityNames)
      return

    case 'pipe':
      collectRefs(node.value, into, knownEntityNames)
      for (const step of node.steps) collectRefs(step, into, knownEntityNames)
      return
  }
}

export const entityDependencyGraph = new EntityDependencyGraph()
