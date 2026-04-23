/**
 * MEL (Maisie Expression Language) parser.
 *
 * Recursive descent parser implementing the grammar from docs/grammar.md.
 * Converts MEL source strings to ExprNode trees (and ParsedEntity for define blocks).
 *
 * Operator precedence (lowest → highest):
 *   1  let ... = ... body
 *   2  if ... then ... else ...
 *   3  | (pipe)
 *   4  or
 *   5  and
 *   6  not
 *   7  == != < <= > >= contains startsWith
 *   8  + -
 *   9  * / %
 *  10  unary -
 *  11  . [] ()  (postfix)
 */

import type {
  ExprNode,
  LiteralNode,
  ApplyNode,
  LambdaNode,
  LetNode,
  PipeNode,
  ComponentCallNode,
  LayoutCallNode,
} from './ops'
import type { TypeExpr } from './component'

// ── Public types ──────────────────────────────────────────────────────────────

export type ParsedType = {
  name: string
  params?: ParsedType[]
}

export type ParsedField =
  | { kind: 'data'; name: string; type?: ParsedType; expression?: ExprNode }
  | { kind: 'function'; name: string; params: { name: string; type?: ParsedType }[]; body: ExprNode }

export type ParsedEntity = {
  kind: 'entity'
  name: string
  description?: string
  fields: ParsedField[]
}

/**
 * A parsed component definition produced by parsing a `define` block
 * that contains a `render:` field.
 */
export type ParsedComponent = {
  kind: 'component'
  name: string
  description?: string
  /** Structural input contract for the component's data. */
  input?: TypeExpr
  /** Prop declarations with their types and optional defaults. */
  props?: Record<string, { type: TypeExpr; default?: ExprNode }>
  /** Render tree — a component-call, layout-call, or MEL expression. */
  render: ExprNode
}

export type ParseResult = ExprNode | ParsedEntity | ParsedComponent

// Layout primitive names — reserved in render position.
const LAYOUT_PRIMITIVES = new Set([
  'stack', 'row', 'grid', 'overlay', 'scroll', 'card', 'spacer',
])

// Scalar type names for type expressions.
const SCALAR_TYPE_NAMES = new Set([
  'string', 'number', 'boolean', 'bytes', 'percentage', 'status', 'image',
  'timestamp', 'epoch_ms', 'duration', 'temperature', 'signal', 'url', 'stream',
  'progress', 'toggle', 'action', 'json',
])

// ── Tokens ────────────────────────────────────────────────────────────────────

type TokenType =
  | 'STRING' | 'INT' | 'FLOAT' | 'BOOL' | 'NULL'
  | 'IDENT' | 'KEYWORD'
  | 'OP' | 'LPAREN' | 'RPAREN' | 'LBRACE' | 'RBRACE' | 'LBRACKET' | 'RBRACKET'
  | 'COMMA' | 'DOT' | 'COLON' | 'PIPE' | 'EQUALS' | 'FAT_ARROW'
  | 'EOF'

interface Token {
  type: TokenType
  value: string
  pos: number
}

// Keywords that are always reserved.
const HARD_KEYWORDS = new Set([
  'define', 'let', 'if', 'then', 'else', 'self', 'function',
  'true', 'false', 'null',
  'and', 'or', 'not', 'contains', 'startsWith',
])

// Contextually reserved words — valid as idents in most positions,
// but recognised as operators after a pipe.
const PIPE_KEYWORDS = new Set([
  'filter', 'sort', 'limit', 'map', 'pluck', 'group', 'count', 'sum', 'any', 'all',
])

const SORT_KEYWORDS = new Set(['asc', 'desc'])

// ── Tokenizer ─────────────────────────────────────────────────────────────────

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const len = src.length

  function peek() { return i < len ? src[i] : '' }
  function peekAt(offset: number) { return i + offset < len ? src[i + offset] : '' }
  function advance() { return src[i++] }

  while (i < len) {
    const start = i
    const ch = src[i]

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++
      continue
    }

    // Comments
    if (ch === '#') {
      while (i < len && src[i] !== '\n') i++
      continue
    }

    // Strings
    if (ch === '"') {
      i++ // consume opening quote
      let value = ''
      while (i < len && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < len) {
          i++ // skip backslash
          const escaped = advance()
          switch (escaped) {
            case 'n': value += '\n'; break
            case 't': value += '\t'; break
            case 'r': value += '\r'; break
            case '"': value += '"'; break
            case '\\': value += '\\'; break
            default: value += '\\' + escaped
          }
        } else {
          value += advance()
        }
      }
      if (i >= len) throw new ParseError('Unterminated string literal', start)
      i++ // consume closing quote
      tokens.push({ type: 'STRING', value, pos: start })
      continue
    }

    // Numbers
    if (ch >= '0' && ch <= '9') {
      let num = ''
      while (i < len && src[i] >= '0' && src[i] <= '9') num += advance()
      if (i < len && src[i] === '.' && i + 1 < len && src[i + 1] >= '0' && src[i + 1] <= '9') {
        num += advance() // dot
        while (i < len && src[i] >= '0' && src[i] <= '9') num += advance()
        tokens.push({ type: 'FLOAT', value: num, pos: start })
      } else {
        tokens.push({ type: 'INT', value: num, pos: start })
      }
      continue
    }

    // Identifiers and keywords
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let ident = ''
      while (i < len) {
        const c = src[i]
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_') {
          ident += advance()
        } else if (c === '-' && i + 1 < len && isAlpha(src[i + 1])) {
          // Hyphen rule: part of identifier only if followed by a letter.
          ident += advance() // consume hyphen
          // Continue consuming the next segment
        } else {
          break
        }
      }
      // Classify as keyword or identifier
      if (HARD_KEYWORDS.has(ident)) {
        tokens.push({ type: 'KEYWORD', value: ident, pos: start })
      } else {
        tokens.push({ type: 'IDENT', value: ident, pos: start })
      }
      continue
    }

    // Multi-char operators — must be checked before single-char
    if (ch === '=' && peekAt(1) === '>') {
      i += 2
      tokens.push({ type: 'FAT_ARROW', value: '=>', pos: start })
      continue
    }
    if (ch === '=' && peekAt(1) === '=') {
      i += 2
      tokens.push({ type: 'OP', value: '==', pos: start })
      continue
    }
    if (ch === '!' && peekAt(1) === '=') {
      i += 2
      tokens.push({ type: 'OP', value: '!=', pos: start })
      continue
    }
    if (ch === '<' && peekAt(1) === '=') {
      i += 2
      tokens.push({ type: 'OP', value: '<=', pos: start })
      continue
    }
    if (ch === '>' && peekAt(1) === '=') {
      i += 2
      tokens.push({ type: 'OP', value: '>=', pos: start })
      continue
    }

    // Single-char symbols
    switch (ch) {
      case '(': i++; tokens.push({ type: 'LPAREN', value: '(', pos: start }); continue
      case ')': i++; tokens.push({ type: 'RPAREN', value: ')', pos: start }); continue
      case '{': i++; tokens.push({ type: 'LBRACE', value: '{', pos: start }); continue
      case '}': i++; tokens.push({ type: 'RBRACE', value: '}', pos: start }); continue
      case '[': i++; tokens.push({ type: 'LBRACKET', value: '[', pos: start }); continue
      case ']': i++; tokens.push({ type: 'RBRACKET', value: ']', pos: start }); continue
      case ',': i++; tokens.push({ type: 'COMMA', value: ',', pos: start }); continue
      case '.': i++; tokens.push({ type: 'DOT', value: '.', pos: start }); continue
      case ':': i++; tokens.push({ type: 'COLON', value: ':', pos: start }); continue
      case '|': i++; tokens.push({ type: 'PIPE', value: '|', pos: start }); continue
      case '=': i++; tokens.push({ type: 'EQUALS', value: '=', pos: start }); continue
      case '+': i++; tokens.push({ type: 'OP', value: '+', pos: start }); continue
      case '*': i++; tokens.push({ type: 'OP', value: '*', pos: start }); continue
      case '/': i++; tokens.push({ type: 'OP', value: '/', pos: start }); continue
      case '%': i++; tokens.push({ type: 'OP', value: '%', pos: start }); continue
      case '<': i++; tokens.push({ type: 'OP', value: '<', pos: start }); continue
      case '>': i++; tokens.push({ type: 'OP', value: '>', pos: start }); continue
      case '-': i++; tokens.push({ type: 'OP', value: '-', pos: start }); continue
    }

    throw new ParseError(`Unexpected character: ${JSON.stringify(ch)}`, start)
  }

  tokens.push({ type: 'EOF', value: '', pos: src.length })
  return tokens
}

function isAlpha(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'
}

// ── ParseError ────────────────────────────────────────────────────────────────

export class ParseError extends Error {
  constructor(message: string, public readonly pos: number) {
    super(message)
    this.name = 'ParseError'
  }
}

// ── Parser ────────────────────────────────────────────────────────────────────

class Parser {
  private tokens: Token[]
  private pos = 0

  constructor(src: string) {
    this.tokens = tokenize(src)
  }

  private peek(offset = 0): Token {
    const idx = this.pos + offset
    return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1]
  }

  private consume(): Token {
    const tok = this.tokens[this.pos]
    this.pos++
    return tok
  }

  private expect(type: TokenType, value?: string): Token {
    const tok = this.peek()
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      const expected = value ? `'${value}'` : type
      throw new ParseError(
        `Expected ${expected} but got ${tok.type} ${JSON.stringify(tok.value)} at position ${tok.pos}`,
        tok.pos,
      )
    }
    return this.consume()
  }

  private check(type: TokenType, value?: string): boolean {
    const tok = this.peek()
    return tok.type === type && (value === undefined || tok.value === value)
  }

  private tryConsume(type: TokenType, value?: string): Token | null {
    if (this.check(type, value)) return this.consume()
    return null
  }

  // ── Top-level ────────────────────────────────────────────────────────────────

  parse(): ParseResult {
    let result: ParseResult
    if (this.check('KEYWORD', 'define')) {
      result = this.parseDefinition()
    } else {
      result = this.parseExpression()
    }
    this.expect('EOF')
    return result
  }

  // ── Entity / Component definitions ──────────────────────────────────────────

  /**
   * Scan ahead inside a define block to detect whether it contains a `render:`
   * field, making it a component. Returns true if component, false if entity.
   *
   * We scan without consuming tokens by looking at what field names appear
   * before seeing `}` or EOF.
   */
  private scanIsComponent(): boolean {
    let offset = 0
    let braceDepth = 0
    while (true) {
      const tok = this.peek(offset)
      if (tok.type === 'EOF') break
      if (tok.type === 'LBRACE') { braceDepth++; offset++; continue }
      if (tok.type === 'RBRACE') {
        if (braceDepth === 0) break
        braceDepth--; offset++; continue
      }
      // At depth 0, check for `render :`
      if (braceDepth === 0 && tok.type === 'IDENT' && tok.value === 'render') {
        const next = this.peek(offset + 1)
        if (next.type === 'COLON') return true
      }
      offset++
    }
    return false
  }

  private parseDefinition(): ParsedEntity | ParsedComponent {
    this.expect('KEYWORD', 'define')
    const nameTok = this.expect('IDENT')
    const name = nameTok.value
    this.expect('LBRACE')

    // Detect component vs entity by scanning for `render:` field.
    if (this.scanIsComponent()) {
      return this.parseComponentMembers(name)
    }
    return this.parseEntityMembers(name)
  }

  // ── Entity members ───────────────────────────────────────────────────────────

  private parseEntityMembers(name: string): ParsedEntity {
    const fields: ParsedField[] = []
    let description: string | undefined

    while (!this.check('RBRACE') && !this.check('EOF')) {
      // description field
      if (this.check('IDENT', 'description') && this.peek(1).type === 'COLON') {
        this.consume() // 'description'
        this.consume() // ':'
        const strTok = this.expect('STRING')
        description = strTok.value
        continue
      }

      const field = this.parseFieldDef()
      fields.push(field)
    }

    this.expect('RBRACE')
    return { kind: 'entity', name, description, fields }
  }

  // ── Component members ────────────────────────────────────────────────────────

  private parseComponentMembers(name: string): ParsedComponent {
    let description: string | undefined
    let input: TypeExpr | undefined
    let props: Record<string, { type: TypeExpr; default?: ExprNode }> | undefined
    let render: ExprNode | undefined

    while (!this.check('RBRACE') && !this.check('EOF')) {
      // description:
      if (this.check('IDENT', 'description') && this.peek(1).type === 'COLON') {
        this.consume() // 'description'
        this.consume() // ':'
        description = this.expect('STRING').value
        continue
      }

      // input:
      if (this.check('IDENT', 'input') && this.peek(1).type === 'COLON') {
        this.consume() // 'input'
        this.consume() // ':'
        input = this.parseTypeExprFull()
        continue
      }

      // props:
      if (this.check('IDENT', 'props') && this.peek(1).type === 'COLON') {
        this.consume() // 'props'
        this.consume() // ':'
        props = this.parsePropsBlock()
        continue
      }

      // render:
      if (this.check('IDENT', 'render') && this.peek(1).type === 'COLON') {
        this.consume() // 'render'
        this.consume() // ':'
        render = this.parseRenderTree()
        continue
      }

      // Unknown field inside a component block — error
      const tok = this.peek()
      throw new ParseError(
        `Unexpected token in component block: ${JSON.stringify(tok.value)} at position ${tok.pos}`,
        tok.pos,
      )
    }

    this.expect('RBRACE')

    if (render === undefined) {
      throw new ParseError(`Component "${name}" is missing a render: field`, 0)
    }

    return { kind: 'component', name, description, input, props, render }
  }

  /**
   * Parse a props block: `{ propName: type_expr (= default)?, ... }`
   */
  private parsePropsBlock(): Record<string, { type: TypeExpr; default?: ExprNode }> {
    this.expect('LBRACE')
    const props: Record<string, { type: TypeExpr; default?: ExprNode }> = {}

    while (!this.check('RBRACE') && !this.check('EOF')) {
      const name = this.expect('IDENT').value
      this.expect('COLON')
      const type = this.parseTypeExprFull()
      let defaultExpr: ExprNode | undefined
      if (this.tryConsume('EQUALS')) {
        defaultExpr = this.parseExpression()
      }
      props[name] = { type, ...(defaultExpr !== undefined ? { default: defaultExpr } : {}) }

      // Optional comma or newline between props — just skip commas
      this.tryConsume('COMMA')
    }

    this.expect('RBRACE')
    return props
  }

  /**
   * Parse a full TypeExpr (the component contract type language).
   *
   * type_expr := scalar_type_name
   *            | "collection" "<" type_expr ">"
   *            | "record" "<" "{" record_fields "}" ">"
   *            | "record" "<" IDENT ">"            (bare named type)
   *            | "record"                          (bare, no type param)
   *            | "function" "(" params ")" ("→" | "->" type_expr)?
   *            | "component" ("<" type_expr ">")?
   *            | "any"
   *            | IDENT                             (named alias)
   */
  parseTypeExprFull(): TypeExpr {
    const tok = this.peek()

    // "any"
    if ((tok.type === 'KEYWORD' || tok.type === 'IDENT') && tok.value === 'any') {
      this.consume()
      return { kind: 'any' }
    }

    // "component" ("<" type_expr ">")?
    if ((tok.type === 'KEYWORD' || tok.type === 'IDENT') && tok.value === 'component') {
      this.consume()
      if (this.check('OP', '<')) {
        this.consume() // '<'
        const inner = this.parseTypeExprFull()
        this.expect('OP', '>')
        return { kind: 'component', input: inner }
      }
      return { kind: 'component' }
    }

    // "collection" "<" type_expr ">"
    if ((tok.type === 'KEYWORD' || tok.type === 'IDENT') && tok.value === 'collection') {
      this.consume()
      if (this.check('OP', '<')) {
        this.consume() // '<'
        const elem = this.parseTypeExprFull()
        this.expect('OP', '>')
        return { kind: 'collection', element: elem }
      }
      // Bare "collection" without type param — element is any
      return { kind: 'collection', element: { kind: 'any' } }
    }

    // "record" ("<" "{" ... "}" | IDENT ">")?
    if ((tok.type === 'KEYWORD' || tok.type === 'IDENT') && tok.value === 'record') {
      this.consume()
      if (this.check('OP', '<')) {
        this.consume() // '<'
        // Check for inline record body `{...}` or a named type alias
        if (this.check('LBRACE')) {
          const { fields, optional } = this.parseRecordBody()
          this.expect('OP', '>')
          return { kind: 'record', fields, optional }
        } else {
          // Named alias — treat as "record with an IDENT name" (not yet supported structurally)
          const alias = this.expect('IDENT').value
          this.expect('OP', '>')
          // Map to any-typed record for now
          return { kind: 'record', fields: {}, optional: [alias] }
        }
      }
      // Bare "record" — open record, no required fields
      return { kind: 'record', fields: {} }
    }

    // "function" "(" param_list ")" (("→" | "->") return_type)?
    if (tok.type === 'KEYWORD' && tok.value === 'function') {
      this.consume()
      this.expect('LPAREN')
      const params: Array<{ name: string; type: TypeExpr }> = []
      if (!this.check('RPAREN')) {
        params.push(this.parseTypedParam())
        while (this.tryConsume('COMMA')) {
          if (this.check('RPAREN')) break
          params.push(this.parseTypedParam())
        }
      }
      this.expect('RPAREN')
      // Check for → (Unicode arrow) or -> (ASCII)
      let returns: TypeExpr = { kind: 'any' }
      if (this.checkArrow()) {
        this.consumeArrow()
        returns = this.parseTypeExprFull()
      }
      return { kind: 'function', params, returns }
    }

    // Scalar type names (keywords and known idents)
    if ((tok.type === 'KEYWORD' || tok.type === 'IDENT') && SCALAR_TYPE_NAMES.has(tok.value)) {
      this.consume()
      return { kind: 'scalar', type: tok.value as import('./field').MaisieFieldType }
    }

    // Bare IDENT — treat as named alias / any
    if (tok.type === 'IDENT') {
      this.consume()
      // Could be a named type alias — return any for now (Phase 2c resolves names)
      return { kind: 'any' }
    }

    throw new ParseError(`Expected type expression at position ${tok.pos}`, tok.pos)
  }

  /** Parse a `{ field: type, field?: type, ... }` inline record body. */
  private parseRecordBody(): { fields: Record<string, TypeExpr>; optional?: string[] } {
    this.expect('LBRACE')
    const fields: Record<string, TypeExpr> = {}
    const optional: string[] = []

    while (!this.check('RBRACE') && !this.check('EOF')) {
      const fieldName = this.expect('IDENT').value
      // Optional marker `?` after field name
      const isOptional = !!this.tryConsume('OP', '?') || this.checkOptionalMark()
      if (isOptional) optional.push(fieldName)
      this.expect('COLON')
      const fieldType = this.parseTypeExprFull()
      fields[fieldName] = fieldType
      // Optional trailing `?` after type (alternative syntax)
      this.tryConsume('COMMA')
    }

    this.expect('RBRACE')
    return { fields, ...(optional.length > 0 ? { optional } : {}) }
  }

  /** Check for a trailing `?` marker — used for optional record fields. */
  private checkOptionalMark(): boolean {
    // We look for `?` immediately after the field name, before the `:`
    // In our tokenizer `?` is not a known symbol, so we can't handle it.
    // Optional fields are handled via `?` suffix on field name in the grammar spec
    // but since our tokenizer doesn't produce a `?` token, we skip this for now.
    return false
  }

  /** Parse `name: type_expr` for function parameter type lists. */
  private parseTypedParam(): { name: string; type: TypeExpr } {
    const name = this.expect('IDENT').value
    this.expect('COLON')
    const type = this.parseTypeExprFull()
    return { name, type }
  }

  /** Check if current token is an arrow (→ or ->) */
  private checkArrow(): boolean {
    const tok = this.peek()
    // → is a multi-char unicode — tokenizer would emit it as an IDENT or OP.
    // We handle ASCII `->` which tokenizes as OP `-` followed by OP `>`.
    // And IDENT `→` (unicode) if the tokenizer passes it through.
    if (tok.type === 'IDENT' && tok.value === '→') return true
    // ASCII arrow: `-` followed immediately by `>`
    if (tok.type === 'OP' && tok.value === '-' && this.peek(1).type === 'OP' && this.peek(1).value === '>') return true
    return false
  }

  /** Consume an arrow token (→ or ->) */
  private consumeArrow(): void {
    const tok = this.peek()
    if (tok.type === 'IDENT' && tok.value === '→') {
      this.consume()
    } else if (tok.type === 'OP' && tok.value === '-') {
      this.consume() // '-'
      this.consume() // '>'
    }
  }

  // ── Render tree ──────────────────────────────────────────────────────────────

  /**
   * Parse a render tree expression.
   *
   * render_tree := layout_call | component_call | expression
   *
   * Layout calls: `overlay(...)`, `stack(...)`, etc.
   * Component calls: `NamedComponent(...)` or base component `text(...)`, `image(...)`
   * Expressions: MEL expressions for data-level transforms
   *
   * We use a lookahead: if we see `IDENT "("` where the ident is a layout primitive,
   * treat as layout call. If ident is followed by `(` with named args, treat as
   * component call. Otherwise parse as a regular MEL expression.
   */
  private parseRenderTree(): ExprNode {
    const tok = this.peek()

    // Layout primitive: known layout name followed by `(`
    if (tok.type === 'IDENT' && LAYOUT_PRIMITIVES.has(tok.value) && this.peek(1).type === 'LPAREN') {
      return this.parseLayoutCall()
    }

    // Component call: IDENT (possibly multi-part) followed by `(` with named args
    // We detect named args by checking for `IDENT ":"` inside the parens.
    if (tok.type === 'IDENT' && this.peek(1).type === 'LPAREN' && this.isNamedArgCall(1)) {
      return this.parseComponentCall()
    }

    // Regular MEL expression (self.coverUrl, self.items | map: ..., etc.)
    return this.parseExpression()
  }

  /**
   * Lookahead: does the call starting at offset (pointing at LPAREN) have named args?
   * Named args look like `IDENT ":"` as the first content.
   * Returns true if this looks like a named-arg call.
   */
  private isNamedArgCall(lparenOffset: number): boolean {
    // peek at lparenOffset = LPAREN, lparenOffset+1 = first token inside
    const first = this.peek(lparenOffset + 1)
    const second = this.peek(lparenOffset + 2)
    if (first.type === 'RPAREN') return false // empty args — treat as component call
    if (first.type === 'IDENT' && second.type === 'COLON') return true
    if (first.type === 'LBRACKET') return true // children: [...]
    return false
  }

  /**
   * Parse a layout call: `layoutName(named_arg_list?)`.
   * Layout calls always use named arguments.
   */
  private parseLayoutCall(): LayoutCallNode {
    const name = this.expect('IDENT').value
    this.expect('LPAREN')
    const args = this.parseRenderArgList()
    this.expect('RPAREN')
    return { kind: 'layout-call', name, args }
  }

  /**
   * Parse a component call: `ComponentName(named_arg_list?)`.
   * Component calls use named arguments.
   */
  private parseComponentCall(): ComponentCallNode {
    // Component name may be dotted (components.MovieTile)
    const nameTok = this.expect('IDENT')
    let name = nameTok.value
    while (this.check('DOT') && this.peek(1).type === 'IDENT') {
      this.consume() // '.'
      name += '.' + this.expect('IDENT').value
    }
    this.expect('LPAREN')
    const args = this.parseRenderArgList()
    this.expect('RPAREN')
    return { kind: 'component-call', name, args }
  }

  /**
   * Parse a list of named arguments for render calls.
   * Each argument is `name: value` where value is a render tree or MEL expression.
   *
   * named_arg_list := named_arg ("," named_arg)*
   * named_arg := IDENT ":" (render_tree | "[" render_tree_list "]")
   */
  private parseRenderArgList(): Record<string, ExprNode> {
    const args: Record<string, ExprNode> = {}
    if (this.check('RPAREN')) return args

    this.parseOneRenderArg(args)
    while (this.tryConsume('COMMA')) {
      if (this.check('RPAREN')) break // trailing comma
      this.parseOneRenderArg(args)
    }
    return args
  }

  private parseOneRenderArg(args: Record<string, ExprNode>): void {
    const key = this.expect('IDENT').value
    this.expect('COLON')

    // `children: [...]` — array of render trees
    if (this.check('LBRACKET')) {
      this.consume() // '['
      const elements: ExprNode[] = []
      if (!this.check('RBRACKET')) {
        elements.push(this.parseRenderTree())
        while (this.tryConsume('COMMA')) {
          if (this.check('RBRACKET')) break
          elements.push(this.parseRenderTree())
        }
      }
      this.expect('RBRACKET')
      args[key] = { kind: 'literal', value: elements as never }
      return
    }

    // Nested render tree or MEL expression
    args[key] = this.parseRenderTree()
  }

  private parseFieldDef(): ParsedField {
    const nameTok = this.expect('IDENT')
    const name = nameTok.value

    // function_field: name ":" "function" "(" params ")" "=" expression
    if (this.check('COLON') && this.peek(1).type === 'KEYWORD' && this.peek(1).value === 'function') {
      this.consume() // ':'
      this.consume() // 'function'
      this.expect('LPAREN')
      const params = this.parseParamList()
      this.expect('RPAREN')
      this.expect('EQUALS')
      const body = this.parseExpression()
      return { kind: 'function', name, params, body }
    }

    // data_field: name (":" type_expr)? ("=" expression)?
    let type: ParsedType | undefined
    if (this.tryConsume('COLON')) {
      type = this.parseTypeExpr()
    }

    let expression: ExprNode | undefined
    if (this.tryConsume('EQUALS')) {
      expression = this.parseExpression()
    }

    return { kind: 'data', name, type, expression }
  }

  private parseParamList(): { name: string; type?: ParsedType }[] {
    const params: { name: string; type?: ParsedType }[] = []
    if (this.check('RPAREN')) return params

    params.push(this.parseParam())
    while (this.tryConsume('COMMA')) {
      params.push(this.parseParam())
    }
    return params
  }

  private parseParam(): { name: string; type?: ParsedType } {
    const name = this.expect('IDENT').value
    let type: ParsedType | undefined
    if (this.tryConsume('COLON')) {
      type = this.parseTypeExpr()
    }
    return { name, type }
  }

  private parseTypeExpr(): ParsedType {
    const tok = this.peek()

    // Parametric types: collection<T>, record<T>
    if ((tok.type === 'KEYWORD' || tok.type === 'IDENT') && (tok.value === 'collection' || tok.value === 'record')) {
      this.consume()
      if (this.tryConsume('OP', '<')) {
        const inner = this.parseTypeRef()
        this.expect('OP', '>')
        return { name: tok.value, params: [inner] }
      }
      return { name: tok.value }
    }

    // function type: "function" "(" param_types ")" ("→" return_type)?
    if (tok.type === 'KEYWORD' && tok.value === 'function') {
      this.consume()
      this.expect('LPAREN')
      // We skip param types for now — just consume until ')'
      while (!this.check('RPAREN') && !this.check('EOF')) this.consume()
      this.expect('RPAREN')
      return { name: 'function' }
    }

    // Simple type name (keyword or identifier)
    if (tok.type === 'KEYWORD' || tok.type === 'IDENT') {
      this.consume()
      return { name: tok.value }
    }

    throw new ParseError(`Expected type expression at position ${tok.pos}`, tok.pos)
  }

  private parseTypeRef(): ParsedType {
    const tok = this.expect('IDENT')
    return { name: tok.value }
  }

  // ── Expressions ───────────────────────────────────────────────────────────────

  /**
   * expression ::= let_expr | if_expr | or_expr
   *
   * The parse chooses based on the first keyword:
   * - 'let' → let_expr
   * - 'if' → if_expr
   * - else → or_expr (which may contain pipe)
   */
  parseExpression(): ExprNode {
    if (this.check('KEYWORD', 'let')) {
      return this.parseLetExpr()
    }
    if (this.check('KEYWORD', 'if')) {
      return this.parseIfExpr()
    }
    return this.parseOrExpr()
  }

  /**
   * let_expr ::= ("let" IDENT "=" or_expr)+ or_expr
   *
   * Compiled to LetNode with sequential bindings.
   */
  private parseLetExpr(): ExprNode {
    const bindings: { name: string; value: ExprNode }[] = []

    while (this.check('KEYWORD', 'let')) {
      this.consume() // 'let'
      const name = this.expect('IDENT').value
      this.expect('EQUALS')
      const value = this.parseOrExpr()
      bindings.push({ name, value })
    }

    const body = this.parseOrExpr()
    const node: LetNode = { kind: 'let', bindings, body }
    return node
  }

  /**
   * if_expr ::= "if" or_expr "then" or_expr "else" or_expr
   *
   * Compiled to: ApplyNode { fn: "if", args: [cond, then, else] }
   */
  private parseIfExpr(): ExprNode {
    this.expect('KEYWORD', 'if')
    const cond = this.parseOrExpr()
    this.expect('KEYWORD', 'then')
    const then_ = this.parseOrExpr()
    this.expect('KEYWORD', 'else')
    const else_ = this.parseOrExpr()
    return { kind: 'apply', fn: 'if', args: [cond, then_, else_] }
  }

  /**
   * pipe_expr ::= comparison_expr ("|" pipe_stage)*
   *
   * Pipe is parsed INSIDE or_expr/and_expr as each operand, so pipe has
   * higher precedence than or and and. This matches the spec example:
   *   a or b | filter: x  =>  a or (b | filter: x)
   *
   * If there are no pipe stages, returns the comparison_expr directly.
   * Otherwise produces a PipeNode where each stage is an ExprNode (ApplyNode)
   * WITHOUT the collection arg — the evaluator prepends the piped value.
   *
   * Pipe stage arguments use `parseAtom` (no pipe) to avoid consuming outer `|`.
   */
  private parsePipeExpr(): ExprNode {
    const base = this.parseAtom()
    if (!this.check('PIPE')) return base

    const steps: ExprNode[] = []
    while (this.tryConsume('PIPE')) {
      steps.push(this.parsePipeStage())
    }

    const node: PipeNode = { kind: 'pipe', value: base, steps }
    return node
  }

  /**
   * pipe_stage ::= named_pipe_op | atom_expr
   *
   * Named ops compile to ApplyNodes without the collection arg.
   * Other expressions are passed through as-is.
   * Uses parseAtom to avoid consuming outer pipe `|`.
   */
  private parsePipeStage(): ExprNode {
    const tok = this.peek()

    // Named pipeline operators (contextually reserved)
    if (tok.type === 'IDENT' && PIPE_KEYWORDS.has(tok.value)) {
      return this.parseNamedPipeOp()
    }

    // Regular expression as a step — use atom (no pipe) to avoid consuming `|`
    return this.parseAtom()
  }

  /**
   * atom_expr — a comparison or lower-level expression WITHOUT pipe.
   * Used for pipe stage arguments to prevent consuming outer pipe `|`.
   *
   * atom ::= not_expr (which includes comparison and additive)
   */
  private parseAtom(): ExprNode {
    return this.parseNotExpr()
  }

  /**
   * named_pipe_op — specific pipeline operations.
   *
   * Each compiles to an ApplyNode WITHOUT the collection argument.
   * The PipeNode evaluator prepends the collection.
   *
   * filter: pred  → ApplyNode { fn: "std.filter", args: [pred] }
   * map: fn       → ApplyNode { fn: "std.map",    args: [fn] }
   * etc.
   */
  private parseNamedPipeOp(): ExprNode {
    const opTok = this.consume() // consume the pipe keyword
    const op = opTok.value

    switch (op) {
      case 'filter': {
        this.expect('COLON')
        const pred = this.parseLambdaOrExpr()
        return { kind: 'apply', fn: 'std.filter', args: [pred] }
      }
      case 'map': {
        this.expect('COLON')
        const fn = this.parseLambdaOrExpr()
        return { kind: 'apply', fn: 'std.map', args: [fn] }
      }
      case 'sort': {
        this.expect('COLON')
        return this.parseSortSpec()
      }
      case 'limit': {
        this.expect('COLON')
        const n = this.parseOrExpr()
        return { kind: 'apply', fn: 'std.limit', args: [n] }
      }
      case 'pluck': {
        this.expect('COLON')
        const field = this.parseFieldRef()
        return { kind: 'apply', fn: 'std.pluck', args: [field] }
      }
      case 'group': {
        this.expect('COLON')
        const field = this.parseFieldRef()
        return { kind: 'apply', fn: 'std.group', args: [field] }
      }
      case 'count': {
        // count has no argument
        return { kind: 'apply', fn: 'std.count', args: [] }
      }
      case 'sum': {
        this.expect('COLON')
        const field = this.parseFieldRef()
        return { kind: 'apply', fn: 'std.sum', args: [field] }
      }
      case 'any': {
        this.expect('COLON')
        const pred = this.parseLambdaOrExpr()
        return { kind: 'apply', fn: 'std.any', args: [pred] }
      }
      case 'all': {
        this.expect('COLON')
        const pred = this.parseLambdaOrExpr()
        return { kind: 'apply', fn: 'std.all', args: [pred] }
      }
      default:
        throw new ParseError(`Unknown pipe operator: ${op}`, opTok.pos)
    }
  }

  /**
   * sort_spec ::= field_ref ("asc" | "desc")?
   *
   * Compiles to: ApplyNode { fn: "std.sort", args: [fieldLit, dirLit] }
   */
  private parseSortSpec(): ApplyNode {
    const field = this.parseFieldRef()

    let dir: ExprNode = { kind: 'literal', value: 'asc' }
    if (this.check('IDENT', 'asc') || this.check('IDENT', 'desc')) {
      const dirTok = this.consume()
      dir = { kind: 'literal', value: dirTok.value }
    }

    return { kind: 'apply', fn: 'std.sort', args: [field, dir] }
  }

  /**
   * field_ref ::= IDENT
   * Compiles to a LiteralNode containing the field name string.
   */
  private parseFieldRef(): LiteralNode {
    const tok = this.expect('IDENT')
    return { kind: 'literal', value: tok.value }
  }

  /**
   * lambda_or_expr ::= lambda_expr | atom_expr
   *
   * For predicate pipe stage arguments. Uses atom (no pipe) to avoid consuming
   * outer `|`. If the expression is not already a lambda, wraps it in an
   * implicit single-parameter lambda `(__row) => <expr>`. This enables
   * shorthand like `filter: name contains "x"` where `name` resolves from the
   * row via row-scope env extension in the evaluator.
   *
   * When a lambda IS present, its body is also parsed with parseAtom (not
   * parseExpression) so the lambda body does not greedily consume outer pipe
   * stages. This avoids the ambiguity in:
   *   list | filter: (__row) => name contains "x" | sort: name desc
   * where the `| sort:` must be an outer pipe step, not part of the lambda body.
   */
  private parseLambdaOrExpr(wrapImplicit = true): ExprNode {
    if (this.isLambdaAhead()) {
      // Parse the lambda with an atom body (no outer pipe consumption).
      return this.parseLambdaWithAtomBody()
    }
    const inner = this.parseAtom()
    if (wrapImplicit) {
      // Wrap bare expression in implicit lambda so the evaluator receives
      // the row record bound to `__row` and row fields in scope.
      return { kind: 'lambda', params: ['__row'], body: inner }
    }
    return inner
  }

  /**
   * Parse a lambda whose body is an atom (no pipe), preventing the body from
   * consuming outer pipe stages. Used in pipe-stage predicate positions.
   *
   * lambda_params "=>" atom_expr
   */
  private parseLambdaWithAtomBody(): LambdaNode {
    this.expect('LPAREN')
    const params: string[] = []
    if (!this.check('RPAREN')) {
      params.push(this.expect('IDENT').value)
      while (this.tryConsume('COMMA')) {
        params.push(this.expect('IDENT').value)
      }
    }
    this.expect('RPAREN')
    this.expect('FAT_ARROW')
    const body = this.parseAtom()
    return { kind: 'lambda', params, body }
  }

  /**
   * Lookahead: is this a lambda expression?
   * A lambda starts with "(" followed by optional IDENT list then ")" "=>"
   */
  private isLambdaAhead(): boolean {
    if (!this.check('LPAREN')) return false
    let offset = 1
    // Skip optional params: IDENT ("," IDENT)*
    while (true) {
      const tok = this.peek(offset)
      if (tok.type === 'RPAREN') {
        // Could be () => ... or (expr) — check for =>
        const next = this.peek(offset + 1)
        return next.type === 'FAT_ARROW'
      }
      if (tok.type === 'IDENT') {
        offset++
        const sep = this.peek(offset)
        if (sep.type === 'COMMA') {
          offset++
          continue
        }
        if (sep.type === 'RPAREN') {
          const next = this.peek(offset + 1)
          return next.type === 'FAT_ARROW'
        }
        // Not a param list
        return false
      }
      return false
    }
  }

  /**
   * or_expr ::= and_expr ("or" and_expr)*
   *
   * Each and_expr operand goes through parsePipeExpr, so pipe binds tighter than or.
   */
  private parseOrExpr(): ExprNode {
    let left = this.parseAndExpr()
    while (this.check('KEYWORD', 'or')) {
      this.consume()
      const right = this.parseAndExpr()
      left = { kind: 'apply', fn: 'or', args: [left, right] }
    }
    return left
  }

  /**
   * and_expr ::= pipe_expr ("and" pipe_expr)*
   *
   * Each pipe_expr operand goes through parsePipeExpr, so pipe binds tighter than and.
   */
  private parseAndExpr(): ExprNode {
    let left = this.parsePipeExpr()
    while (this.check('KEYWORD', 'and')) {
      this.consume()
      const right = this.parsePipeExpr()
      left = { kind: 'apply', fn: 'and', args: [left, right] }
    }
    return left
  }

  /**
   * not_expr ::= "not" not_expr | comparison_expr
   *
   * Called from parsePipeExpr. Pipe stages also go through this.
   */
  private parseNotExpr(): ExprNode {
    if (this.check('KEYWORD', 'not')) {
      this.consume()
      const operand = this.parseNotExpr()
      return { kind: 'apply', fn: 'not', args: [operand] }
    }
    return this.parseComparisonExpr()
  }

  /**
   * comparison_expr ::= additive_expr (comparison_op additive_expr)?
   *
   * Non-chainable: only one comparison per expression.
   */
  private parseComparisonExpr(): ExprNode {
    const left = this.parseAdditiveExpr()

    // Symbolic operators
    const tok = this.peek()
    if (tok.type === 'OP' && ['==', '!=', '<', '<=', '>', '>='].includes(tok.value)) {
      this.consume()
      const right = this.parseAdditiveExpr()
      const fnMap: Record<string, string> = {
        '==': 'eq', '!=': 'neq', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte',
      }
      return { kind: 'apply', fn: fnMap[tok.value], args: [left, right] }
    }

    // Word operators
    if (this.check('KEYWORD', 'contains')) {
      this.consume()
      const right = this.parseAdditiveExpr()
      return { kind: 'apply', fn: 'contains', args: [left, right] }
    }
    if (this.check('KEYWORD', 'startsWith')) {
      this.consume()
      const right = this.parseAdditiveExpr()
      return { kind: 'apply', fn: 'startsWith', args: [left, right] }
    }

    return left
  }

  /**
   * additive_expr ::= multiplicative_expr (("+" | "-") multiplicative_expr)*
   */
  private parseAdditiveExpr(): ExprNode {
    let left = this.parseMultiplicativeExpr()
    while (this.check('OP', '+') || this.check('OP', '-')) {
      const op = this.consume().value
      const right = this.parseMultiplicativeExpr()
      const fn = op === '+' ? 'add' : 'sub'
      left = { kind: 'apply', fn, args: [left, right] }
    }
    return left
  }

  /**
   * multiplicative_expr ::= unary_expr (("*" | "/" | "%") unary_expr)*
   */
  private parseMultiplicativeExpr(): ExprNode {
    let left = this.parseUnaryExpr()
    while (this.check('OP', '*') || this.check('OP', '/') || this.check('OP', '%')) {
      const op = this.consume().value
      const right = this.parseUnaryExpr()
      const fnMap: Record<string, string> = { '*': 'mul', '/': 'div', '%': 'mod' }
      left = { kind: 'apply', fn: fnMap[op], args: [left, right] }
    }
    return left
  }

  /**
   * unary_expr ::= "-" unary_expr | postfix_expr
   */
  private parseUnaryExpr(): ExprNode {
    if (this.check('OP', '-')) {
      this.consume()
      const operand = this.parseUnaryExpr()
      // Compile unary minus as: 0 - operand
      return { kind: 'apply', fn: 'sub', args: [{ kind: 'literal', value: 0 }, operand] }
    }
    return this.parsePostfixExpr()
  }

  /**
   * postfix_expr ::= primary ("." IDENT | "[" expression "]" | "(" arg_list ")")*
   *
   * Dotted identifier chains (e.g. home-assistant.list_switches, self.switches)
   * are handled in primary as a single RefNode. Additional postfix operations
   * after the primary chain produce ApplyNodes.
   */
  private parsePostfixExpr(): ExprNode {
    let expr = this.parsePrimary()

    while (true) {
      if (this.tryConsume('DOT')) {
        // Field access: expr.field → ApplyNode { fn: "get", args: [expr, Lit("field")] }
        const field = this.expect('IDENT').value
        expr = { kind: 'apply', fn: 'get', args: [expr, { kind: 'literal', value: field }] }
      } else if (this.tryConsume('LBRACKET')) {
        // Index access: expr[key] → ApplyNode { fn: "get", args: [expr, key] }
        const key = this.parseExpression()
        this.expect('RBRACKET')
        expr = { kind: 'apply', fn: 'get', args: [expr, key] }
      } else if (this.check('LPAREN')) {
        // Call: expr(args) — only if expr is a ref (function name) or another postfix
        this.consume()
        const args = this.parseArgList()
        this.expect('RPAREN')
        // For now, compile as a "call" primitive with the function and args
        expr = { kind: 'apply', fn: 'call', args: [expr, { kind: 'literal', value: Object.fromEntries(args.map((a, i) => [String(i), a])) as never }] }
      } else {
        break
      }
    }

    return expr
  }

  private parseArgList(): ExprNode[] {
    const args: ExprNode[] = []
    if (this.check('RPAREN')) return args
    args.push(this.parseExpression())
    while (this.tryConsume('COMMA')) {
      args.push(this.parseExpression())
    }
    return args
  }

  /**
   * primary ::= literal
   *           | "self" ("." IDENT)*
   *           | IDENT ("." IDENT)*
   *           | lambda_expr
   *           | "(" expression ")"
   *           | "[" expr_list "]"
   */
  private parsePrimary(): ExprNode {
    const tok = this.peek()

    // Literals
    if (tok.type === 'INT') {
      this.consume()
      return { kind: 'literal', value: parseInt(tok.value, 10) }
    }
    if (tok.type === 'FLOAT') {
      this.consume()
      return { kind: 'literal', value: parseFloat(tok.value) }
    }
    if (tok.type === 'STRING') {
      this.consume()
      return { kind: 'literal', value: tok.value }
    }
    if (tok.type === 'BOOL' || (tok.type === 'KEYWORD' && (tok.value === 'true' || tok.value === 'false'))) {
      this.consume()
      return { kind: 'literal', value: tok.value === 'true' }
    }
    if (tok.type === 'NULL' || (tok.type === 'KEYWORD' && tok.value === 'null')) {
      this.consume()
      return { kind: 'literal', value: null }
    }

    // self ("." IDENT)*
    if (tok.type === 'KEYWORD' && tok.value === 'self') {
      this.consume()
      let name = 'self'
      while (this.check('DOT') && this.peek(1).type === 'IDENT') {
        this.consume() // '.'
        name += '.' + this.expect('IDENT').value
      }
      return { kind: 'ref', name }
    }

    // Lambda: check before IDENT path to handle "(x) => ..."
    if (this.isLambdaAhead()) {
      return this.parseLambda()
    }

    // IDENT ("." IDENT)* — dotted path (entity address or local variable)
    if (tok.type === 'IDENT') {
      this.consume()
      let name = tok.value
      // Consume dotted segments to build the full address (e.g. home-assistant.list_switches)
      while (this.check('DOT') && this.peek(1).type === 'IDENT') {
        this.consume() // '.'
        name += '.' + this.expect('IDENT').value
      }
      return { kind: 'ref', name }
    }

    // Grouped expression: "(" expression ")"
    if (tok.type === 'LPAREN') {
      this.consume()
      const expr = this.parseExpression()
      this.expect('RPAREN')
      return expr
    }

    // Array literal: "[" (expression ("," expression)*)? "]"
    if (tok.type === 'LBRACKET') {
      this.consume()
      const elements: ExprNode[] = []
      if (!this.check('RBRACKET')) {
        elements.push(this.parseExpression())
        while (this.tryConsume('COMMA')) {
          if (this.check('RBRACKET')) break // trailing comma
          elements.push(this.parseExpression())
        }
      }
      this.expect('RBRACKET')
      // Compile as a literal array value
      return { kind: 'literal', value: elements as never }
    }

    throw new ParseError(
      `Unexpected token ${tok.type} ${JSON.stringify(tok.value)} at position ${tok.pos}`,
      tok.pos,
    )
  }

  /**
   * lambda_expr ::= "(" lambda_params ")" "=>" expression
   * lambda_params ::= (empty) | IDENT ("," IDENT)*
   */
  private parseLambda(): LambdaNode {
    this.expect('LPAREN')
    const params: string[] = []
    if (!this.check('RPAREN')) {
      params.push(this.expect('IDENT').value)
      while (this.tryConsume('COMMA')) {
        params.push(this.expect('IDENT').value)
      }
    }
    this.expect('RPAREN')
    this.expect('FAT_ARROW')
    const body = this.parseExpression()
    return { kind: 'lambda', params, body }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a MEL source string.
 *
 * Returns a ParsedEntity or ParsedComponent for `define` blocks, or an ExprNode
 * for expressions.
 *
 * @throws ParseError if the source is syntactically invalid.
 */
export function parse(source: string): ParseResult {
  return new Parser(source).parse()
}

/**
 * Parse a MEL expression (not a define block).
 *
 * @throws ParseError if the source is not a valid expression.
 */
export function parseExpression(source: string): ExprNode {
  const result = new Parser(source).parse()
  if ('kind' in result && (result.kind === 'entity' || result.kind === 'component')) {
    throw new ParseError('Expected expression, got definition', 0)
  }
  return result as ExprNode
}

/**
 * Parse a component definition.
 *
 * @throws ParseError if the source is not a valid component definition.
 */
export function parseComponent(source: string): ParsedComponent {
  const result = new Parser(source).parse()
  if (!('kind' in result) || result.kind !== 'component') {
    throw new ParseError('Expected component definition', 0)
  }
  return result
}

/**
 * Parse a type expression.
 *
 * @throws ParseError if the source is not a valid type expression.
 */
export function parseTypeExpr(source: string): TypeExpr {
  return new Parser(source).parseTypeExprFull()
}

export type { TypeExpr }
