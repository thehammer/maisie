// ANSI color helpers — same pattern as packages/cli/src/index.ts:3-15
export const c = {
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

export function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length)
}

/**
 * Print a simple column table.
 * @param headers - column headers
 * @param rows - array of rows, each row is an array of strings matching headers length
 * @param widths - column widths
 */
export function printTable(headers: string[], rows: string[][], widths: number[]): void {
  const header = headers.map((h, i) => c.bold + c.cyan + pad(h, widths[i]) + c.reset).join('  ')
  console.log(header)
  console.log(c.dim + widths.map((w) => '-'.repeat(w)).join('  ') + c.reset)
  for (const row of rows) {
    console.log(row.map((cell, i) => pad(cell, widths[i])).join('  '))
  }
}

export function printError(msg: string): void {
  console.error(`${c.red}error:${c.reset} ${msg}`)
}

export function printSuccess(msg: string): void {
  console.log(`${c.green}✓${c.reset} ${msg}`)
}
