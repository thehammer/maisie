/**
 * Module-level client state for the plugin.
 * Separated from index.ts to avoid circular imports with actions.ts.
 */
import { createCalibreClientFromEnv } from './client'
import { createCalibreExecFromEnv } from './exec'

// TODO: AiClient type will come from a shared package once extracted.
// For now it's typed as unknown and cast where needed.
type CalibreInstance = ReturnType<typeof createCalibreClientFromEnv>
type CalibreExecInstance = ReturnType<typeof createCalibreExecFromEnv>

let _calibre: CalibreInstance = null
let _calibreExec: CalibreExecInstance | null = null
let _ai: unknown = null
let _db: unknown = null

export function initClients(ai?: unknown, db?: unknown) {
  _calibre = createCalibreClientFromEnv()
  _calibreExec = createCalibreExecFromEnv()
  _ai = ai ?? null
  _db = db ?? null
  return { calibre: _calibre, calibreExec: _calibreExec, ai: _ai, db: _db }
}

export function getClients() {
  return {
    calibre: _calibre,
    calibreExec: _calibreExec,
    ai: _ai,
    db: _db as ReturnType<typeof import('../../agent/src/services/db').initDb> | null,
  }
}
