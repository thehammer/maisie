/**
 * Module-level client state for the Synology plugin.
 */
import { createDsmClientFromEnv } from './client'

type DsmInstance = ReturnType<typeof createDsmClientFromEnv>

let _dsm: DsmInstance = null

export function initClients() {
  _dsm = createDsmClientFromEnv()
  return { dsm: _dsm }
}

export function getClients() {
  return { dsm: _dsm }
}
