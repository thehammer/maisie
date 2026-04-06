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

async function cmdDiscoverHpPrinter(): Promise<void> {
  console.log(`\n${c.bold}HP Printer Discovery${c.reset}`)
  console.log(`${c.dim}Querying UniFi device list via Maisie...${c.reset}\n`)

  // Pull devices from UniFi via Maisie API
  let devices: Array<{ ip?: string; mac?: string; name?: string; manufacturer?: string }> = []
  try {
    const data = await apiGet('/api/devices') as { devices?: typeof devices }
    devices = data.devices ?? []
  } catch (err) {
    console.error(`${c.red}Could not reach Maisie at ${host}${c.reset}`)
    console.error(`${c.dim}Make sure the agent is running and MAISIE_HOST is set.${c.reset}\n`)
    process.exit(1)
  }

  // Filter for likely HP devices by manufacturer name
  const HP_TERMS = ['hewlett', 'hp inc', ' hp ']
  const candidates = devices.filter(d => {
    const mfr = (d.manufacturer ?? '').toLowerCase()
    return HP_TERMS.some(t => mfr.includes(t))
  })

  if (candidates.length === 0) {
    console.log(`${c.yellow}No HP devices found in the UniFi device list.${c.reset}`)
    console.log(`${c.dim}If your printer is on the network, set HP_PRINTER_HOST manually.${c.reset}\n`)
    return
  }

  console.log(`${c.dim}Found ${candidates.length} HP device(s) — probing for EWS...${c.reset}\n`)

  const printers: typeof candidates = []

  for (const device of candidates) {
    const ip = device.ip
    if (!ip) continue

    const label = device.name ? `${device.name} (${ip})` : ip
    process.stdout.write(`  Probing ${c.cyan}${label}${c.reset}...`)

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5_000)
      const res = await fetch(`http://${ip}/DevMgmt/ProductStatusDyn.xml`, {
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (res.ok) {
        const text = await res.text()
        const looksLikeEws = text.includes('ProductStatus') || text.includes('xml')
        if (looksLikeEws) {
          console.log(` ${c.green}✓ HP printer EWS found${c.reset}`)
          printers.push(device)
        } else {
          console.log(` ${c.dim}responded but not EWS${c.reset}`)
        }
      } else {
        console.log(` ${c.dim}HTTP ${res.status}${c.reset}`)
      }
    } catch {
      console.log(` ${c.dim}no response${c.reset}`)
    }
  }

  console.log()

  if (printers.length === 0) {
    console.log(`${c.yellow}No HP printers responded to EWS probe.${c.reset}`)
    console.log(`${c.dim}The printer may be off, or may not support EWS. Try setting HP_PRINTER_HOST manually.${c.reset}\n`)
    return
  }

  console.log(`${c.bold}Found ${printers.length} HP printer(s):${c.reset}\n`)
  for (const p of printers) {
    console.log(`  ${c.green}${p.name ?? 'HP Printer'}${c.reset}  ${c.dim}${p.ip}${c.reset}`)
  }

  console.log()

  if (printers.length === 1) {
    console.log(`${c.bold}Add to your .env:${c.reset}`)
    console.log(`  ${c.cyan}HP_PRINTER_HOST=${printers[0].ip}${c.reset}\n`)
  } else {
    console.log(`${c.bold}Add one of the following to your .env:${c.reset}`)
    for (const p of printers) {
      console.log(`  ${c.cyan}HP_PRINTER_HOST=${p.ip}${c.reset}  ${c.dim}# ${p.name ?? 'HP Printer'}${c.reset}`)
    }
    console.log()
  }
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
  ${c.cyan}discover hp-printer${c.reset} Find HP printer on the network via UniFi + EWS probe

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
      case 'discover':
        if (rest[0] === 'hp-printer') {
          await cmdDiscoverHpPrinter()
        } else {
          console.error(`${c.red}Unknown discover target: ${rest[0] ?? '(none)'}${c.reset}`)
          console.error(`${c.dim}Usage: maisie discover hp-printer${c.reset}`)
          process.exit(1)
        }
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
