import { z } from 'zod'
import { defineAction } from '@maisie/shared'
import type { HpPrinterClient } from './client'

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
