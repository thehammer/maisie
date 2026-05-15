#!/usr/bin/env bun
import { corpusCommand } from './corpus'
import { stubCommand } from './stubs'
import { c } from './format'

const VERSION = '0.1.0'

const USAGE = `
${c.bold}calli${c.reset} — Callimachus CLI

${c.bold}Usage:${c.reset}
  calli corpus <add|list|status|remove>  Manage corpora
  calli index <id>                       Index a corpus    ${c.dim}[not yet implemented]${c.reset}
  calli reindex <id>                     Re-index a corpus ${c.dim}[not yet implemented]${c.reset}
  calli watch <id>                       Watch and auto-reindex ${c.dim}[not yet implemented]${c.reset}
  calli inspect <id> <path>              Inspect indexed data   ${c.dim}[not yet implemented]${c.reset}
  calli correct <id>                     Apply corrections      ${c.dim}[not yet implemented]${c.reset}
  calli export <id>                      Export corpus data     ${c.dim}[not yet implemented]${c.reset}
  calli --help                           Show this help
  calli --version                        Show version

${c.dim}See docs/callimachus-prd.md for the full feature roadmap.${c.reset}
`

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const cmd = args[0]

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(USAGE)
    process.exit(0)
  }

  if (cmd === '--version' || cmd === '-v') {
    console.log(`calli ${VERSION}`)
    process.exit(0)
  }

  switch (cmd) {
    case 'corpus':
      await corpusCommand(args.slice(1))
      break
    // Stub subcommands — not yet implemented in the skeleton
    case 'index':
    case 'reindex':
    case 'watch':
    case 'inspect':
    case 'correct':
    case 'export':
      stubCommand(cmd)
      break
    default:
      console.error(`${c.red}error:${c.reset} Unknown subcommand: ${cmd}`)
      console.error(USAGE)
      process.exit(1)
  }
}

main().catch((err) => {
  console.error(`${c.red}fatal:${c.reset} ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
