import { describe, it, expect } from 'bun:test'
import { zodToTypeExpr } from '@maisie/shared'
import type { MaisiePlugin } from '@maisie/shared'
import tasksPlugin from '../tasks/index'
import buildsPlugin from '../builds/index'
import metricsPlugin from '../metrics/index'
import * as taskActions from '../tasks/actions'
import * as buildActions from '../builds/actions'
import * as metricsActions from '../metrics/actions'

const ALL_PLUGINS: MaisiePlugin[] = [tasksPlugin, buildsPlugin, metricsPlugin]

// ── Structural: every plugin satisfies MaisiePlugin shape ──────────────────────

describe('plugin structure', () => {
  for (const plugin of ALL_PLUGINS) {
    describe(`${plugin.name}`, () => {
      it('has required top-level fields', () => {
        expect(typeof plugin.name).toBe('string')
        expect(typeof plugin.version).toBe('string')
        expect(typeof plugin.description).toBe('string')
        expect(Array.isArray(plugin.capabilities)).toBe(true)
        expect(Array.isArray(plugin.actions)).toBe(true)
        expect(Array.isArray(plugin.events)).toBe(true)
        expect(typeof plugin.init).toBe('function')
        expect(typeof plugin.shutdown).toBe('function')
        expect(typeof plugin.healthCheck).toBe('function')
      })

      it('has at least one action', () => {
        expect(plugin.actions.length).toBeGreaterThan(0)
      })

      it('every action has explicit http, ai, and ui declarations', () => {
        for (const action of plugin.actions) {
          expect(action.http).toBeDefined()
          expect(action.http.method).toMatch(/^(GET|POST|PATCH|DELETE)$/)

          // ai and ui must be explicitly false or an object — not undefined
          expect(action.ai !== undefined).toBe(true)
          expect(action.ui !== undefined).toBe(true)
        }
      })

      it('every action has a name, description, input, output, and execute', () => {
        for (const action of plugin.actions) {
          expect(typeof action.name).toBe('string')
          expect(action.name.length).toBeGreaterThan(0)
          expect(typeof action.description).toBe('string')
          expect(action.input).toBeDefined()
          expect(action.output).toBeDefined()
          expect(typeof action.execute).toBe('function')
        }
      })
    })
  }
})

// ── Type system: zodToTypeExpr succeeds on all output schemas ──────────────────

describe('zodToTypeExpr', () => {
  it('succeeds on task schema', () => {
    expect(() => taskActions._taskTypeExpr).not.toThrow()
    expect(taskActions._taskTypeExpr).toBeDefined()
  })

  it('succeeds on task list schema', () => {
    expect(() => taskActions._taskListTypeExpr).not.toThrow()
    expect(taskActions._taskListTypeExpr.kind).toBe('collection')
  })

  it('succeeds on build schema', () => {
    expect(buildActions._buildTypeExpr).toBeDefined()
  })

  it('succeeds on build list schema', () => {
    expect(buildActions._buildListTypeExpr.kind).toBe('collection')
  })

  it('succeeds on metrics schema', () => {
    expect(metricsActions._metricsTypeExpr).toBeDefined()
    expect(metricsActions._metricsTypeExpr.kind).toBe('record')
  })

  it('succeeds on all action output schemas', () => {
    for (const plugin of ALL_PLUGINS) {
      for (const action of plugin.actions) {
        expect(() => zodToTypeExpr(action.output)).not.toThrow()
      }
    }
  })
})

// ── Execute: happy path stub data ──────────────────────────────────────────────

const stubCtx = {
  log: () => {},
  emit: () => {},
  plugin: 'test',
  requestId: 'test-001',
}

describe('execute (stub data)', () => {
  it('listTasks returns array', async () => {
    const result = await taskActions.listTasks.execute({ limit: 10 }, stubCtx)
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })

  it('getTask returns single task', async () => {
    const result = await taskActions.getTask.execute({ id: 'T-001' }, stubCtx)
    expect(result.id).toBe('T-001')
  })

  it('getTask throws for unknown id', async () => {
    await expect(taskActions.getTask.execute({ id: 'UNKNOWN' }, stubCtx)).rejects.toThrow()
  })

  it('listBuilds returns array', async () => {
    const result = await buildActions.listBuilds.execute({ limit: 5 }, stubCtx)
    expect(Array.isArray(result)).toBe(true)
  })

  it('getProjectMetrics returns record with codeCoverage', async () => {
    const result = await metricsActions.getProjectMetrics.execute({}, stubCtx)
    expect(typeof result.codeCoverage).toBe('number')
    expect(result.codeCoverage).toBeGreaterThanOrEqual(0)
    expect(result.codeCoverage).toBeLessThanOrEqual(100)
  })
})
