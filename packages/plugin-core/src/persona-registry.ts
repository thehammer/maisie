/**
 * PersonaRegistry — thin wrapper around the EntityRegistry.
 *
 * Personas are stored as entities with name "personas.{name}" in section
 * "personas". The entity registry is the query surface; the personaConfigs
 * DB table remains the persistence source of truth (writes go there first,
 * then the in-memory entity registry is updated).
 */

import type { PersonaConfig } from './types'
import { entityRegistry } from './entity-registry'
import { personaToEntity, entityToPersona } from './persona-convert'

export class PersonaRegistry {
  /**
   * Register a persona — stores it as an entity in the entity registry.
   * Idempotent: re-registering replaces the previous entry.
   */
  register(persona: PersonaConfig): void {
    const entity = personaToEntity(persona)
    // Unregister first if already present so register() doesn't throw on
    // the duplicate-entity-name check that validateEntityDef does not enforce
    // but the dependency graph tracking handles cleanly.
    entityRegistry.unregister(entity.name)
    entityRegistry.register(entity)
  }

  /**
   * Get a persona by name. Returns undefined if not found.
   */
  get(name: string): PersonaConfig | undefined {
    const entity = entityRegistry.get(`personas.${name}`)
    if (!entity) return undefined
    return entityToPersona(entity) ?? undefined
  }

  /**
   * List all personas currently registered as entities.
   */
  list(): PersonaConfig[] {
    return entityRegistry
      .findBySection('personas')
      .map((e) => entityToPersona(e))
      .filter((p): p is PersonaConfig => p !== null)
  }

  /**
   * Remove a persona from the entity registry.
   * Returns true if the persona was present and removed, false otherwise.
   */
  unregister(name: string): boolean {
    return entityRegistry.unregister(`personas.${name}`)
  }
}

/** Singleton instance. */
export const personaRegistry = new PersonaRegistry()
