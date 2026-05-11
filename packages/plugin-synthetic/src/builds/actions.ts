import { z } from 'zod'
import { defineAction, field, zodToTypeExpr } from '@maisie/shared'

const buildStatusEnum = z.enum(['pending', 'running', 'success', 'failed', 'cancelled'])

const buildSchema = z.object({
  id: z.string(),
  branch: z.string(),
  commit: z.string(),
  status: field(buildStatusEnum, 'status'),
  startedAt: field(z.string().nullable(), 'timestamp'),
  finishedAt: field(z.string().nullable(), 'timestamp'),
  durationSeconds: field(z.number().nullable(), 'duration'),
  triggeredBy: z.string(),
})

export const _buildTypeExpr = zodToTypeExpr(buildSchema)
export const _buildListTypeExpr = zodToTypeExpr(z.array(buildSchema))

const STUB_BUILDS = [
  { id: 'B-101', branch: 'main', commit: 'abc123f', status: 'success' as const,
    startedAt: '2026-05-09T22:00:00Z', finishedAt: '2026-05-09T22:04:30Z',
    durationSeconds: 270, triggeredBy: 'push' },
  { id: 'B-102', branch: 'feature/auth', commit: 'def456a', status: 'failed' as const,
    startedAt: '2026-05-10T08:15:00Z', finishedAt: '2026-05-10T08:17:00Z',
    durationSeconds: 120, triggeredBy: 'pull_request' },
  { id: 'B-103', branch: 'main', commit: 'ghi789b', status: 'running' as const,
    startedAt: '2026-05-10T10:00:00Z', finishedAt: null,
    durationSeconds: null, triggeredBy: 'push' },
]

export const listBuilds = defineAction({
  name: 'list_builds',
  description: 'List recent CI/CD builds, optionally filtered by branch.',
  input: z.object({
    branch: z.string().optional(),
    limit: z.number().default(10),
  }),
  output: z.array(buildSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Build History', section: 'dev' },
  async execute(input) {
    let builds = STUB_BUILDS
    if (input.branch) builds = builds.filter(b => b.branch === input.branch)
    return builds.slice(0, input.limit)
  },
})

export const getBuildStatus = defineAction({
  name: 'get_build_status',
  description: 'Get the current status of a specific build by ID.',
  input: z.object({ id: z.string() }),
  output: buildSchema,
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Build Status', section: 'dev' },
  async execute(input) {
    const build = STUB_BUILDS.find(b => b.id === input.id)
    if (!build) throw new Error(`Build not found: ${input.id}`)
    return build
  },
})

export const triggerBuild = defineAction({
  name: 'invoke_trigger_build',
  description: 'Trigger a new CI/CD build for a branch.',
  input: z.object({ branch: z.string() }),
  output: buildSchema,
  http: { method: 'POST' },
  ai: { tier: 'advise', description: 'Triggers a CI build. Confirm branch before proceeding.' },
  ui: { type: 'action', label: 'Trigger Build', section: 'dev' },
  async execute(input) {
    return {
      id: `B-${String(Date.now()).slice(-4)}`,
      branch: input.branch,
      commit: 'pending',
      status: 'pending' as const,
      startedAt: null,
      finishedAt: null,
      durationSeconds: null,
      triggeredBy: 'manual',
    }
  },
})
