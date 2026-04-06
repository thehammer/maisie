import { z } from 'zod'
import { defineAction } from '@maisie/shared'
import type { HpPrinterClient } from './client'
import { looksLikeHp, probeForEws } from './client'

let _client: HpPrinterClient | null = null

export function setClient(client: HpPrinterClient | null) {
  _client = client
}

function getClient(): HpPrinterClient {
  if (!_client) throw new Error('HP printer not configured — set HP_PRINTER_HOST in .env')
  return _client
}

// ── Schemas ────────────────────────────────────────────────────────────────

const cartridgeSchema = z.object({
  name: z.string(),
  levelPercent: z.number().nullable(),
  state: z.enum(['ok', 'low', 'depleted', 'missing', 'unknown']),
})

const statusSchema = z.object({
  state: z.enum(['ready', 'printing', 'error', 'offline', 'warning', 'unknown']),
  raw: z.string(),
})

const usageSchema = z.object({
  totalPages: z.number(),
  colorPages: z.number().nullable(),
  monoPages: z.number().nullable(),
})

// ── Actions ────────────────────────────────────────────────────────────────

export const getSupplyLevels = defineAction({
  name: 'get_supply_levels',
  description: 'Get ink or toner levels for all cartridges in the HP printer. Returns percentage remaining and state (ok/low/depleted) per cartridge.',
  input: z.object({}),
  output: z.array(cartridgeSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Get current ink/toner levels for the HP printer.' },
  ui: {
    type: 'data',
    label: 'Ink Levels',
    section: 'printer',
    icon: 'droplet',
    realtimeTopic: 'home/hp-printer/status',
  },
  async execute(_input, _ctx) {
    return getClient().getSupplyLevels()
  },
})

export const getStatus = defineAction({
  name: 'get_status',
  description: 'Get the current operational status of the HP printer (ready, printing, error, offline, etc.).',
  input: z.object({}),
  output: statusSchema,
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Get current HP printer status.' },
  ui: {
    type: 'data',
    label: 'Printer Status',
    section: 'printer',
    icon: 'printer',
    realtimeTopic: 'home/hp-printer/status',
  },
  async execute(_input, _ctx) {
    return getClient().getStatus()
  },
})

export const getUsage = defineAction({
  name: 'get_usage',
  description: 'Get total page counts from the HP printer (total, color, and monochrome impressions).',
  input: z.object({}),
  output: usageSchema,
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Get HP printer total page usage counts.' },
  ui: {
    type: 'data',
    label: 'Page Count',
    section: 'printer',
    icon: 'file',
  },
  async execute(_input, _ctx) {
    return getClient().getUsage()
  },
})

export const discoverPrinter = defineAction({
  name: 'discover_printer',
  description: 'Scan the network for HP printers using the UniFi device list and EWS probe. Returns the IP of the first printer found.',
  input: z.object({}),
  output: z.object({
    value: z.string(),  // HP_PRINTER_HOST value — empty string if none found
    candidates: z.array(z.object({ ip: z.string(), name: z.string().optional() })),
  }),
  http: { method: 'POST', path: '/discover' },
  ai: false,
  ui: false,
  async execute(_input, _ctx) {
    // Pull UniFi device list from the local Maisie API
    const apiBase = process.env.MAISIE_INTERNAL_URL ?? 'http://localhost:3001'
    let devices: Array<{ ip?: string; mac?: string; name?: string; manufacturer?: string }> = []
    try {
      const res = await fetch(`${apiBase}/api/devices`, { signal: AbortSignal.timeout(5_000) })
      if (res.ok) {
        const data = await res.json() as { devices?: typeof devices } | typeof devices
        devices = Array.isArray(data) ? data : (data as any).devices ?? []
      }
    } catch {
      // UniFi unavailable — fall through with empty list
    }

    const withIp = devices.filter(d => !!d.ip)

    // Probe all devices in parallel — EWS response is distinctive enough that
    // false positives won't occur, and parallel LAN probes complete in ~1s.
    // (OUI-based pre-filtering was unreliable: field name varies across API
    // versions and HP server OUIs match non-printer HP hardware.)
    const results = await Promise.all(
      withIp.map(async (device) => {
        const isEws = await probeForEws(device.ip!)
        return isEws ? { ip: device.ip!, name: (device as any).name } : null
      })
    )

    const found = results.filter((r): r is { ip: string; name?: string } => r !== null)

    return {
      value: found[0]?.ip ?? '',
      candidates: found,
    }
  },
})
