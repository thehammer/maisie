/**
 * MEL (Maisie Expression Language) pretty-printer.
 *
 * Converts ExprNode trees and ParsedEntity objects back to readable MEL source.
 * Designed for round-trip fidelity: parse(print(parse(src))) ≈ parse(src).
 *
 * Rules:
 * - Operators are parenthesized when a child has lower precedence than the parent.
 * - Pipe chains are formatted on one line when under 80 chars, else split.
 * - Define blocks: one field per line, two-space indent.
 */

import type { ExprNode, ApplyNode, LiteralNode, RefNode, LambdaNode, LetNode, PipeNode } from './ops'
import type { ParsedEntity, ParsedField, ParsedType } from './parser'

// ── Precedence ────────────────────────────────────────────────────────────────

/**
 * Returns the "precedence level" of an expression node for parenthesization.
 * Higher number = binds tighter.
 */
function precedence(node: ExprNode): number {
  if (node.kind !== 'apply') return 100 // literals, refs, lambda, let, pipe — handle separately
  switch (node.fn) {
    case 'or':         return 4
    case 'and':        return 5
    case 'not':        return 6
    case 'eq': case 'neq': case 'lt': case 'lte': case 'gt': case 'gte':
    case 'contains': case 'startsWith': return 7
    case 'add': case 'sub': return 8
    case 'mul': case 'div': case 'mod': return 9
    case 'if':         return 2
    default:           return 10 // function calls, get, etc.
  }
}

function needsParens(child: ExprNode, parentPrec: number): boolean {
  return precedence(child) < parentPrec
}

function wrap(child: ExprNode, parentPrec: number): string {
  const s = printExpr(child)
  return needsParens(child, parentPrec) ? `(${s})` : s
}

// ── Type printer ──────────────────────────────────────────────────────────────

function printType(type: ParsedType): string {
  if (type.params && type.params.length > 0) {
    return `${type.name}<${type.params.map(printType).join(', ')}>`
  }
  return type.name
}

// ── Expression printer ────────────────────────────────────────────────────────

/**
 * Convert an ExprNode to a MEL string.
 *
 * @param node   — the expression to print
 * @param indent — current indentation level (for multi-line output)
 */
export function printExpr(node: ExprNode, indent = 0): string {
  const pad = '  '.repeat(indent)

  switch (node.kind) {
    case 'literal': {
      const v = node.value
      if (v === null) return 'null'
      if (typeof v === 'boolean') return String(v)
      if (typeof v === 'number') return String(v)
      if (typeof v === 'string') return JSON.stringify(v)
      // Should not occur in well-formed trees, but handle gracefully.
      return JSON.stringify(v)
    }

    case 'ref':
      return node.name

    case 'lambda': {
      const params = node.params.join(', ')
      const body = printExpr(node.body)
      return `(${params}) => ${body}`
    }

    case 'let': {
      const lines = node.bindings.map(b => `${pad}let ${b.name} = ${printExpr(b.value, indent)}`)
      lines.push(pad + printExpr(node.body, indent))
      return lines.join('\n')
    }

    case 'pipe': {
      const value = printExpr(node.value, indent)
      const steps = node.steps.map(s => printPipeStep(s))
      const oneLiner = [value, ...steps].join(' | ')
      if (oneLiner.length <= 80) return oneLiner
      // Multi-line: value on first line, steps indented
      const stepPad = '  '.repeat(indent + 1)
      return value + '\n' + steps.map(s => `${stepPad}| ${s}`).join('\n')
    }

    case 'apply':
      return printApply(node, indent)
  }
}

/**
 * Print a pipe step — these are ApplyNodes without the collection arg.
 * We reverse the "prepend piped value" transformation to produce the named syntax.
 */
function printPipeStep(step: ExprNode): string {
  if (step.kind !== 'apply') return printExpr(step)

  const PIPE_OP_MAP: Record<string, string> = {
    'std.filter': 'filter',
    'std.map': 'map',
    'std.sort': 'sort',
    'std.limit': 'limit',
    'std.pluck': 'pluck',
    'std.group': 'group',
    'std.count': 'count',
    'std.sum': 'sum',
    'std.any': 'any',
    'std.all': 'all',
  }

  const pipeOp = PIPE_OP_MAP[step.fn]
  if (!pipeOp) return printExpr(step)

  switch (step.fn) {
    case 'std.count':
      return 'count'
    case 'std.filter':
      return `filter: ${printExpr(step.args[0])}`
    case 'std.map':
      return `map: ${printExpr(step.args[0])}`
    case 'std.any':
      return `any: ${printExpr(step.args[0])}`
    case 'std.all':
      return `all: ${printExpr(step.args[0])}`
    case 'std.sort': {
      const field = printFieldRefLiteral(step.args[0])
      const dir = printFieldRefLiteral(step.args[1])
      return dir === 'asc' ? `sort: ${field}` : `sort: ${field} ${dir}`
    }
    case 'std.limit':
      return `limit: ${printExpr(step.args[0])}`
    case 'std.pluck':
      return `pluck: ${printFieldRefLiteral(step.args[0])}`
    case 'std.group':
      return `group: ${printFieldRefLiteral(step.args[0])}`
    case 'std.sum':
      return `sum: ${printFieldRefLiteral(step.args[0])}`
    default:
      return printExpr(step)
  }
}

/**
 * Print a field reference literal (string literal used as field name in sort/pluck/etc.)
 * Emits bare identifier instead of quoted string.
 */
function printFieldRefLiteral(node: ExprNode): string {
  if (node.kind === 'literal' && typeof node.value === 'string') {
    return node.value
  }
  return printExpr(node)
}

function printApply(node: ApplyNode, indent: number): string {
  const prec = precedence(node)

  // Infix binary operators
  const INFIX: Record<string, string> = {
    'eq': '==', 'neq': '!=', 'lt': '<', 'lte': '<=', 'gt': '>', 'gte': '>=',
    'add': '+', 'sub': '-', 'mul': '*', 'div': '/', 'mod': '%',
    'and': 'and', 'or': 'or',
  }
  if (node.fn in INFIX && node.args.length === 2) {
    const op = INFIX[node.fn]
    const left = wrap(node.args[0], prec)
    const right = wrap(node.args[1], prec + 1) // +1 for left-associativity
    return `${left} ${op} ${right}`
  }

  // Word operators that look like operators in source
  if (node.fn === 'contains' && node.args.length === 2) {
    return `${wrap(node.args[0], prec)} contains ${wrap(node.args[1], prec + 1)}`
  }
  if (node.fn === 'startsWith' && node.args.length === 2) {
    return `${wrap(node.args[0], prec)} startsWith ${wrap(node.args[1], prec + 1)}`
  }

  // Prefix unary: not, unary minus
  if (node.fn === 'not' && node.args.length === 1) {
    return `not ${wrap(node.args[0], prec)}`
  }
  // unary minus was compiled as sub(0, x) — detect and print as -x
  if (node.fn === 'sub' && node.args.length === 2 &&
      node.args[0].kind === 'literal' && node.args[0].value === 0) {
    return `-${wrap(node.args[1], 10)}`
  }

  // if/then/else
  if (node.fn === 'if' && node.args.length === 3) {
    return `if ${printExpr(node.args[0])} then ${printExpr(node.args[1])} else ${printExpr(node.args[2])}`
  }

  // get(expr, field) — field access
  if (node.fn === 'get' && node.args.length === 2) {
    const obj = wrap(node.args[0], 11)
    if (node.args[1].kind === 'literal' && typeof node.args[1].value === 'string') {
      return `${obj}.${node.args[1].value}`
    }
    return `${obj}[${printExpr(node.args[1])}]`
  }

  // std.* functions used in a non-pipe context (e.g. as full expressions)
  // Print as function call syntax: fn(args)
  const fnName = node.fn.startsWith('std.') ? node.fn.slice(4) : node.fn
  const args = node.args.map(a => printExpr(a, indent)).join(', ')
  return `${fnName}(${args})`
}

// ── Entity printer ────────────────────────────────────────────────────────────

/**
 * Convert a ParsedEntity to a MEL define block.
 */
export function printEntity(entity: ParsedEntity): string {
  const lines: string[] = [`define ${entity.name} {`]

  if (entity.description !== undefined) {
    lines.push(`  description: ${JSON.stringify(entity.description)}`)
  }

  for (const field of entity.fields) {
    lines.push(printField(field))
  }

  lines.push('}')
  return lines.join('\n')
}

function printField(field: ParsedField): string {
  if (field.kind === 'function') {
    const params = field.params.map(p => {
      if (p.type) return `${p.name}: ${printType(p.type)}`
      return p.name
    }).join(', ')
    const body = printExpr(field.body, 1)
    return `  ${field.name}: function(${params}) = ${body}`
  }

  // data field
  const typeStr = field.type ? `: ${printType(field.type)}` : ''
  const exprStr = field.expression ? ` = ${printExpr(field.expression, 1)}` : ''
  return `  ${field.name}${typeStr}${exprStr}`
}
