import { z } from 'zod'
import { defineAction, field, zodToTypeExpr } from '@maisie/shared'

const metricsSchema = z.object({
  projectName: z.string(),
  codeCoverage: field(z.number(), 'percentage'),       // 0–100
  openIssues: z.number(),
  openPrCount: z.number(),
  deployFrequency: field(z.number(), 'number'),        // deploys per week
  lastDeployedAt: field(z.string().nullable(), 'timestamp'),
  meanTimeToRestore: field(z.number().nullable(), 'duration'), // seconds
})

export const _metricsTypeExpr = zodToTypeExpr(metricsSchema)

export const getProjectMetrics = defineAction({
  name: 'get_project_metrics',
  description: 'Get current health metrics for the software project.',
  input: z.object({}),
  output: metricsSchema,
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Project Metrics', section: 'dev',
    componentHint: 'gauge' },
  async execute() {
    return {
      projectName: 'maisie',
      codeCoverage: 72,
      openIssues: 14,
      openPrCount: 3,
      deployFrequency: 3.5,
      lastDeployedAt: '2026-05-09T22:04:30Z',
      meanTimeToRestore: 1800,
    }
  },
})
