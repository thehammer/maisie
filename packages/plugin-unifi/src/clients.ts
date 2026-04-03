/**
 * Module-level client state for the plugin.
 * Separated from index.ts to avoid circular imports with actions.ts.
 */
import { createUniFiClientFromEnv, createProtectClientFromEnv } from './client'

type UniFiInstance = ReturnType<typeof createUniFiClientFromEnv>
type ProtectInstance = ReturnType<typeof createProtectClientFromEnv>

let _unifi: UniFiInstance = null
let _protect: ProtectInstance = null

export function initClients() {
  _unifi = createUniFiClientFromEnv()
  _protect = createProtectClientFromEnv()
  return { unifi: _unifi, protect: _protect }
}

export function getClients() {
  return { unifi: _unifi, protect: _protect }
}
