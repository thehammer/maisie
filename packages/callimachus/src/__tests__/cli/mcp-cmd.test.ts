import { describe, it, expect, afterAll } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { runMigrations } from '../../storage/migrator'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from '../../storage/schema'
import { seedDb } from '../tools/_fixtures'

// ---------------------------------------------------------------------------
// CLI mcp command integration test
//
// Spawns `calli mcp` as a subprocess, sends JSON-RPC initialize over stdin,
// reads the response from stdout, and verifies the server speaks MCP.
//
// The `mcp` subcommand does not exist yet — these tests will fail until
// the CLI is extended. That's the intent.
// ---------------------------------------------------------------------------

const CLI_PATH = join(import.meta.dir, '../../cli/index.ts')
const TMP_DIR = '/tmp/calli-mcp-cmd-test'
const TMP_DB = join(TMP_DIR, 'test.db')

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

interface JsonRpcResponse {
  jsonrpc: string
  id: number
  result?: unknown
  error?: unknown
}

/**
 * Write a JSON-RPC frame to the process stdin and collect stdout until we see
 * a response line for the given id. Resolves with the parsed response or
 * rejects after `timeoutMs`.
 */
async function sendAndReceive(
  proc: ReturnType<typeof Bun.spawn>,
  request: object,
  id: number,
  timeoutMs = 5000,
): Promise<JsonRpcResponse> {
  const encoded = new TextEncoder().encode(JSON.stringify(request) + '\n')
  // Bun.spawn stdin is a FileSink, not a WritableStream — use write() directly
  await (proc.stdin as unknown as { write(data: Uint8Array): Promise<void>; flush(): void }).write(encoded);
  (proc.stdin as unknown as { flush(): void }).flush()

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for JSON-RPC response id=${id}`)), timeoutMs)
    let buffer = ''

    const reader = proc.stdout!.getReader()
    async function pump() {
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) {
            clearTimeout(timer)
            reject(new Error('stdout closed without response'))
            return
          }
          buffer += new TextDecoder().decode(value)
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              const parsed = JSON.parse(trimmed) as JsonRpcResponse
              if (parsed.id === id) {
                clearTimeout(timer)
                reader.releaseLock()
                resolve(parsed)
                return
              }
            } catch {
              // Not JSON — ignore (e.g. startup logs on stdout)
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

describe('calli mcp — MCP stdio transport', { timeout: 10000 }, () => {
  it('responds to initialize with a valid MCP result', async () => {
    const proc = Bun.spawn(['bun', '--bun', CLI_PATH, 'mcp'], {
      env: { ...process.env, CALLIMACHUS_DB: TMP_DB },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    try {
      const response = await sendAndReceive(
        proc,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test', version: '0.0.1' },
          },
        },
        1,
      )

      expect(response.error).toBeUndefined()
      const result = response.result as Record<string, unknown>
      expect(result).toBeDefined()
      expect(result.protocolVersion).toBeDefined()
      expect(result.serverInfo).toBeDefined()
    } finally {
      proc.kill()
    }
  })

  it('exits with code 0 or 130 on SIGINT', async () => {
    const proc = Bun.spawn(['bun', '--bun', CLI_PATH, 'mcp'], {
      env: { ...process.env, CALLIMACHUS_DB: TMP_DB },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    // Give it a moment to start
    await new Promise((resolve) => setTimeout(resolve, 500))
    proc.kill('SIGINT')

    const exitCode = await proc.exited
    expect([0, 130]).toContain(exitCode)
  })
})
