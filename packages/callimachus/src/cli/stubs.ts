import { printError } from './format'

const NOT_IMPLEMENTED_MSG =
  'This subcommand is not yet implemented in the skeleton. ' +
  'See docs/callimachus-prd.md for the full feature specification and follow-on implementation plans.'

export function stubCommand(name: string): void {
  printError(`calli ${name}: ${NOT_IMPLEMENTED_MSG}`)
  process.exit(2)
}
