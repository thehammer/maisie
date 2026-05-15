import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'

// ---------------------------------------------------------------------------
// CLI integration tests via Bun.spawn
// ---------------------------------------------------------------------------

const CLI_PATH = join(import.meta.dir, '../../cli/index.ts')

async function runCli(args: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', '--bun', CLI_PATH, ...args], {
    env: {
      ...process.env,
      CALLIMACHUS_DB: ':memory:',
      ANTHROPIC_API_KEY: '',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calli index — argument validation', () => {
  it('exits 1 with helpful message when corpus id is missing', async () => {
    const result = await runCli(['index'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  it('exits 1 with "No corpus found" when corpus does not exist', async () => {
    const result = await runCli(['index', 'no-such-corpus', '--dry-run'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('No corpus found')
  })
})

describe('calli index — adapter not registered', () => {
  it('exits 2 when adapter for corpus kind is not installed', async () => {
    // Use a temp file db to register a corpus with a non-existent adapter kind
    const tmpDb = `/tmp/calli-test-${Date.now()}.db`
    try {
      // Create corpus via CLI
      const addResult = await runCli(['corpus', 'add', 'nonexistent-kind', 'test-corpus', '/src'], {
        CALLIMACHUS_DB: tmpDb,
      })
      // Corpus add may warn about missing adapter but should succeed
      expect(addResult.exitCode).toBe(0)

      // Now try to index it — adapter 'nonexistent-kind' is not registered
      const indexResult = await runCli(['index', 'test-corpus'], {
        CALLIMACHUS_DB: tmpDb,
      })
      expect(indexResult.exitCode).toBe(2)
      expect(indexResult.stderr).toContain('adapter')
    } finally {
      if (existsSync(tmpDb)) rmSync(tmpDb)
    }
  })
})
