#!/usr/bin/env bun
/**
 * Callimachus MCP server — stdio JSON-RPC transport.
 *
 * Implements the Model Context Protocol over stdin/stdout.
 * Reads newline-delimited JSON-RPC 2.0 requests from stdin and writes
 * responses to stdout. All log/diagnostic output goes to stderr.
 */

import { openDb } from '../storage/db'
import { AdapterRegistry } from '../adapter/registry'
import { CorpusRegistry } from '../registry/corpus-registry'
import { registerBuiltinAdapters } from '../adapter/builtin'
import { QueryService } from '../tools/query-service'
import { registerTools, type ToolServer } from './register-tools'
import { version } from '../../package.json'

const PROTOCOL_VERSION = '2024-11-05'
const SUPPORTED_VERSIONS = ['2024-11-05', '2025-03-26']

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const db = openDb()
const adapters = new AdapterRegistry()
await registerBuiltinAdapters(adapters)
const registry = new CorpusRegistry(db, adapters)
const queryService = new QueryService({ db, registry, adapters })

// ---------------------------------------------------------------------------
// Handler registry (mirrors MCP SDK's setRequestHandler interface)
// ---------------------------------------------------------------------------

const handlers = new Map<string, (req: unknown) => Promise<unknown>>()

const server: ToolServer = {
  setRequestHandler(schema: { method: string }, handler: (req: unknown) => Promise<unknown>): void {
    handlers.set(schema.method, handler)
  },
}

registerTools(server, queryService)

// ---------------------------------------------------------------------------
// JSON-RPC stdio loop
// ---------------------------------------------------------------------------

type JsonRpcRequest = {
  jsonrpc: string
  id?: number | string
  method: string
  params?: unknown
}

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function respond(id: number | string | null, result: unknown): void {
  const msg: JsonRpcResponse = { jsonrpc: '2.0', id, result }
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function respondError(id: number | string | null, code: number, message: string): void {
  const msg: JsonRpcResponse = { jsonrpc: '2.0', id, error: { code, message } }
  process.stdout.write(JSON.stringify(msg) + '\n')
}

async function handleRequest(raw: string): Promise<void> {
  let req: JsonRpcRequest
  try {
    req = JSON.parse(raw) as JsonRpcRequest
  } catch {
    respondError(null, -32700, 'Parse error')
    return
  }

  const id = req.id ?? null

  if (req.jsonrpc !== '2.0') {
    respondError(id, -32600, 'Invalid Request: jsonrpc must be "2.0"')
    return
  }

  // Handle built-in MCP lifecycle methods
  if (req.method === 'initialize') {
    const params = req.params as { protocolVersion?: string; capabilities?: unknown; clientInfo?: unknown } | undefined
    const clientVersion = params?.protocolVersion ?? PROTOCOL_VERSION
    const negotiated = SUPPORTED_VERSIONS.includes(clientVersion) ? clientVersion : PROTOCOL_VERSION

    respond(id, {
      protocolVersion: negotiated,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'callimachus',
        version,
      },
    })
    return
  }

  if (req.method === 'notifications/initialized') {
    // No response needed for notifications
    return
  }

  if (req.method === 'ping') {
    respond(id, {})
    return
  }

  // Dispatch to registered handlers
  const handler = handlers.get(req.method)
  if (!handler) {
    respondError(id, -32601, `Method not found: ${req.method}`)
    return
  }

  try {
    const result = await handler(req)
    respond(id, result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    respondError(id, -32603, `Internal error: ${message}`)
  }
}

// Read stdin line by line
let buffer = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buffer += chunk
  const lines = buffer.split('\n')
  buffer = lines.pop() ?? ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) {
      handleRequest(trimmed).catch((err) => {
        process.stderr.write(`[callimachus-mcp] error: ${err}\n`)
      })
    }
  }
})

process.stdin.on('end', () => {
  process.exit(0)
})

// Clean exit on signals
function cleanExit(): void {
  process.exit(0)
}

process.on('SIGINT', cleanExit)
process.on('SIGTERM', cleanExit)

process.stderr.write(`[callimachus-mcp] server ready (v${version})\n`)
