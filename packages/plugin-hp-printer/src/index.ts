import type { MaisiePlugin } from '@maisie/shared'
import * as actionDefs from './actions'
import * as eventDefs from './events'
import { setClient, getSupplyLevels } from './actions'
import { createHpPrinterClientFromEnv } from './client'

// Low-ink threshold for emit events
const LOW_INK_THRESHOLD = 20

// Poll interval for status/supply checks (5 min)
const POLL_INTERVAL_MS = 5 * 60 * 1_000

let _pollTimer: ReturnType<typeof setInterval> | null = null

const plugin: MaisiePlugin = {
  name: 'hp-printer',
  version: '0.1.0',
  description: 'HP inkjet/laser printer monitoring via Embedded Web Server',
  capabilities: ['inkjet-printer'],
  envVars: [
    {
      name: 'HP_PRINTER_HOST',
      required: true,
      description: 'HP printer IP address or hostname',
      example: '192.168.1.50',
      discoverAction: 'discover_printer',
    },
  ],
  actions: Object.values(actionDefs).filter(v => typeof v === 'object' && 'name' in v) as any,
  events: Object.values(eventDefs),

  async init(core) {
    const client = createHpPrinterClientFromEnv()
    if (!client) {
      core.log('hp-printer', 'warn', 'HP_PRINTER_HOST not configured — printer actions unavailable')
      return
    }

    setClient(client)

    // Verify connectivity
    const reachable = await client.ping()
    if (!reachable) {
      core.log('hp-printer', 'warn', 'HP printer configured but not reachable at startup')
    }

    // Periodic status poll — emits events for low ink and errors
    _pollTimer = setInterval(async () => {
      try {
        const [supplies, status] = await Promise.all([
          client.getSupplyLevels(),
          client.getStatus(),
        ])

        // Emit supply_low for any cartridge below threshold
        for (const cartridge of supplies) {
          if (
            cartridge.levelPercent !== null &&
            cartridge.levelPercent < LOW_INK_THRESHOLD
          ) {
            core.emit('home/hp-printer/supply_low', {
              cartridge: cartridge.name,
              levelPercent: cartridge.levelPercent,
            })
          }
        }

        // Emit error event if printer moves into error state
        if (status.state === 'error') {
          core.emit('home/hp-printer/error', {
            state: status.state,
            raw: status.raw,
          })
        }

        // Broadcast current status for dashboard realtime updates
        core.emit('home/hp-printer/status', { supplies, status })
      } catch (err) {
        core.log('hp-printer', 'warn', `Poll failed: ${err instanceof Error ? err.message : err}`)
      }
    }, POLL_INTERVAL_MS)
  },

  async shutdown() {
    if (_pollTimer) {
      clearInterval(_pollTimer)
      _pollTimer = null
    }
    setClient(null)
  },

  async healthCheck() {
    const client = createHpPrinterClientFromEnv()
    if (!client) {
      return { status: 'offline', message: 'HP_PRINTER_HOST not configured', lastCheck: new Date() }
    }
    try {
      const reachable = await client.ping()
      return {
        status: reachable ? 'healthy' : 'offline',
        message: reachable ? undefined : 'Printer not reachable',
        lastCheck: new Date(),
      }
    } catch (err) {
      return {
        status: 'offline',
        message: err instanceof Error ? err.message : 'Printer unreachable',
        lastCheck: new Date(),
      }
    }
  },
}

export default plugin
