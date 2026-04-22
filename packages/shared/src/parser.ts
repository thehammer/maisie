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
} from './ops'

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

export type ParseResult = ExprNode | ParsedEntity

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

  // ── Entity definitions ───────────────────────────────────────────────────────

  private parseDefinition(): ParsedEntity {
    this.expect('KEYWORD', 'define')
    const nameTok = this.expect('IDENT')
    const name = nameTok.value
    this.expect('LBRACE')

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
   * For pipe stage arguments. Uses atom (no pipe) to avoid consuming outer `|`.
   */
  private parseLambdaOrExpr(): ExprNode {
    if (this.isLambdaAhead()) {
      return this.parseLambda()
    }
    return this.parseAtom()
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
 * Returns a ParsedEntity for `define` blocks, or an ExprNode for expressions.
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
  if ('kind' in result && result.kind === 'entity') {
    throw new ParseError('Expected expression, got entity definition', 0)
  }
  return result as ExprNode
}
