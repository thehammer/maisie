import { describe, it, expect } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdirSync } from 'fs'

const CLI = join(import.meta.dir, '../cli/index.ts')

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function run(args: string[], env?: Record<string, string>): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
  })
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  return { exitCode, stdout, stderr }
}

function tempDb(): string {
  const dir = join(tmpdir(), `calli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return join(dir, 'test.db')
}

describe('calli corpus add', () => {
  it('exits with code 0 and prints the corpus id on success', async () => {
    const db = tempDb()
    const result = await run(['corpus', 'add', 'book', 'xenos', '/tmp/some-book.epub'], { CALLIMACHUS_DB: db })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('xenos')
  })

  it('accepts an explicit --id flag', async () => {
    const db = tempDb()
    const result = await run(
      ['corpus', 'add', 'book', 'My Book', '/tmp/some-book.epub', '--id=my-explicit-id'],
      { CALLIMACHUS_DB: db },
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('my-explicit-id')
  })

  it('exits with a non-zero code and prints an error when adding a duplicate id', async () => {
    const db = tempDb()
    await run(['corpus', 'add', 'book', 'xenos', '/tmp/some-book.epub', '--id=xenos'], { CALLIMACHUS_DB: db })

    const result = await run(
      ['corpus', 'add', 'book', 'xenos again', '/tmp/other.epub', '--id=xenos'],
      { CALLIMACHUS_DB: db },
    )

    expect(result.exitCode).not.toBe(0)
  })

  it('exits with a non-zero code when required positional arguments are missing', async () => {
    const db = tempDb()
    const result = await run(['corpus', 'add', 'book'], { CALLIMACHUS_DB: db })

    expect(result.exitCode).not.toBe(0)
  })
})

describe('calli corpus list', () => {
  it('shows added corpora', async () => {
    const db = tempDb()
    await run(['corpus', 'add', 'book', 'xenos', '/tmp/xenos.epub'], { CALLIMACHUS_DB: db })

    const result = await run(['corpus', 'list'], { CALLIMACHUS_DB: db })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('xenos')
  })

  it('exits with code 0 and prints a hint when no corpora are registered', async () => {
    const db = tempDb()
    const result = await run(['corpus', 'list'], { CALLIMACHUS_DB: db })

    expect(result.exitCode).toBe(0)
  })

  it('shows multiple corpora after multiple adds', async () => {
    const db = tempDb()
    await run(['corpus', 'add', 'book', 'xenos', '/tmp/xenos.epub'], { CALLIMACHUS_DB: db })
    await run(['corpus', 'add', 'book', 'ilium', '/tmp/ilium.epub', '--id=ilium'], { CALLIMACHUS_DB: db })

    const result = await run(['corpus', 'list'], { CALLIMACHUS_DB: db })

    expect(result.stdout).toContain('xenos')
    expect(result.stdout).toContain('ilium')
  })
})

describe('calli corpus status', () => {
  it('shows 0 chunks and 0 entities for a freshly added corpus', async () => {
    const db = tempDb()
    await run(['corpus', 'add', 'book', 'xenos', '/tmp/xenos.epub'], { CALLIMACHUS_DB: db })

    const result = await run(['corpus', 'status', 'xenos'], { CALLIMACHUS_DB: db })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('0')
  })

  it('exits with a non-zero code when the corpus id does not exist', async () => {
    const db = tempDb()
    const result = await run(['corpus', 'status', 'does-not-exist'], { CALLIMACHUS_DB: db })

    expect(result.exitCode).not.toBe(0)
  })

  it('outputs valid JSON when --json flag is passed', async () => {
    const db = tempDb()
    await run(['corpus', 'add', 'book', 'xenos', '/tmp/xenos.epub'], { CALLIMACHUS_DB: db })

    const result = await run(['corpus', 'status', 'xenos', '--json'], { CALLIMACHUS_DB: db })

    expect(result.exitCode).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()

    const data = JSON.parse(result.stdout)
    expect(data.chunk_count).toBe(0)
    expect(data.entity_count).toBe(0)
    expect(data.last_run).toBeNull()
  })
})

describe('calli corpus remove', () => {
  it('exits with code 0 when removing an existing corpus (non-interactive)', async () => {
    const db = tempDb()
    await run(['corpus', 'add', 'book', 'xenos', '/tmp/xenos.epub'], { CALLIMACHUS_DB: db })

    const result = await run(['corpus', 'remove', 'xenos'], { CALLIMACHUS_DB: db })

    expect(result.exitCode).toBe(0)
  })

  it('does not show the corpus in list after removal', async () => {
    const db = tempDb()
    await run(['corpus', 'add', 'book', 'xenos', '/tmp/xenos.epub'], { CALLIMACHUS_DB: db })
    await run(['corpus', 'remove', 'xenos'], { CALLIMACHUS_DB: db })

    const result = await run(['corpus', 'list'], { CALLIMACHUS_DB: db })

    expect(result.stdout).not.toContain('xenos')
  })

  it('exits with a non-zero code when the corpus id does not exist', async () => {
    const db = tempDb()
    const result = await run(['corpus', 'remove', 'does-not-exist'], { CALLIMACHUS_DB: db })

    expect(result.exitCode).not.toBe(0)
  })
})

describe('stub subcommands', () => {
  // 'index' is now a real command, so excluded from the stub list
  const stubs = ['reindex', 'watch', 'inspect', 'correct', 'export']

  for (const cmd of stubs) {
    it(`${cmd} exits with code 2`, async () => {
      const db = tempDb()
      const result = await run([cmd, 'some-id'], { CALLIMACHUS_DB: db })

      expect(result.exitCode).toBe(2)
    })
  }
})

describe('calli --help and --version', () => {
  it('--help exits with code 0', async () => {
    const result = await run(['--help'])
    expect(result.exitCode).toBe(0)
  })

  it('--version exits with code 0 and includes a version string', async () => {
    const result = await run(['--version'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/)
  })
})
