import { z } from 'zod'
import { defineAction } from '@maisie/shared'
import type { BambuClient, BambuPrintStatus } from './client'
import { analyze3mf } from './mesh-repair'

let _client: BambuClient | null = null

export function setClient(client: BambuClient | null) {
  _client = client
}

function getClient(): BambuClient {
  if (!_client) throw new Error('Bambu printer not configured')
  return _client
}

const printerStatusSchema = z.object({
  state: z.string(),
  progress: z.number(),
  remainingMinutes: z.number(),
  fileName: z.string(),
  nozzleTemp: z.number(),
  nozzleTarget: z.number(),
  bedTemp: z.number(),
  bedTarget: z.number(),
  chamberTemp: z.number(),
  speed: z.number(),
  wifiSignal: z.string(),
  layer: z.number(),
  filaments: z.array(z.object({
    slot: z.number(),
    type: z.string(),
    color: z.string(),
  })),
}).nullable()

export const getStatus = defineAction({
  name: 'get_print_status',
  description: 'Get current 3D printer status: state, temperatures, active job, filament remaining.',
  input: z.object({}),
  output: printerStatusSchema,
  http: { method: 'GET' },
  ai: { tier: 'inform', description: 'Get current 3D printer status: state, temperatures, active job, filament remaining.' },
  ui: { type: 'data', label: 'Printer Status', section: 'printer', realtimeTopic: 'home/printer/bambu/status' },
  async execute(_input, _ctx) {
    return getClient().getStatus()
  },
})

export const pausePrint = defineAction({
  name: 'invoke_pause_print',
  description: 'Pause the active print job.',
  input: z.object({}),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST' },
  ai: { tier: 'advise', description: 'Pause the active print job. Use advise tier — affects physical hardware mid-print.' },
  ui: { type: 'action', label: 'Pause', section: 'printer' },
  async execute(_input, _ctx) {
    getClient().pausePrint()
    return { success: true }
  },
})

export const resumePrint = defineAction({
  name: 'invoke_resume_print',
  description: 'Resume a paused print job.',
  input: z.object({}),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST' },
  ai: { tier: 'advise' },
  ui: { type: 'action', label: 'Resume', section: 'printer' },
  async execute(_input, _ctx) {
    getClient().resumePrint()
    return { success: true }
  },
})

export const cancelPrint = defineAction({
  name: 'invoke_cancel_print',
  description: 'Cancel the active print job. Irreversible.',
  input: z.object({}),
  output: z.object({ success: z.boolean() }),
  http: { method: 'POST' },
  ai: { tier: 'advise', description: 'Cancel the active print job. Irreversible — use advise tier.' },
  ui: { type: 'action', label: 'Cancel', section: 'printer' },
  async execute(_input, _ctx) {
    getClient().cancelPrint()
    return { success: true }
  },
})

export const analyzeMesh = defineAction({
  name: 'invoke_analyze_mesh',
  description: 'Analyze a 3MF file for mesh quality issues before printing.',
  input: z.object({ filePath: z.string() }),
  output: z.object({
    issues: z.array(z.string()),
    issueSeverity: z.enum(['none', 'minor', 'major']),
  }),
  http: { method: 'POST' },
  ai: { tier: 'advise', description: 'Analyze a 3MF file for mesh quality issues before printing.' },
  ui: { type: 'action', label: 'Analyze 3MF', section: 'printer' },
  async execute(input, _ctx) {
    const analysis = await analyze3mf(input.filePath)
    const issues = analysis.objects
      .filter(o => o.totalIssues > 0)
      .map(o => `${o.objectName}: ${o.totalIssues} issue(s) — boundary edges: ${o.boundaryEdges}, non-manifold: ${o.nonManifoldEdges}, duplicates: ${o.duplicateFaces}, degenerate: ${o.degenerateFaces}`)

    const severity = analysis.issueCount === 0
      ? 'none'
      : analysis.issueCount < 10
        ? 'minor'
        : 'major'

    return { issues, issueSeverity: severity }
  },
})
