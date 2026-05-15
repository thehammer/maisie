import { openDb } from '../storage/db'
import { AdapterRegistry } from '../adapter/registry'
import { CorpusRegistry } from '../registry/corpus-registry'
import { registerBuiltinAdapters } from '../adapter/builtin'
import { QueryService } from '../tools/query-service'
import { createHttpApp } from '../http/server'
import { startHttpServer, type ServerHandle } from '../http/serve'
import { printError } from './format'

const DEFAULT_PORT = 7460
const DEFAULT_HOST = '127.0.0.1'

/**
 * `calli serve [--port=N] [--host=H]`
 *
 * Exit codes:
 *   0 — clean shutdown
 *   1 — bind error
 *   2 — db error
 */
export async function serveCommand(args: string[]): Promise<void> {
  let port = DEFAULT_PORT
  let host = DEFAULT_HOST

  for (const arg of args) {
    if (arg.startsWith('--port=')) {
      const n = parseInt(arg.slice('--port='.length), 10)
      if (isNaN(n) || n < 1 || n > 65535) {
        printError(`Invalid port: ${arg}`)
        process.exit(1)
      }
      port = n
    } else if (arg.startsWith('--host=')) {
      host = arg.slice('--host='.length)
    }
  }

  let db
  try {
    db = openDb()
  } catch (err) {
    printError(`Failed to open database: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }

  const adapters = new AdapterRegistry()
  await registerBuiltinAdapters(adapters)
  const registry = new CorpusRegistry(db, adapters)
  const queryService = new QueryService({ db, registry, adapters })
  const app = createHttpApp(queryService)

  let serverHandle: ServerHandle
  try {
    serverHandle = startHttpServer({ app, port, host })
  } catch (err) {
    printError(`Failed to start server: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  process.stderr.write(`[callimachus] listening on port ${port} (${host}:${port})\n`)

  // Graceful shutdown
  async function shutdown(): Promise<void> {
    process.stderr.write('[callimachus] shutting down...\n')
    await serverHandle.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // Keep process alive
  await new Promise<void>(() => {})
}
