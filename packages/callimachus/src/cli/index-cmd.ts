import { openDb } from '../storage/db'
import { AdapterRegistry } from '../adapter/registry'
import { CorpusRegistry } from '../registry/corpus-registry'
import { registerBuiltinAdapters } from '../adapter/builtin'
import { runIndex } from '../pipeline/indexer'
import { AnthropicLlmClient } from '../pipeline/llm/anthropic-client'
import { DryRunLlmClient } from '../pipeline/llm/dry-run-client'
import type { PassName } from '../pipeline/types'
import { c, printError } from './format'

const ALL_PASSES: PassName[] = ['chunk', 'extract_structure', 'extract_semantic', 'summarize']
const OFFLINE_PASSES: PassName[] = ['chunk', 'extract_structure']

export async function indexCommand(args: string[]): Promise<void> {
  // Parse args
  const positional: string[] = []
  let passes: PassName[] | undefined
  let fromChunk: string | undefined
  let dryRun = false
  let offline = false
  let model: string | undefined
  let concurrency: number | undefined

  for (const arg of args) {
    if (arg.startsWith('--pass=') || arg.startsWith('--passes=')) {
      const val = arg.slice(arg.indexOf('=') + 1)
      passes = val.split(',').map((p) => p.trim()) as PassName[]
    } else if (arg.startsWith('--from-chunk=')) {
      fromChunk = arg.slice('--from-chunk='.length)
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--offline') {
      offline = true
    } else if (arg.startsWith('--model=')) {
      model = arg.slice('--model='.length)
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = parseInt(arg.slice('--concurrency='.length), 10)
    } else if (!arg.startsWith('--')) {
      positional.push(arg)
    }
  }

  const corpusId = positional[0]
  if (!corpusId) {
    printError('Usage: calli index <corpus_id> [--pass=...] [--from-chunk=...] [--dry-run] [--offline] [--model=...] [--concurrency=N]')
    process.exit(1)
  }

  const db = openDb()
  const adapters = new AdapterRegistry()
  await registerBuiltinAdapters(adapters)

  const corpusRegistry = new CorpusRegistry(db, adapters)
  const corpus = await corpusRegistry.get(corpusId)

  if (!corpus) {
    printError(`No corpus found with id '${corpusId}'`)
    process.exit(1)
  }

  const adapter = adapters.get(corpus.kind)
  if (!adapter) {
    printError(
      `No adapter registered for kind '${corpus.kind}'. ` +
        `Make sure the adapter package is installed and the kind is correct.`,
    )
    process.exit(2)
  }

  // Determine effective passes
  let effectivePasses: PassName[]
  if (offline) {
    effectivePasses = OFFLINE_PASSES
  } else if (passes) {
    effectivePasses = passes
  } else {
    effectivePasses = ALL_PASSES
  }

  // Build LLM client
  const useDryRun = dryRun || offline
  let llm: AnthropicLlmClient | DryRunLlmClient
  if (useDryRun) {
    llm = new DryRunLlmClient()
  } else {
    try {
      llm = new AnthropicLlmClient({ model })
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  }

  console.log(`\n${c.bold}Indexing corpus:${c.reset} ${corpus.name} ${c.dim}(${corpus.id})${c.reset}`)
  console.log(`${c.dim}Passes: ${effectivePasses.join(', ')}${dryRun ? ' [dry-run]' : ''}${offline ? ' [offline]' : ''}${c.reset}\n`)

  const start = Date.now()

  try {
    const result = await runIndex({
      db,
      corpus,
      adapter,
      llm,
      opts: {
        corpusId,
        passes: effectivePasses,
        fromChunk,
        dryRun,
        concurrency,
      },
    })

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    console.log(`\n${c.green}✓${c.reset} Indexing complete in ${elapsed}s`)
    console.log(`  Chunks:   ${result.total_chunks}`)
    console.log(`  Entities: ${result.total_entities}`)
    if (result.cost_usd > 0) {
      console.log(`  Cost:     $${result.cost_usd.toFixed(4)}`)
    }

    // Print per-pass stats
    console.log(`\n${c.bold}Pass summary:${c.reset}`)
    for (const run of result.runs) {
      const dur = run.finished_at
        ? `${((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)}s`
        : '—'
      const statusColor = run.status === 'completed' ? c.green : run.status === 'skipped' ? c.dim : c.red
      console.log(
        `  ${statusColor}${run.status}${c.reset}  ${run.pass.padEnd(22)} ` +
          `processed=${run.stats.processed}  skipped=${run.stats.skipped}  failed=${run.stats.failed}  (${dur})`,
      )
    }
    console.log()

    // Exit 3 if any pass failed
    const anyFailed = result.runs.some((r) => r.status === 'failed')
    if (anyFailed) {
      process.exit(3)
    }
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err))
    process.exit(3)
  }
}
