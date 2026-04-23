import { describe, it, expect } from 'bun:test'
import { parse, parseExpression, parseComponent, parseTypeExpr, ParseError, type ParsedEntity, type ParsedComponent } from '../parser'
import { printExpr, printEntity, printComponent, printTypeExpr, print } from '../printer'
import type { ExprNode, ApplyNode, LambdaNode, LetNode, PipeNode, ComponentCallNode, LayoutCallNode } from '../ops'
import type { TypeExpr } from '../component'

// ── Helpers ───────────────────────────────────────────────────────────────────

function expr(src: string): ExprNode {
  return parseExpression(src)
}

function isApply(node: ExprNode, fn: string): node is ApplyNode {
  return node.kind === 'apply' && node.fn === fn
}

// Deep-equal comparison of two parse results (ignoring extra properties)
function astEquals(a: ExprNode, b: ExprNode): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ── Literals ──────────────────────────────────────────────────────────────────

describe('parser — literals', () => {
  it('parses integer', () => {
    expect(expr('42')).toEqual({ kind: 'literal', value: 42 })
  })

  it('parses negative integer via unary minus', () => {
    const node = expr('-5')
    expect(isApply(node, 'sub')).toBe(true)
    const apply = node as ApplyNode
    expect(apply.args[0]).toEqual({ kind: 'literal', value: 0 })
    expect(apply.args[1]).toEqual({ kind: 'literal', value: 5 })
  })

  it('parses float', () => {
    expect(expr('3.14')).toEqual({ kind: 'literal', value: 3.14 })
  })

  it('parses true', () => {
    expect(expr('true')).toEqual({ kind: 'literal', value: true })
  })

  it('parses false', () => {
    expect(expr('false')).toEqual({ kind: 'literal', value: false })
  })

  it('parses null', () => {
    expect(expr('null')).toEqual({ kind: 'literal', value: null })
  })

  it('parses double-quoted string', () => {
    expect(expr('"hello world"')).toEqual({ kind: 'literal', value: 'hello world' })
  })

  it('parses string with escape sequences', () => {
    expect(expr('"line\\nnewline"')).toEqual({ kind: 'literal', value: 'line\nnewline' })
  })
})

// ── Refs ──────────────────────────────────────────────────────────────────────

describe('parser — refs', () => {
  it('parses simple identifier', () => {
    expect(expr('x')).toEqual({ kind: 'ref', name: 'x' })
  })

  it('parses hyphenated entity name', () => {
    expect(expr('home-assistant')).toEqual({ kind: 'ref', name: 'home-assistant' })
  })

  it('parses dotted path as single RefNode', () => {
    expect(expr('home-assistant.list_switches')).toEqual({ kind: 'ref', name: 'home-assistant.list_switches' })
  })

  it('parses self as ref', () => {
    expect(expr('self')).toEqual({ kind: 'ref', name: 'self' })
  })

  it('parses self.field as single RefNode', () => {
    expect(expr('self.switches')).toEqual({ kind: 'ref', name: 'self.switches' })
  })

  it('parses self.a.b as single RefNode', () => {
    expect(expr('self.exterior.switches')).toEqual({ kind: 'ref', name: 'self.exterior.switches' })
  })
})

// ── Field access (postfix) ────────────────────────────────────────────────────

describe('parser — field access', () => {
  it('field access on function result produces get node', () => {
    // sw.state — but sw is a ref, which becomes a ref, then no postfix
    // a.b as primary is a RefNode
    const node = expr('sw.state')
    expect(node).toEqual({ kind: 'ref', name: 'sw.state' })
  })

  it('index access produces get node', () => {
    // items[0] — items is a ref, [0] is a postfix
    const node = expr('items[0]')
    expect(node.kind).toBe('apply')
    expect((node as ApplyNode).fn).toBe('get')
    expect((node as ApplyNode).args[1]).toEqual({ kind: 'literal', value: 0 })
  })
})

// ── Arithmetic ────────────────────────────────────────────────────────────────

describe('parser — arithmetic', () => {
  it('parses addition', () => {
    const node = expr('1 + 2')
    expect(isApply(node, 'add')).toBe(true)
    expect((node as ApplyNode).args).toEqual([
      { kind: 'literal', value: 1 },
      { kind: 'literal', value: 2 },
    ])
  })

  it('parses subtraction', () => {
    expect(expr('a - b')).toEqual({
      kind: 'apply', fn: 'sub',
      args: [{ kind: 'ref', name: 'a' }, { kind: 'ref', name: 'b' }],
    })
  })

  it('respects precedence: a * b + c = (a * b) + c', () => {
    const node = expr('a * b + c') as ApplyNode
    expect(node.fn).toBe('add')
    expect((node.args[0] as ApplyNode).fn).toBe('mul')
  })

  it('respects precedence: a + b * c = a + (b * c)', () => {
    const node = expr('a + b * c') as ApplyNode
    expect(node.fn).toBe('add')
    expect((node.args[1] as ApplyNode).fn).toBe('mul')
  })

  it('parentheses override precedence', () => {
    const node = expr('(a + b) * c') as ApplyNode
    expect(node.fn).toBe('mul')
    expect((node.args[0] as ApplyNode).fn).toBe('add')
  })
})

// ── Comparison ────────────────────────────────────────────────────────────────

describe('parser — comparison', () => {
  it('parses ==', () => {
    const node = expr('a == b') as ApplyNode
    expect(node.fn).toBe('eq')
  })

  it('parses !=', () => {
    expect((expr('a != b') as ApplyNode).fn).toBe('neq')
  })

  it('parses <', () => {
    expect((expr('a < b') as ApplyNode).fn).toBe('lt')
  })

  it('parses <=', () => {
    expect((expr('a <= b') as ApplyNode).fn).toBe('lte')
  })

  it('parses >', () => {
    expect((expr('a > b') as ApplyNode).fn).toBe('gt')
  })

  it('parses >=', () => {
    expect((expr('a >= b') as ApplyNode).fn).toBe('gte')
  })

  it('parses contains', () => {
    const node = expr('name contains "exterior"') as ApplyNode
    expect(node.fn).toBe('contains')
    expect(node.args[1]).toEqual({ kind: 'literal', value: 'exterior' })
  })

  it('parses startsWith', () => {
    const node = expr('name startsWith "ext"') as ApplyNode
    expect(node.fn).toBe('startsWith')
  })
})

// ── Logical ───────────────────────────────────────────────────────────────────

describe('parser — logical', () => {
  it('parses and', () => {
    const node = expr('a and b') as ApplyNode
    expect(node.fn).toBe('and')
  })

  it('parses or', () => {
    const node = expr('a or b') as ApplyNode
    expect(node.fn).toBe('or')
  })

  it('parses not', () => {
    const node = expr('not a') as ApplyNode
    expect(node.fn).toBe('not')
    expect(node.args[0]).toEqual({ kind: 'ref', name: 'a' })
  })

  it('precedence: and binds tighter than or', () => {
    // a or b and c = a or (b and c)
    const node = expr('a or b and c') as ApplyNode
    expect(node.fn).toBe('or')
    expect((node.args[1] as ApplyNode).fn).toBe('and')
  })

  it('precedence: comparison inside and', () => {
    // a == b and c == d = (a == b) and (c == d)
    const node = expr('a == b and c == d') as ApplyNode
    expect(node.fn).toBe('and')
    expect((node.args[0] as ApplyNode).fn).toBe('eq')
    expect((node.args[1] as ApplyNode).fn).toBe('eq')
  })
})

// ── Lambda ────────────────────────────────────────────────────────────────────

describe('parser — lambda', () => {
  it('parses no-param lambda', () => {
    const node = expr('() => 42') as LambdaNode
    expect(node.kind).toBe('lambda')
    expect(node.params).toEqual([])
    expect(node.body).toEqual({ kind: 'literal', value: 42 })
  })

  it('parses single-param lambda', () => {
    const node = expr('(x) => x + 1') as LambdaNode
    expect(node.kind).toBe('lambda')
    expect(node.params).toEqual(['x'])
    expect((node.body as ApplyNode).fn).toBe('add')
  })

  it('parses multi-param lambda', () => {
    const node = expr('(a, b) => a * b') as LambdaNode
    expect(node.params).toEqual(['a', 'b'])
    expect((node.body as ApplyNode).fn).toBe('mul')
  })

  it('lambda body extends greedily', () => {
    // (sw) => sw.state == "on" parses as (sw) => (sw.state == "on")
    const node = expr('(sw) => sw.state == "on"') as LambdaNode
    expect(node.kind).toBe('lambda')
    expect((node.body as ApplyNode).fn).toBe('eq')
  })
})

// ── If/then/else ─────────────────────────────────────────────────────────────

describe('parser — if/then/else', () => {
  it('parses if/then/else', () => {
    const node = expr('if a then b else c') as ApplyNode
    expect(node.fn).toBe('if')
    expect(node.args[0]).toEqual({ kind: 'ref', name: 'a' })
    expect(node.args[1]).toEqual({ kind: 'ref', name: 'b' })
    expect(node.args[2]).toEqual({ kind: 'ref', name: 'c' })
  })

  it('if with comparison condition', () => {
    const node = expr('if x > 0 then x else 0') as ApplyNode
    expect(node.fn).toBe('if')
    expect((node.args[0] as ApplyNode).fn).toBe('gt')
  })
})

// ── Let bindings ──────────────────────────────────────────────────────────────

describe('parser — let bindings', () => {
  it('parses single let binding', () => {
    const node = expr('let x = 1\nx') as LetNode
    expect(node.kind).toBe('let')
    expect(node.bindings).toHaveLength(1)
    expect(node.bindings[0].name).toBe('x')
    expect(node.bindings[0].value).toEqual({ kind: 'literal', value: 1 })
    expect(node.body).toEqual({ kind: 'ref', name: 'x' })
  })

  it('parses multiple sequential let bindings', () => {
    const src = 'let x = 1\nlet y = x + 1\ny'
    const node = expr(src) as LetNode
    expect(node.kind).toBe('let')
    expect(node.bindings).toHaveLength(2)
    expect(node.bindings[0].name).toBe('x')
    expect(node.bindings[1].name).toBe('y')
    expect(node.body).toEqual({ kind: 'ref', name: 'y' })
  })

  it('let binding value can be a pipe expression', () => {
    const src = 'let switches = list | filter: name contains "x"\nswitches'
    const node = expr(src) as LetNode
    expect(node.kind).toBe('let')
    expect(node.bindings[0].value.kind).toBe('pipe')
  })
})

// ── Pipe chains ───────────────────────────────────────────────────────────────

describe('parser — pipe chains', () => {
  it('parses simple filter pipe', () => {
    const node = expr('list | filter: active') as PipeNode
    expect(node.kind).toBe('pipe')
    expect(node.value).toEqual({ kind: 'ref', name: 'list' })
    expect(node.steps).toHaveLength(1)
    const step = node.steps[0] as ApplyNode
    expect(step.fn).toBe('std.filter')
    expect(step.args).toHaveLength(1) // no collection arg — evaluator prepends
  })

  it('parses map pipe with lambda', () => {
    const node = expr('items | map: (x) => x + 1') as PipeNode
    expect(node.kind).toBe('pipe')
    const step = node.steps[0] as ApplyNode
    expect(step.fn).toBe('std.map')
    const lambda = step.args[0] as LambdaNode
    expect(lambda.kind).toBe('lambda')
  })

  it('parses sort pipe with field', () => {
    const node = expr('items | sort: name') as PipeNode
    const step = node.steps[0] as ApplyNode
    expect(step.fn).toBe('std.sort')
    expect(step.args[0]).toEqual({ kind: 'literal', value: 'name' })
    expect(step.args[1]).toEqual({ kind: 'literal', value: 'asc' }) // default
  })

  it('parses sort with explicit desc direction', () => {
    const node = expr('items | sort: name desc') as PipeNode
    const step = node.steps[0] as ApplyNode
    expect(step.args[1]).toEqual({ kind: 'literal', value: 'desc' })
  })

  it('parses count pipe (no args)', () => {
    const node = expr('items | count') as PipeNode
    const step = node.steps[0] as ApplyNode
    expect(step.fn).toBe('std.count')
    expect(step.args).toHaveLength(0)
  })

  it('parses limit pipe', () => {
    const node = expr('items | limit: 5') as PipeNode
    const step = node.steps[0] as ApplyNode
    expect(step.fn).toBe('std.limit')
    expect(step.args[0]).toEqual({ kind: 'literal', value: 5 })
  })

  it('parses pluck pipe', () => {
    const node = expr('items | pluck: name') as PipeNode
    const step = node.steps[0] as ApplyNode
    expect(step.fn).toBe('std.pluck')
    expect(step.args[0]).toEqual({ kind: 'literal', value: 'name' })
  })

  it('parses sum pipe', () => {
    const node = expr('items | sum: value') as PipeNode
    const step = node.steps[0] as ApplyNode
    expect(step.fn).toBe('std.sum')
    expect(step.args[0]).toEqual({ kind: 'literal', value: 'value' })
  })

  it('parses any pipe', () => {
    const node = expr('items | any: (x) => x > 0') as PipeNode
    const step = node.steps[0] as ApplyNode
    expect(step.fn).toBe('std.any')
  })

  it('parses all pipe', () => {
    const node = expr('items | all: (x) => x > 0') as PipeNode
    const step = node.steps[0] as ApplyNode
    expect(step.fn).toBe('std.all')
  })

  it('parses multi-step pipe chain', () => {
    const node = expr('list | filter: name contains "x" | sort: name desc | limit: 5') as PipeNode
    expect(node.kind).toBe('pipe')
    expect(node.steps).toHaveLength(3)
    expect((node.steps[0] as ApplyNode).fn).toBe('std.filter')
    expect((node.steps[1] as ApplyNode).fn).toBe('std.sort')
    expect((node.steps[2] as ApplyNode).fn).toBe('std.limit')
  })

  it('pipe binds tighter than or', () => {
    // a or b | filter: x = a or (b | filter: x)
    const node = expr('a or b | filter: x') as ApplyNode
    expect(node.fn).toBe('or')
    expect((node.args[1] as PipeNode).kind).toBe('pipe')
  })
})

// ── Comments ──────────────────────────────────────────────────────────────────

describe('parser — comments', () => {
  it('strips line comments', () => {
    const node = expr('1 + 2 # this is a comment')
    expect((node as ApplyNode).fn).toBe('add')
  })

  it('strips multi-line comments', () => {
    const src = `# header comment
let x = 42 # inline comment
x`
    const node = expr(src) as LetNode
    expect(node.kind).toBe('let')
    expect(node.bindings[0].value).toEqual({ kind: 'literal', value: 42 })
  })
})

// ── Entity definitions ────────────────────────────────────────────────────────

describe('parser — define blocks', () => {
  it('parses simple entity with description', () => {
    const src = `define my-entity {
  description: "My entity"
}`
    const result = parse(src) as ParsedEntity
    expect(result.kind).toBe('entity')
    expect(result.name).toBe('my-entity')
    expect(result.description).toBe('My entity')
    expect(result.fields).toHaveLength(0)
  })

  it('parses entity with data field', () => {
    const src = `define exterior-lights {
  switches: collection = home-assistant.list_switches
}`
    const result = parse(src) as ParsedEntity
    expect(result.kind).toBe('entity')
    expect(result.fields).toHaveLength(1)
    const field = result.fields[0]
    expect(field.kind).toBe('data')
    expect(field.name).toBe('switches')
    if (field.kind === 'data') {
      expect(field.type?.name).toBe('collection')
      expect(field.expression?.kind).toBe('ref')
    }
  })

  it('parses entity with function field', () => {
    const src = `define exterior-lights {
  on: function() = self.switches | map: (sw) => sw.turn_on
}`
    const result = parse(src) as ParsedEntity
    const field = result.fields[0]
    expect(field.kind).toBe('function')
    if (field.kind === 'function') {
      expect(field.name).toBe('on')
      expect(field.params).toEqual([])
      expect(field.body.kind).toBe('pipe')
    }
  })

  it('parses the exterior-lights example from docs', () => {
    const src = `define exterior-lights {
  description: "The front and back exterior light switches, grouped."
  switches: collection = home-assistant.list_switches | filter: name contains "exterior"
  on: function() = self.switches | map: (sw) => sw.turn_on
  off: function() = self.switches | map: (sw) => sw.turn_off
}`
    const result = parse(src) as ParsedEntity
    expect(result.kind).toBe('entity')
    expect(result.name).toBe('exterior-lights')
    expect(result.description).toBe('The front and back exterior light switches, grouped.')
    expect(result.fields).toHaveLength(3)

    const switches = result.fields[0]
    expect(switches.kind).toBe('data')
    expect(switches.name).toBe('switches')

    const on = result.fields[1]
    expect(on.kind).toBe('function')
    expect(on.name).toBe('on')

    const off = result.fields[2]
    expect(off.kind).toBe('function')
    expect(off.name).toBe('off')
  })
})

// ── Implicit lambda wrapping (Phase 2b) ──────────────────────────────────────

describe('parser — implicit predicate lambda wrapping', () => {
  it('filter: bare expression wraps in implicit (__row) => lambda', () => {
    // `list | filter: name contains "x"` should produce a lambda wrapper
    const node = expr('list | filter: name contains "x"') as PipeNode
    expect(node.kind).toBe('pipe')
    const step = node.steps[0] as ApplyNode
    expect(step.fn).toBe('std.filter')
    const pred = step.args[0] as LambdaNode
    expect(pred.kind).toBe('lambda')
    expect(pred.params).toEqual(['__row'])
    // The body should be the comparison expression
    const body = pred.body as ApplyNode
    expect(body.fn).toBe('contains')
  })

  it('filter: explicit lambda passes through unchanged', () => {
    // `list | filter: (sw) => sw.state == "on"` should NOT get double-wrapped
    const node = expr('list | filter: (sw) => sw.state == "on"') as PipeNode
    const step = node.steps[0] as ApplyNode
    const pred = step.args[0] as LambdaNode
    expect(pred.kind).toBe('lambda')
    expect(pred.params).toEqual(['sw']) // original param name, not __row
  })

  it('sort: field name is NOT wrapped (bare field arg)', () => {
    // `list | sort: name desc` — no lambda wrapper
    const node = expr('list | sort: name desc') as PipeNode
    const step = node.steps[0] as ApplyNode
    expect(step.fn).toBe('std.sort')
    // First arg should be a LiteralNode with the field name, not a lambda
    expect(step.args[0]).toEqual({ kind: 'literal', value: 'name' })
  })

  it('map: bare expression wraps in implicit (__row) => lambda', () => {
    // `list | map: name` → implicit lambda (__row) => name
    const node = expr('list | map: name') as PipeNode
    const step = node.steps[0] as ApplyNode
    expect(step.fn).toBe('std.map')
    const fn = step.args[0] as LambdaNode
    expect(fn.kind).toBe('lambda')
    expect(fn.params).toEqual(['__row'])
  })

  it('map: explicit lambda passes through unchanged', () => {
    const node = expr('items | map: (x) => x + 1') as PipeNode
    const step = node.steps[0] as ApplyNode
    const fn = step.args[0] as LambdaNode
    expect(fn.params).toEqual(['x'])
  })

  it('any: bare expression wraps in implicit lambda', () => {
    const node = expr('items | any: state == "on"') as PipeNode
    const step = node.steps[0] as ApplyNode
    const pred = step.args[0] as LambdaNode
    expect(pred.kind).toBe('lambda')
    expect(pred.params).toEqual(['__row'])
  })

  it('all: bare expression wraps in implicit lambda', () => {
    const node = expr('items | all: active') as PipeNode
    const step = node.steps[0] as ApplyNode
    const pred = step.args[0] as LambdaNode
    expect(pred.kind).toBe('lambda')
    expect(pred.params).toEqual(['__row'])
  })

  it('pluck: field name is NOT wrapped', () => {
    const node = expr('items | pluck: state') as PipeNode
    const step = node.steps[0] as ApplyNode
    // pluck takes a field name literal, not a predicate
    expect(step.args[0]).toEqual({ kind: 'literal', value: 'state' })
  })

  it('group: field name is NOT wrapped', () => {
    const node = expr('items | group: category') as PipeNode
    const step = node.steps[0] as ApplyNode
    expect(step.args[0]).toEqual({ kind: 'literal', value: 'category' })
  })

  it('sum: field name is NOT wrapped', () => {
    const node = expr('items | sum: value') as PipeNode
    const step = node.steps[0] as ApplyNode
    expect(step.args[0]).toEqual({ kind: 'literal', value: 'value' })
  })

  it('multi-step: filter wraps, sort does not', () => {
    const node = expr('list | filter: name contains "x" | sort: name desc') as PipeNode
    const filterStep = node.steps[0] as ApplyNode
    const sortStep = node.steps[1] as ApplyNode
    // filter pred is a lambda
    expect((filterStep.args[0] as LambdaNode).kind).toBe('lambda')
    // sort field arg is a literal
    expect(sortStep.args[0]).toEqual({ kind: 'literal', value: 'name' })
  })
})

// ── Error handling ────────────────────────────────────────────────────────────

describe('parser — errors', () => {
  it('throws ParseError on unterminated string', () => {
    expect(() => expr('"unterminated')).toThrow(ParseError)
  })

  it('throws ParseError on unexpected token', () => {
    expect(() => expr(']unexpected')).toThrow(ParseError)
  })

  it('throws on unexpected character', () => {
    expect(() => expr('@invalid')).toThrow(ParseError)
  })
})

// ── Round-trip tests ──────────────────────────────────────────────────────────

describe('parser round-trip (parse → print → parse)', () => {
  function roundTrip(src: string): boolean {
    const ast1 = parseExpression(src)
    const printed = printExpr(ast1)
    const ast2 = parseExpression(printed)
    return JSON.stringify(ast1) === JSON.stringify(ast2)
  }

  it('literal integer', () => expect(roundTrip('42')).toBe(true))
  it('literal string', () => expect(roundTrip('"hello"')).toBe(true))
  it('literal boolean', () => expect(roundTrip('true')).toBe(true))
  it('null literal', () => expect(roundTrip('null')).toBe(true))
  it('ref', () => expect(roundTrip('home-assistant.list_switches')).toBe(true))
  it('addition', () => expect(roundTrip('1 + 2')).toBe(true))
  it('multiplication precedence', () => expect(roundTrip('a * b + c')).toBe(true))
  it('comparison', () => expect(roundTrip('a == b')).toBe(true))
  it('contains comparison', () => expect(roundTrip('name contains "x"')).toBe(true))
  it('logical and/or', () => expect(roundTrip('a and b or c')).toBe(true))
  it('not', () => expect(roundTrip('not a')).toBe(true))
  it('lambda', () => expect(roundTrip('(x) => x + 1')).toBe(true))
  it('if/then/else', () => expect(roundTrip('if a then b else c')).toBe(true))
  it('let binding', () => expect(roundTrip('let x = 1\nx')).toBe(true))
  it('pipe filter', () => expect(roundTrip('list | filter: active')).toBe(true))
  it('pipe sort desc', () => expect(roundTrip('items | sort: name desc')).toBe(true))
  it('pipe count', () => expect(roundTrip('items | count')).toBe(true))
  it('pipe limit', () => expect(roundTrip('items | limit: 5')).toBe(true))
  it('multi-step pipe', () => {
    expect(roundTrip('list | filter: name contains "x" | sort: name desc | limit: 5')).toBe(true)
  })

  it('entity definition round-trip', () => {
    const src = `define exterior-lights {
  description: "The exterior lights"
  switches: collection = home-assistant.list_switches | filter: name contains "exterior"
  on: function() = self.switches | map: (sw) => sw.turn_on
}`
    const ast1 = parse(src) as ParsedEntity
    const printed = printEntity(ast1)
    const ast2 = parse(printed) as ParsedEntity
    // Compare fields count and names
    expect(ast2.kind).toBe('entity')
    expect(ast2.name).toBe(ast1.name)
    expect(ast2.description).toBe(ast1.description)
    expect(ast2.fields.length).toBe(ast1.fields.length)
    for (let i = 0; i < ast1.fields.length; i++) {
      expect(ast2.fields[i].name).toBe(ast1.fields[i].name)
      expect(ast2.fields[i].kind).toBe(ast1.fields[i].kind)
    }
  })
})

// ── Proof of concept from implementation plan ─────────────────────────────────

describe('implementation plan proof of concept', () => {
  it('parses let/pipe expression from the plan', () => {
    const src = `let switches = home-assistant.list_switches | filter: name contains "exterior"
switches | pluck: state`
    const node = parseExpression(src) as LetNode
    expect(node.kind).toBe('let')
    expect(node.bindings[0].name).toBe('switches')
    expect(node.bindings[0].value.kind).toBe('pipe')
    expect(node.body.kind).toBe('pipe')
    const bodyPipe = node.body as PipeNode
    expect(bodyPipe.value).toEqual({ kind: 'ref', name: 'switches' })
    const pluckStep = bodyPipe.steps[0] as ApplyNode
    expect(pluckStep.fn).toBe('std.pluck')
    expect(pluckStep.args[0]).toEqual({ kind: 'literal', value: 'state' })
  })
})

// ── Component definitions ─────────────────────────────────────────────────────

describe('parser — component definitions', () => {
  it('detects define block with render: as component', () => {
    const src = `
define MovieTile {
  render: overlay(children: [image(src: self.coverUrl), text(value: self.title)])
}`.trim()
    const result = parse(src)
    expect(result.kind).toBe('component')
  })

  it('detects define block without render: as entity', () => {
    const src = `
define MyEntity {
  name: string = "hello"
}`.trim()
    const result = parse(src)
    expect(result.kind).toBe('entity')
  })

  it('parses description field in component', () => {
    const c = parseComponent(`
define MovieTile {
  description: "A movie tile."
  render: overlay(children: [])
}`.trim())
    expect(c.description).toBe('A movie tile.')
  })

  it('parses simple component with scalar input', () => {
    const c = parseComponent(`
define LabelTile {
  input: string
  render: text(value: self.input)
}`.trim())
    expect(c.kind).toBe('component')
    expect(c.name).toBe('LabelTile')
    expect(c.input).toEqual({ kind: 'scalar', type: 'string' })
    expect(c.render.kind).toBe('component-call')
    const call = c.render as ComponentCallNode
    expect(call.name).toBe('text')
  })

  it('parses component with record<{...}> input', () => {
    const c = parseComponent(`
define MovieTile {
  description: "A movie tile with cover, rating badge, and hover title."
  input: record<{title: string, coverUrl: url, rating: status}>
  render: overlay(children: [image(src: self.coverUrl), badge(value: self.rating), text(value: self.title)])
}`.trim())
    expect(c.input?.kind).toBe('record')
    if (c.input?.kind === 'record') {
      expect(Object.keys(c.input.fields)).toEqual(['title', 'coverUrl', 'rating'])
      expect(c.input.fields.title).toEqual({ kind: 'scalar', type: 'string' })
      expect(c.input.fields.coverUrl).toEqual({ kind: 'scalar', type: 'url' })
      expect(c.input.fields.rating).toEqual({ kind: 'scalar', type: 'status' })
    }
  })

  it('parses component with props block', () => {
    const c = parseComponent(`
define Strip {
  props: {
    itemComponent: component
    direction: string = "horizontal"
    gap: number = 12
  }
  input: collection<record>
  render: scroll(direction: self.props.direction)
}`.trim())
    expect(c.props).toBeDefined()
    expect(Object.keys(c.props!)).toEqual(['itemComponent', 'direction', 'gap'])
    expect(c.props!.itemComponent.type).toEqual({ kind: 'component' })
    expect(c.props!.direction.type).toEqual({ kind: 'scalar', type: 'string' })
    expect(c.props!.gap.type).toEqual({ kind: 'scalar', type: 'number' })
    // Check defaults
    expect(c.props!.direction.default).toEqual({ kind: 'literal', value: 'horizontal' })
    expect(c.props!.gap.default).toEqual({ kind: 'literal', value: 12 })
  })

  it('parses layout call as root render', () => {
    const c = parseComponent(`
define MyComponent {
  input: string
  render: stack(gap: 8, children: [text(value: self.input)])
}`.trim())
    expect(c.render.kind).toBe('layout-call')
    const layout = c.render as LayoutCallNode
    expect(layout.name).toBe('stack')
    expect(layout.args.gap).toEqual({ kind: 'literal', value: 8 })
  })

  it('parses component with MEL expression in render', () => {
    const c = parseComponent(`
define TitleOnly {
  input: record<{title: string}>
  render: self.title
}`.trim())
    expect(c.render.kind).toBe('ref')
    expect((c.render as import('../ops').RefNode).name).toBe('self.title')
  })

  it('parses component with component-typed prop', () => {
    const c = parseComponent(`
define Container {
  props: {
    tile: component<record<{name: string}>>
  }
  input: collection<record>
  render: scroll(children: [])
}`.trim())
    const tileProp = c.props!.tile
    expect(tileProp.type.kind).toBe('component')
    if (tileProp.type.kind === 'component' && tileProp.type.input) {
      expect(tileProp.type.input.kind).toBe('record')
    }
  })

  it('parses nested component calls in children', () => {
    const c = parseComponent(`
define MovieCard {
  input: record<{title: string, coverUrl: url}>
  render: overlay(children: [image(src: self.coverUrl), text(value: self.title)])
}`.trim())
    expect(c.render.kind).toBe('layout-call')
    const overlay = c.render as LayoutCallNode
    expect(overlay.name).toBe('overlay')
    const children = overlay.args.children
    expect(children).toBeDefined()
  })

  it('throws when render field is missing', () => {
    expect(() => parseComponent(`
define BadComponent {
  input: string
}`.trim())).toThrow()
  })

  it('backward compat: entities still parse correctly after component support added', () => {
    const src = `
define exterior-lights {
  description: "Exterior lights"
  switches: collection = home-assistant.list_switches
}`.trim()
    const result = parse(src)
    expect(result.kind).toBe('entity')
    const entity = result as ParsedEntity
    expect(entity.name).toBe('exterior-lights')
    expect(entity.fields[0].name).toBe('switches')
  })
})

// ── Type expressions ──────────────────────────────────────────────────────────

describe('parser — type expressions', () => {
  it('parses scalar types', () => {
    expect(parseTypeExpr('string')).toEqual({ kind: 'scalar', type: 'string' })
    expect(parseTypeExpr('number')).toEqual({ kind: 'scalar', type: 'number' })
    expect(parseTypeExpr('boolean')).toEqual({ kind: 'scalar', type: 'boolean' })
    expect(parseTypeExpr('url')).toEqual({ kind: 'scalar', type: 'url' })
    expect(parseTypeExpr('status')).toEqual({ kind: 'scalar', type: 'status' })
    expect(parseTypeExpr('timestamp')).toEqual({ kind: 'scalar', type: 'timestamp' })
    expect(parseTypeExpr('image')).toEqual({ kind: 'scalar', type: 'image' })
    expect(parseTypeExpr('bytes')).toEqual({ kind: 'scalar', type: 'bytes' })
    expect(parseTypeExpr('percentage')).toEqual({ kind: 'scalar', type: 'percentage' })
  })

  it('parses any', () => {
    expect(parseTypeExpr('any')).toEqual({ kind: 'any' })
  })

  it('parses collection<scalar>', () => {
    expect(parseTypeExpr('collection<string>')).toEqual({
      kind: 'collection',
      element: { kind: 'scalar', type: 'string' },
    })
  })

  it('parses collection<record>', () => {
    const t = parseTypeExpr('collection<record>')
    expect(t.kind).toBe('collection')
    if (t.kind === 'collection') {
      expect(t.element.kind).toBe('record')
    }
  })

  it('parses bare record', () => {
    expect(parseTypeExpr('record')).toEqual({ kind: 'record', fields: {} })
  })

  it('parses record<{name: string, age: number}>', () => {
    const t = parseTypeExpr('record<{name: string, age: number}>')
    expect(t.kind).toBe('record')
    if (t.kind === 'record') {
      expect(t.fields.name).toEqual({ kind: 'scalar', type: 'string' })
      expect(t.fields.age).toEqual({ kind: 'scalar', type: 'number' })
    }
  })

  it('parses nested record in record', () => {
    const t = parseTypeExpr('record<{title: string, meta: record<{year: number}>}>')
    expect(t.kind).toBe('record')
    if (t.kind === 'record') {
      expect(t.fields.title).toEqual({ kind: 'scalar', type: 'string' })
      expect(t.fields.meta.kind).toBe('record')
    }
  })

  it('parses function type with params', () => {
    const t = parseTypeExpr('function(name: string, count: number)')
    expect(t.kind).toBe('function')
    if (t.kind === 'function') {
      expect(t.params).toHaveLength(2)
      expect(t.params[0]).toEqual({ name: 'name', type: { kind: 'scalar', type: 'string' } })
      expect(t.params[1]).toEqual({ name: 'count', type: { kind: 'scalar', type: 'number' } })
      expect(t.returns).toEqual({ kind: 'any' })
    }
  })

  it('parses function type with return type (ASCII arrow)', () => {
    const t = parseTypeExpr('function(n: number) -> string')
    expect(t.kind).toBe('function')
    if (t.kind === 'function') {
      expect(t.returns).toEqual({ kind: 'scalar', type: 'string' })
    }
  })

  it('parses bare component', () => {
    expect(parseTypeExpr('component')).toEqual({ kind: 'component' })
  })

  it('parses component<record<{...}>>', () => {
    const t = parseTypeExpr('component<record<{title: string}>>')
    expect(t.kind).toBe('component')
    if (t.kind === 'component' && t.input) {
      expect(t.input.kind).toBe('record')
    }
  })

  it('parses collection<collection<string>>', () => {
    const t = parseTypeExpr('collection<collection<string>>')
    expect(t.kind).toBe('collection')
    if (t.kind === 'collection') {
      expect(t.element.kind).toBe('collection')
    }
  })
})

// ── Printer round-trips ───────────────────────────────────────────────────────

describe('printer — component round-trips', () => {
  function roundTrip(src: string): ParsedComponent {
    const c1 = parseComponent(src)
    const printed = printComponent(c1)
    const c2 = parseComponent(printed)
    return c2
  }

  it('round-trips a simple component', () => {
    const src = `
define LabelTile {
  input: string
  render: text(value: self.input)
}`.trim()
    const c = roundTrip(src)
    expect(c.name).toBe('LabelTile')
    expect(c.input).toEqual({ kind: 'scalar', type: 'string' })
  })

  it('round-trips a component with description and record input', () => {
    const src = `
define MovieTile {
  description: "A movie tile."
  input: record<{title: string, coverUrl: url, rating: status}>
  render: overlay(children: [image(src: self.coverUrl)])
}`.trim()
    const c1 = parseComponent(src)
    const printed = printComponent(c1)
    const c2 = parseComponent(printed)
    expect(c2.description).toBe(c1.description)
    expect(JSON.stringify(c2.input)).toBe(JSON.stringify(c1.input))
  })

  it('round-trips a component with props', () => {
    const src = `
define Strip {
  props: {
    itemComponent: component
    direction: string = "horizontal"
    gap: number = 12
  }
  input: collection<record>
  render: scroll(direction: self.props.direction)
}`.trim()
    const c = roundTrip(src)
    expect(Object.keys(c.props!)).toContain('itemComponent')
    expect(Object.keys(c.props!)).toContain('direction')
  })

  it('print → parse preserves render tree shape', () => {
    const src = `define Tile {
  render: overlay(children: [image(src: self.cover), text(value: self.name)])
}`.trim()
    const c1 = parseComponent(src)
    const printed = printComponent(c1)
    const c2 = parseComponent(printed)
    expect(c2.render.kind).toBe('layout-call')
  })

  it('printTypeExpr round-trips', () => {
    const types: TypeExpr[] = [
      { kind: 'any' },
      { kind: 'scalar', type: 'string' },
      { kind: 'collection', element: { kind: 'scalar', type: 'number' } },
      { kind: 'record', fields: { name: { kind: 'scalar', type: 'string' }, age: { kind: 'scalar', type: 'number' } } },
      { kind: 'function', params: [{ name: 'x', type: { kind: 'scalar', type: 'string' } }], returns: { kind: 'scalar', type: 'boolean' } },
      { kind: 'component' },
      { kind: 'component', input: { kind: 'record', fields: { id: { kind: 'scalar', type: 'number' } } } },
    ]
    for (const t of types) {
      const printed = printTypeExpr(t)
      const parsed = parseTypeExpr(printed)
      expect(JSON.stringify(parsed)).toBe(JSON.stringify(t))
    }
  })

  it('print() dispatches on component kind', () => {
    const src = `define Foo { render: text(value: self.input) }`
    const result = parse(src)
    expect(print(result)).toContain('define Foo')
  })
})

// ── Error cases ───────────────────────────────────────────────────────────────

describe('parser — component error cases', () => {
  it('throws ParseError for missing render field', () => {
    expect(() => parseComponent(`define X { input: string }`)).toThrow(ParseError)
  })

  it('throws ParseError for unknown fields in component block', () => {
    expect(() => parseComponent(`define X { unknownField: string render: text(value: self.x) }`)).toThrow()
  })

  it('throws for invalid type expression', () => {
    expect(() => parseTypeExpr('{')).toThrow()
  })
})
