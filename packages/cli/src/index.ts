#!/usr/bin/env bun

// ANSI color helpers
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  blue: '\x1b[34m',
}

const host = process.env.MAISIE_HOST ?? 'http://localhost:3001'

async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(`${host}${path}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  return res.json()
}

async function apiPost(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${host}${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  return res.json()
}

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length)
}

async function cmdStatus(): Promise<void> {
  const data = await apiGet('/api/health') as Record<string, unknown>
  console.log(`\n${c.bold}Maisie Status${c.reset}`)
  console.log(`${c.dim}Host: ${host}${c.reset}\n`)
  for (const [key, val] of Object.entries(data)) {
    const statusStr = String(val)
    const color = statusStr === 'ok' || statusStr === 'healthy' ? c.green : c.yellow
    console.log(`  ${c.cyan}${pad(key, 16)}${c.reset} ${color}${statusStr}${c.reset}`)
  }
  console.log()
}

async function cmdPlugins(): Promise<void> {
  const data = await apiGet('/api/plugins') as { plugins: Array<{ name: string; version: string; description: string; capabilities: string[] }> }
  const plugins = data.plugins ?? []

  console.log(`\n${c.bold}Installed Plugins${c.reset} ${c.dim}(${plugins.length})${c.reset}\n`)

  if (plugins.length === 0) {
    console.log(`  ${c.dim}No plugins found${c.reset}\n`)
    return
  }

  const nameW = 20
  const versionW = 8
  const capW = 30

  console.log(
    `  ${c.bold}${c.blue}${pad('Name', nameW)}  ${pad('Version', versionW)}  ${pad('Capabilities', capW)}  Description${c.reset}`
  )
  console.log(`  ${c.dim}${'-'.repeat(nameW + versionW + capW + 30)}${c.reset}`)

  for (const p of plugins) {
    const caps = p.capabilities.length > 0 ? p.capabilities.join(', ') : c.dim + 'none' + c.reset
    console.log(
      `  ${c.cyan}${pad(p.name, nameW)}${c.reset}  ${c.dim}${pad(p.version, versionW)}${c.reset}  ${pad(caps, capW)}  ${p.description}`
    )
  }
  console.log()
}

async function cmdChat(message: string): Promise<void> {
  const res = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  if (!res.body) throw new Error('No response body')

  process.stdout.write(`\n${c.cyan}Maisie:${c.reset} `)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') break
      try {
        const parsed = JSON.parse(data) as { delta?: string; content?: string }
        const text = parsed.delta ?? parsed.content ?? ''
        process.stdout.write(text)
      } catch {
        // non-JSON SSE event — skip
      }
    }
  }

  process.stdout.write('\n\n')
}

async function cmdRebuild(): Promise<void> {
  console.log(`\n${c.yellow}Rebuilding lineup...${c.reset}`)
  const data = await apiPost('/api/lineup') as Record<string, unknown>
  console.log(`${c.green}Done.${c.reset}`)
  if (data && typeof data === 'object') {
    for (const [key, val] of Object.entries(data)) {
      console.log(`  ${c.cyan}${key}:${c.reset} ${val}`)
    }
  }
  console.log()
}

function printHelp(): void {
  console.log(`
${c.bold}maisie${c.reset} — home AI CLI

${c.bold}Commands:${c.reset}
  ${c.cyan}status${c.reset}              Show agent status
  ${c.cyan}plugins${c.reset}             List installed plugins
  ${c.cyan}chat <message>${c.reset}      Chat with Maisie (streams response)
  ${c.cyan}rebuild${c.reset}             Rebuild synthetic-hdhr channel lineup

${c.bold}Environment:${c.reset}
  ${c.cyan}MAISIE_HOST${c.reset}         Agent base URL (default: http://localhost:3001)
`)
}

async function main() {
  const [, , cmd, ...rest] = process.argv

  try {
    switch (cmd) {
      case 'status':
        await cmdStatus()
        break
      case 'plugins':
        await cmdPlugins()
        break
      case 'chat':
        if (!rest.length) {
          console.error(`${c.red}Error: chat requires a message${c.reset}`)
          process.exit(1)
        }
        await cmdChat(rest.join(' '))
        break
      case 'rebuild':
        await cmdRebuild()
        break
      case '--help':
      case '-h':
      case 'help':
      case undefined:
        printHelp()
        break
      default:
        console.error(`${c.red}Unknown command: ${cmd}${c.reset}`)
        printHelp()
        process.exit(1)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`\n${c.red}Error: ${msg}${c.reset}\n`)
    process.exit(1)
  }
}

main()
