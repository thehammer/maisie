/**
 * CodeMirror 6 StreamLanguage definition for MEL (Maisie Expression Language).
 *
 * Uses StreamLanguage with a regex-based tokenizer — lighter than a full Lezer
 * grammar and sufficient for syntax highlighting.
 *
 * Token categories per docs/grammar.md section 6.
 */

import { StreamLanguage, LanguageSupport, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// ── Token sets ────────────────────────────────────────────────────────────────

const KEYWORDS = new Set([
  'define', 'let', 'if', 'then', 'else', 'self', 'function',
  'true', 'false', 'null',
  'and', 'or', 'not', 'contains', 'startsWith',
  'description',
])

const PIPE_OPS = new Set([
  'filter', 'sort', 'limit', 'map', 'pluck', 'group', 'count', 'sum', 'any', 'all',
])

const SORT_KEYWORDS = new Set(['asc', 'desc'])

const TYPE_NAMES = new Set([
  'string', 'number', 'boolean', 'bytes', 'percentage', 'status', 'image',
  'timestamp', 'epoch_ms', 'duration', 'temperature', 'signal', 'url',
  'stream', 'collection', 'record', 'function',
])

// ── State ─────────────────────────────────────────────────────────────────────

interface MelState {
  afterPipe: boolean    // most recent meaningful token was `|`
  afterDot: boolean     // most recent meaningful token was `.`
  afterDefine: boolean  // most recent keyword was `define`
  afterColon: boolean   // most recent token was `:` (type annotation context)
  inTypeCtx: boolean    // inside a type annotation (after `:` until `=` or `{`)
}

function startState(): MelState {
  return { afterPipe: false, afterDot: false, afterDefine: false, afterColon: false, inTypeCtx: false }
}

function resetFlags(state: MelState) {
  state.afterPipe = false
  state.afterDot = false
  state.afterDefine = false
  state.afterColon = false
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

// StreamLanguage token() must return string | null.
// These string values are the CodeMirror 6 "classHighlighter" names.
// We map them to Lezer tags in the HighlightStyle below.

const melLanguageSpec = StreamLanguage.define<MelState>({
  name: 'mel',
  startState,

  token(stream, state) {
    // Whitespace — don't update flags (preserve context across whitespace)
    if (stream.eatSpace()) return null

    // Comments
    if (stream.match(/^#[^\n]*/)) {
      resetFlags(state)
      return 'comment'
    }

    // Strings
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) {
      resetFlags(state)
      return 'string'
    }

    // Numbers (float before int so we don't consume the dot)
    if (stream.match(/^-?\d+\.\d+/)) {
      resetFlags(state)
      return 'number'
    }
    if (stream.match(/^-?\d+/)) {
      resetFlags(state)
      return 'number'
    }

    // Fat arrow (must come before `=`)
    if (stream.match(/^=>/)) {
      resetFlags(state)
      return 'operator'
    }

    // Multi-char operators
    if (stream.match(/^==|^!=|^<=|^>=/)) {
      resetFlags(state)
      return 'operator'
    }

    // Single-char operators / punctuation
    const ch = stream.peek()

    if (ch === '|') {
      stream.next()
      resetFlags(state)
      state.afterPipe = true
      state.inTypeCtx = false
      return 'operator'
    }

    if (ch === ':') {
      stream.next()
      resetFlags(state)
      state.afterColon = true
      state.inTypeCtx = true
      return 'punctuation'
    }

    if (ch === '.') {
      stream.next()
      resetFlags(state)
      state.afterDot = true
      return 'punctuation'
    }

    if (ch === '=') {
      stream.next()
      resetFlags(state)
      state.inTypeCtx = false
      return 'operator'
    }

    if (ch === '<' || ch === '>') {
      stream.next()
      resetFlags(state)
      return 'operator'
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%') {
      stream.next()
      resetFlags(state)
      return 'operator'
    }

    if (ch === '(' || ch === ')') {
      stream.next()
      // Don't reset afterPipe — `filter: (x) =>` should still colour `filter` as pipe-op
      return 'punctuation'
    }

    if (ch === '{' || ch === '}') {
      stream.next()
      resetFlags(state)
      state.inTypeCtx = false
      return 'punctuation'
    }

    if (ch === '[' || ch === ']' || ch === ',') {
      stream.next()
      resetFlags(state)
      return 'punctuation'
    }

    // Identifiers (may contain hyphens within segment per MEL grammar)
    const ident = stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*(?:-[a-zA-Z0-9_]+)*/) as RegExpMatchArray | null
    if (ident) {
      const word = ident[0]
      const wasAfterPipe = state.afterPipe
      const wasAfterDot = state.afterDot
      const wasAfterDefine = state.afterDefine
      const wasInTypeCtx = state.inTypeCtx
      resetFlags(state)

      // After `define`, the next identifier is the entity name
      if (wasAfterDefine) return 'variableName2'  // entity-name (definition)

      // After a dot, it's a property access
      if (wasAfterDot) return 'propertyName'

      // After `|`, pipe operators get special highlighting
      if (wasAfterPipe && PIPE_OPS.has(word)) return 'operatorKeyword'

      // In a type annotation context
      if (wasInTypeCtx) {
        if (TYPE_NAMES.has(word)) {
          state.inTypeCtx = true  // stay in type ctx (e.g. `collection<string>`)
          return 'typeName'
        }
        // After `:` but not a type name — treat as regular identifier
      }

      // Sort direction keywords (asc/desc) after sort
      if (SORT_KEYWORDS.has(word)) return 'keyword'

      // Hard keywords
      if (KEYWORDS.has(word)) {
        if (word === 'define') state.afterDefine = true
        return 'keyword'
      }

      return 'variableName'
    }

    // Consume unknown character to avoid infinite loop
    stream.next()
    return null
  },

  blankLine(state) {
    // Blank lines don't change state
    void state
  },

  copyState(state) {
    return { ...state }
  },
})

// ── Highlight style ───────────────────────────────────────────────────────────

// Map Lezer tags to colours that complement the oneDark theme.
const melHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#c792ea' },
  { tag: t.operatorKeyword, color: '#89ddff', fontWeight: 'bold' },
  { tag: t.operator, color: '#89ddff' },
  { tag: t.string, color: '#c3e88d' },
  { tag: t.number, color: '#f78c6c' },
  { tag: t.comment, color: '#546e7a', fontStyle: 'italic' },
  { tag: t.propertyName, color: '#82aaff' },
  { tag: t.definition(t.name), color: '#ffcb6b', fontWeight: 'bold' },
  { tag: t.variableName, color: '#eeffff' },
  { tag: t.typeName, color: '#ffcb6b' },
  { tag: t.punctuation, color: '#89ddff' },
])

// ── Public API ────────────────────────────────────────────────────────────────

export function mel(): LanguageSupport {
  return new LanguageSupport(melLanguageSpec, [syntaxHighlighting(melHighlight)])
}
