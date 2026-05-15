import { describe, it, expect, afterAll } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { runMigrations } from '../../storage/migrator'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from '../../storage/schema'
import { seedDb } from '../tools/_fixtures'

// ---------------------------------------------------------------------------
// MCP stdio integration test
//
// Spawns the real MCP server process over stdio, exchanges JSON-RPC frames,
// and asserts valid protocol behavior.
//
// The implementation at src/mcp/server.ts does not exist yet — these tests
// will fail until it's built. That's the intent.
// ---------------------------------------------------------------------------

const SERVER_PATH = join(import.meta.dir, '../../mcp/server.ts')
const TMP_DIR = '/tmp/calli-stdio-integration-test'
const TMP_DB = join(TMP_DIR, 'test.db')

// Seed a temporary DB once for the whole suite
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
// JSON-RPC frame helpers
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: unknown
}

interface JsonRpcResponse {
  jsonrpc: string
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

/**
 * Send a single JSON-RPC frame to the server process and read the response.
 * Each frame is a newline-terminated JSON string.
 */
async function sendFrame(
  proc: ReturnType<typeof Bun.spawn>,
  request: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  const line = JSON.stringify(request) + '\n'
  // Bun.spawn stdin is a FileSink, not a WritableStream — use write() directly
  await (proc.stdin as unknown as { write(data: Uint8Array): Promise<void>; flush(): void }).write(new TextEncoder().encode(line));
  (proc.stdin as unknown as { flush(): void }).flush()

  // Read lines from stdout until we get one that parses as JSON-RPC
  const reader = proc.stdout!.getReader()
  let accumulated = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) throw new Error('Server process closed stdout before responding')
    accumulated += new TextDecoder().decode(value)
    const lines = accumulated.split('\n')
    for (const candidate of lines) {
      const trimmed = candidate.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as JsonRpcResponse
        if (parsed.jsonrpc === '2.0' && parsed.id === request.id) {
          reader.releaseLock()
          return parsed
        }
      } catch {
        // Not JSON yet — keep accumulating
      }
    }
    // Keep only the last (incomplete) line for next iteration
    accumulated = lines[lines.length - 1]
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP stdio server — JSON-RPC protocol', { timeout: 10000 }, () => {
  it('responds to initialize with a valid InitializeResult', async () => {
    const proc = Bun.spawn(['bun', '--bun', SERVER_PATH], {
      env: { ...process.env, CALLIMACHUS_DB: TMP_DB },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    try {
      const response = await sendFrame(proc, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.0.1' },
        },
      })

      expect(response.error).toBeUndefined()
      const result = response.result as Record<string, unknown>
      expect(result).toBeDefined()
      expect(result.protocolVersion).toBeDefined()
      expect(result.capabilities).toBeDefined()
      expect(result.serverInfo).toBeDefined()
    } finally {
      proc.kill()
    }
  })

  it('responds to tools/list with exactly 9 tools', async () => {
    const proc = Bun.spawn(['bun', '--bun', SERVER_PATH], {
      env: { ...process.env, CALLIMACHUS_DB: TMP_DB },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    try {
      // Initialize first (required by MCP protocol)
      await sendFrame(proc, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.0.1' },
        },
      })

      const response = await sendFrame(proc, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      })

      expect(response.error).toBeUndefined()
      const result = response.result as { tools: unknown[] }
      expect(result.tools).toBeDefined()
      expect(result.tools).toHaveLength(9)
    } finally {
      proc.kill()
    }
  })

  it('responds to tools/call corpus_list with a valid Success result', async () => {
    const proc = Bun.spawn(['bun', '--bun', SERVER_PATH], {
      env: { ...process.env, CALLIMACHUS_DB: TMP_DB },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    try {
      // Initialize
      await sendFrame(proc, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.0.1' },
        },
      })

      // Call corpus_list
      const response = await sendFrame(proc, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'corpus_list', arguments: {} },
      })

      expect(response.error).toBeUndefined()
      const result = response.result as { content: Array<{ type: string; text: string }> }
      expect(result.content).toBeDefined()
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')

      // The text should be valid JSON with ok:true
      const toolResult = JSON.parse(result.content[0].text) as { ok: boolean; data: unknown[] }
      expect(toolResult.ok).toBe(true)
      expect(Array.isArray(toolResult.data)).toBe(true)
    } finally {
      proc.kill()
    }
  })

  it('corpus_list result contains the seeded eisenhorn corpus', async () => {
    const proc = Bun.spawn(['bun', '--bun', SERVER_PATH], {
      env: { ...process.env, CALLIMACHUS_DB: TMP_DB },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    try {
      await sendFrame(proc, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.0.1' },
        },
      })

      const response = await sendFrame(proc, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'corpus_list', arguments: {} },
      })

      const result = response.result as { content: Array<{ text: string }> }
      const toolResult = JSON.parse(result.content[0].text) as { ok: boolean; data: Array<{ id: string }> }
      expect(toolResult.data.some((c) => c.id === 'eisenhorn')).toBe(true)
    } finally {
      proc.kill()
    }
  })

  it('exits cleanly on SIGINT (exit code 0 or 130)', async () => {
    const proc = Bun.spawn(['bun', '--bun', SERVER_PATH], {
      env: { ...process.env, CALLIMACHUS_DB: TMP_DB },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    // Give it a moment to start
    await new Promise((resolve) => setTimeout(resolve, 500))
    proc.kill('SIGINT')

    const exitCode = await proc.exited
    // SIGINT typically exits with 130, but a clean handler may use 0
    expect([0, 130]).toContain(exitCode)
  })
})
