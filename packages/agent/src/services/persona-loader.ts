/**
 * Loads persisted persona configs from the database into the entity registry
 * at agent startup.
 *
 * Called once after plugins are registered (so built-ins are already in the
 * registry) and after the database is initialized. DB personas override
 * built-in entries with the same name (custom or seeded built-ins that have
 * been persisted to the DB).
 *
 * Failures are non-fatal — logged and skipped.
 */

import { personaRegistry } from '../../../plugin-core/src/persona-registry'
import type { PersonaConfig } from '../../../plugin-core/src/types'

export async function loadPersonasIntoRegistry(db: unknown): Promise<void> {
  let loaded = 0
  let failed = 0

  try {
    const { personaConfigs } = await import('./schema')
    const { drizzle } = await import('drizzle-orm/bun-sqlite')

    // Re-use the already-open db instance by casting — same pattern as actions.ts
    const typedDb = db as ReturnType<typeof drizzle>
    const rows = await (typedDb as any).select().from(personaConfigs).all()

    for (const row of rows as any[]) {
      try {
        const persona: PersonaConfig = {
          id: row.id,
          name: row.name,
          role: row.role,
          avatar: row.avatar ?? undefined,
          defaultTier: row.default_tier ?? row.defaultTier ?? 'advise',
          eventSubscriptions: JSON.parse(row.event_subscriptions ?? row.eventSubscriptions ?? '[]'),
          toolScopes: JSON.parse(row.tool_scopes ?? row.toolScopes ?? '[]'),
          systemPrompt: row.system_prompt ?? row.systemPrompt,
          isCustom: Boolean(row.is_custom ?? row.isCustom),
        }
        personaRegistry.register(persona)
        loaded++
      } catch (err) {
        console.warn(`[persona-loader] skipping "${row.name ?? '?'}": ${err}`)
        failed++
      }
    }

    if (loaded > 0 || failed > 0) {
      console.log(
        `  ✓ Loaded ${loaded} persona${loaded !== 1 ? 's' : ''} into entity registry${failed > 0 ? ` (${failed} failed)` : ''}`,
      )
    }
  } catch (err) {
    console.warn(`[persona-loader] failed to load personas: ${err}`)
  }
}
