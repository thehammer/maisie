import type { Hono } from 'hono'

interface ServeOptions {
  app: Hono
  port: number
  host?: string
}

export interface ServerHandle {
  stop(): Promise<void>
}

/**
 * Start the Callimachus HTTP server using Bun.serve.
 * Returns a handle with a `stop()` method for graceful shutdown.
 */
export function startHttpServer({ app, port, host = '0.0.0.0' }: ServeOptions): ServerHandle {
  const server = Bun.serve({
    fetch: app.fetch,
    port,
    hostname: host,
  })

  return {
    stop(): Promise<void> {
      return server.stop()
    },
  }
}
