import { openDb } from '../storage/db'
import { AdapterRegistry } from '../adapter/registry'
import { CorpusRegistry } from '../registry/corpus-registry'
import { c, pad, printTable, printError, printSuccess } from './format'
import { readFileSync } from 'fs'

function makeRegistry(): CorpusRegistry {
  const db = openDb()
  const adapters = new AdapterRegistry()
  return new CorpusRegistry(db, adapters)
}

export async function corpusAdd(args: string[]): Promise<void> {
  // Usage: corpus add <kind> <name> <source-path> [--id=<id>] [--config=<json-file>]
  const positional: string[] = []
  let id: string | undefined
  let configFile: string | undefined

  for (const arg of args) {
    if (arg.startsWith('--id=')) {
      id = arg.slice('--id='.length)
    } else if (arg.startsWith('--config=')) {
      configFile = arg.slice('--config='.length)
    } else {
      positional.push(arg)
    }
  }

  if (positional.length < 3) {
    printError('Usage: calli corpus add <kind> <name> <source-path> [--id=<id>] [--config=<json-file>]')
    process.exit(1)
  }

  const [kind, name, source] = positional
  let config: Record<string, unknown> = {}

  if (configFile) {
    try {
      config = JSON.parse(readFileSync(configFile, 'utf-8')) as Record<string, unknown>
    } catch (err) {
      printError(`Failed to read config file '${configFile}': ${String(err)}`)
      process.exit(1)
    }
  }

  const registry = makeRegistry()
  try {
    const corpus = await registry.add({ kind, name, source, id, config })
    printSuccess(`Added corpus '${corpus.id}' (${corpus.kind})`)
  } catch (err) {
    printError(String(err instanceof Error ? err.message : err))
    process.exit(1)
  }
}

export async function corpusList(): Promise<void> {
  const registry = makeRegistry()
  const list = await registry.list()

  if (list.length === 0) {
    console.log(`${c.dim}No corpora registered. Run: calli corpus add <kind> <name> <source>${c.reset}`)
    return
  }

  printTable(
    ['ID', 'Name', 'Kind', 'Status', 'Last indexed'],
    list.map((corpus) => [
      corpus.id,
      corpus.name,
      corpus.kind,
      corpus.status,
      corpus.last_indexed_at ? corpus.last_indexed_at.toISOString().split('T')[0] : '—',
    ]),
    [20, 24, 12, 12, 12],
  )
}

export async function corpusStatus(args: string[]): Promise<void> {
  const jsonFlag = args.includes('--json')
  const id = args.find((a) => !a.startsWith('--'))

  if (!id) {
    printError('Usage: calli corpus status <id> [--json]')
    process.exit(1)
  }

  const registry = makeRegistry()
  const status = await registry.status(id)

  if (!status) {
    printError(`No corpus found with id '${id}'`)
    process.exit(1)
  }

  if (jsonFlag) {
    console.log(JSON.stringify(status, null, 2))
    return
  }

  const { corpus, chunk_count, entity_count, last_run } = status
  console.log(`\n${c.bold}${corpus.name}${c.reset} ${c.dim}(${corpus.id})${c.reset}`)
  console.log(`  ${c.cyan}${pad('Kind', 14)}${c.reset} ${corpus.kind}`)
  console.log(`  ${c.cyan}${pad('Source', 14)}${c.reset} ${corpus.source}`)
  console.log(`  ${c.cyan}${pad('Status', 14)}${c.reset} ${corpus.status}`)
  console.log(`  ${c.cyan}${pad('Chunks', 14)}${c.reset} ${chunk_count}`)
  console.log(`  ${c.cyan}${pad('Entities', 14)}${c.reset} ${entity_count}`)
  console.log(
    `  ${c.cyan}${pad('Last indexed', 14)}${c.reset} ${
      corpus.last_indexed_at ? corpus.last_indexed_at.toISOString() : '—'
    }`,
  )
  if (last_run) {
    console.log(`  ${c.cyan}${pad('Last run', 14)}${c.reset} ${last_run.status} @ ${last_run.started_at}`)
  }
  console.log()
}

export async function corpusRemove(args: string[]): Promise<void> {
  const id = args.find((a) => !a.startsWith('--'))

  if (!id) {
    printError('Usage: calli corpus remove <id>')
    process.exit(1)
  }

  const registry = makeRegistry()
  const existing = await registry.get(id)

  if (!existing) {
    printError(`No corpus found with id '${id}'`)
    process.exit(1)
  }

  // Simple confirmation via stdin if running interactively
  if (process.stdin.isTTY) {
    process.stdout.write(`Remove corpus '${id}' (${existing.name})? [y/N] `)
    const line = await Bun.stdin.text()
    console.log()
    if (!line.trim().toLowerCase().startsWith('y')) {
      console.log('Cancelled.')
      return
    }
  }

  try {
    await registry.remove(id)
    printSuccess(`Removed corpus '${id}'`)
  } catch (err) {
    printError(String(err instanceof Error ? err.message : err))
    process.exit(1)
  }
}

export async function corpusCommand(args: string[]): Promise<void> {
  const sub = args[0]
  const rest = args.slice(1)

  switch (sub) {
    case 'add':
      await corpusAdd(rest)
      break
    case 'list':
      await corpusList()
      break
    case 'status':
      await corpusStatus(rest)
      break
    case 'remove':
      await corpusRemove(rest)
      break
    default:
      printError(`Unknown subcommand: calli corpus ${sub ?? ''}`)
      console.error('Usage: calli corpus <add|list|status|remove>')
      process.exit(1)
  }
}
