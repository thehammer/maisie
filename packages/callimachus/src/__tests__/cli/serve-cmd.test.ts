import { describe, it, expect, afterAll } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { runMigrations } from '../../storage/migrator'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from '../../storage/schema'
import { seedDb } from '../tools/_fixtures'

// ---------------------------------------------------------------------------
// CLI serve command integration test
//
// Spawns `calli serve --port=<N>` as a subprocess, waits for the "listening"
// line on stderr, then probes /health via fetch.
//
// The `serve` subcommand does not exist yet — these tests will fail until
// the CLI is extended. That's the intent.
// ---------------------------------------------------------------------------

const CLI_PATH = join(import.meta.dir, '../../cli/index.ts')
const TMP_DIR = '/tmp/calli-serve-cmd-test'
const TMP_DB = join(TMP_DIR, 'test.db')
// Use a fixed high port unlikely to conflict; alternatively parse from stderr
const TEST_PORT = 34821

function prepareTempDb(): void {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true })
  }
  if (existsSync(TMP_DB)) {
    rmSync(TMP_DB)
  }
  const sqlite = new Database(TMP_DB)
  runMigrations(sqlite)
  const db = drizzle(sqlite, { schema })
  seedDb(db)
  sqlite.close()
}

prepareTempDb()

afterAll(() => {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true })
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the server to print a "listening" message on stderr.
 * Returns the port number extracted from the message, or the given fallback.
 *
 * Resolves within `timeoutMs` or rejects.
 */
async function waitForListening(
  proc: ReturnType<typeof Bun.spawn>,
  fallbackPort: number,
  timeoutMs = 5000,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not print listening message within timeout')), timeoutMs)
    let buffer = ''

    const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader()
    async function pump() {
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) {
            clearTimeout(timer)
            reject(new Error('stderr closed without listening message'))
            return
          }
          buffer += new TextDecoder().decode(value)
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (/listen/i.test(line)) {
              // Try to parse port from e.g. "listening on port 34821" or "http://0.0.0.0:34821"
              const portMatch = line.match(/:(\d+)/) ?? line.match(/port\s+(\d+)/i)
              const port = portMatch ? parseInt(portMatch[1], 10) : fallbackPort
              clearTimeout(timer)
              reader.releaseLock()
              resolve(port)
              return
            }
          }
        }
      } catch (err) {
        clearTimeout(timer)
        reject(err)
      }
    }
    pump()
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calli serve — HTTP transport', { timeout: 10000 }, () => {
  it('starts an HTTP server and /health returns ok:true', async () => {
    const proc = Bun.spawn(['bun', '--bun', CLI_PATH, 'serve', `--port=${TEST_PORT}`], {
      env: { ...process.env, CALLIMACHUS_DB: TMP_DB },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    try {
      const port = await waitForListening(proc, TEST_PORT)
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      const body = await response.json() as { ok: boolean }

      expect(response.status).toBe(200)
      expect(body.ok).toBe(true)
    } finally {
      proc.kill()
    }
  })

  it('/health includes a corpora count reflecting the seeded data', async () => {
    const proc = Bun.spawn(['bun', '--bun', CLI_PATH, 'serve', `--port=${TEST_PORT + 1}`], {
      env: { ...process.env, CALLIMACHUS_DB: TMP_DB },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    try {
      const port = await waitForListening(proc, TEST_PORT + 1)
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      const body = await response.json() as { ok: boolean; corpora: number }

      expect(body.corpora).toBeGreaterThanOrEqual(1)
    } finally {
      proc.kill()
    }
  })

  it('/v1/corpora returns the seeded eisenhorn corpus', async () => {
    const proc = Bun.spawn(['bun', '--bun', CLI_PATH, 'serve', `--port=${TEST_PORT + 2}`], {
      env: { ...process.env, CALLIMACHUS_DB: TMP_DB },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    try {
      const port = await waitForListening(proc, TEST_PORT + 2)
      const response = await fetch(`http://127.0.0.1:${port}/v1/corpora`)
      const body = await response.json() as { ok: boolean; data: Array<{ id: string }> }

      expect(response.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.data.some((c) => c.id === 'eisenhorn')).toBe(true)
    } finally {
      proc.kill()
    }
  })

  it('exits with code 0 or 130 after SIGINT', async () => {
    const proc = Bun.spawn(['bun', '--bun', CLI_PATH, 'serve', `--port=${TEST_PORT + 3}`], {
      env: { ...process.env, CALLIMACHUS_DB: TMP_DB },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    try {
      await waitForListening(proc, TEST_PORT + 3)
    } catch {
      // If listening message not seen, still try to kill
    } finally {
      proc.kill('SIGINT')
    }

    const exitCode = await proc.exited
    expect([0, 130]).toContain(exitCode)
  })
})
