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

import type { ExprNode, ApplyNode, LiteralNode, RefNode, LambdaNode, LetNode, PipeNode, ComponentCallNode, LayoutCallNode } from './ops'
import type { ParsedEntity, ParsedField, ParsedType, ParsedComponent, ParseResult } from './parser'
import type { TypeExpr } from './component'

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

    case 'component-call':
      return printComponentCallNode(node as ComponentCallNode, indent)

    case 'layout-call':
      return printLayoutCallNode(node as LayoutCallNode, indent)
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

// ── TypeExpr printer ──────────────────────────────────────────────────────────

/**
 * Convert a TypeExpr to its MEL source representation.
 */
export function printTypeExpr(t: TypeExpr): string {
  switch (t.kind) {
    case 'any':
      return 'any'

    case 'scalar':
      return t.type

    case 'collection':
      return `collection<${printTypeExpr(t.element)}>`

    case 'record': {
      const fieldNames = Object.keys(t.fields)
      if (fieldNames.length === 0) return 'record'
      const optional = new Set(t.optional ?? [])
      const fieldStrs = fieldNames.map(name => {
        const suffix = optional.has(name) ? '?' : ''
        return `${name}${suffix}: ${printTypeExpr(t.fields[name])}`
      })
      return `record<{${fieldStrs.join(', ')}}>`
    }

    case 'function': {
      const params = t.params.map(p => `${p.name}: ${printTypeExpr(p.type)}`).join(', ')
      const ret = t.returns.kind === 'any' ? '' : ` -> ${printTypeExpr(t.returns)}`
      return `function(${params})${ret}`
    }

    case 'component':
      if (t.input) return `component<${printTypeExpr(t.input)}>`
      return 'component'

    case 'optional':
      return `${printTypeExpr(t.inner)}?`

    case 'union':
      return t.members.map(printTypeExpr).join(' | ')
  }
}

// ── Render tree printer ───────────────────────────────────────────────────────

/**
 * Print a render tree node (component-call, layout-call, or MEL expression).
 */
export function printRenderTree(node: ExprNode, indent = 0): string {
  if (node.kind === 'component-call') {
    return printComponentCallNode(node as ComponentCallNode, indent)
  }
  if (node.kind === 'layout-call') {
    return printLayoutCallNode(node as LayoutCallNode, indent)
  }
  return printExpr(node, indent)
}

function printComponentCallNode(node: ComponentCallNode, indent: number): string {
  const argEntries = Object.entries(node.args)
  if (argEntries.length === 0) return `${node.name}()`
  const argStrs = argEntries.map(([k, v]) => `${k}: ${printRenderTree(v, indent + 1)}`)
  const oneLiner = `${node.name}(${argStrs.join(', ')})`
  if (oneLiner.length <= 80) return oneLiner
  const pad = '  '.repeat(indent + 1)
  return `${node.name}(\n${argStrs.map(s => `${pad}${s}`).join(',\n')}\n${'  '.repeat(indent)})`
}

function printLayoutCallNode(node: LayoutCallNode, indent: number): string {
  const argEntries = Object.entries(node.args)
  if (argEntries.length === 0) return `${node.name}()`
  const argStrs = argEntries.map(([k, v]) => {
    // Special handling for children array
    if (k === 'children' && v.kind === 'literal' && Array.isArray(v.value)) {
      const children = v.value as ExprNode[]
      const childStrs = children.map(c => printRenderTree(c, indent + 2))
      if (childStrs.length === 0) return `children: []`
      const oneLine = `children: [${childStrs.join(', ')}]`
      if (oneLine.length <= 60) return oneLine
      const pad = '  '.repeat(indent + 2)
      return `children: [\n${childStrs.map(s => `${pad}${s}`).join(',\n')}\n${'  '.repeat(indent + 1)}]`
    }
    return `${k}: ${printRenderTree(v, indent + 1)}`
  })
  const oneLiner = `${node.name}(${argStrs.join(', ')})`
  if (oneLiner.length <= 80) return oneLiner
  const pad = '  '.repeat(indent + 1)
  return `${node.name}(\n${argStrs.map(s => `${pad}${s}`).join(',\n')}\n${'  '.repeat(indent)})`
}

// ── Component printer ─────────────────────────────────────────────────────────

/**
 * Convert a ParsedComponent to its MEL source representation.
 */
export function printComponent(c: ParsedComponent): string {
  const lines: string[] = [`define ${c.name} {`]

  if (c.description !== undefined) {
    lines.push(`  description: ${JSON.stringify(c.description)}`)
  }

  if (c.input !== undefined) {
    lines.push(`  input: ${printTypeExpr(c.input)}`)
  }

  if (c.props !== undefined) {
    lines.push('  props: {')
    for (const [name, decl] of Object.entries(c.props)) {
      const typeStr = printTypeExpr(decl.type)
      const defaultStr = decl.default !== undefined ? ` = ${printExpr(decl.default, 2)}` : ''
      lines.push(`    ${name}: ${typeStr}${defaultStr}`)
    }
    lines.push('  }')
  }

  lines.push(`  render: ${printRenderTree(c.render, 1)}`)
  lines.push('}')
  return lines.join('\n')
}

// ── Top-level print dispatcher ────────────────────────────────────────────────

/**
 * Print any ParseResult (entity, component, or expression).
 */
export function print(result: ParseResult): string {
  if ('kind' in result) {
    if (result.kind === 'entity') return printEntity(result)
    if (result.kind === 'component') return printComponent(result)
  }
  return printExpr(result as ExprNode)
}
