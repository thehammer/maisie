# MEL — Maisie Expression Language

*Formal grammar specification — last updated 2026-04-22*

---

## Overview

MEL is the Maisie Expression Language — the surface syntax users write in the entity editor to define derived entities and compose expressions. The parser converts MEL into `ExprNode` trees (defined in `packages/shared/src/ops.ts`) for evaluation by the async expression evaluator.

---

## 1. Lexical Layer

### Literals

```
INTEGER     ::= [0-9]+
FLOAT       ::= [0-9]+ "." [0-9]+
STRING      ::= '"' ([^"\\] | "\\" .)* '"'
BOOL        ::= "true" | "false"
NULL_LIT    ::= "null"
```

### Identifiers

An identifier segment may contain hyphens within the segment (for entity names like `home-assistant`, `exterior-lights`). Hyphens are not permitted at the start or end.

```
IDENT_SEG   ::= [a-zA-Z_][a-zA-Z0-9_]*("-"[a-zA-Z0-9_]+)*
```

**Hyphen vs minus**: If a `-` immediately follows an `IDENT_SEG` character (no whitespace) and is immediately followed by `[a-zA-Z]`, it is part of the identifier. Otherwise it is the subtraction operator. `home-assistant` is one token; `x - 3` is three tokens.

### Keywords (reserved)

```
define  let  if  then  else  self  function
true  false  null
and  or  not  contains  startsWith
```

### Contextually reserved (only in specific positions)

```
# After | only:
filter  sort  limit  map  pluck  group  count  sum  any  all

# In sort position only:
asc  desc

# Inside define, as a field name only:
description
```

### Symbols

```
|  :  =  =>  .  ,  (  )  {  }  [  ]
==  !=  <  <=  >  >=
+  -  *  /  %
```

### Comments

```
comment     ::= "#" [^\n]* "\n"
```

Comments run from `#` to end of line. May appear anywhere whitespace is permitted.

### Dotted paths

Dotted paths like `home-assistant.list_switches` are tokenized as a sequence of `IDENT_SEG DOT IDENT_SEG`. The parser assembles them. Whether a dotted path is a catalog address or runtime field access is resolved at evaluation time, not parse time.

### `self`

`self` is a keyword, not an identifier. It resolves to the entity under definition. `self.switches` is `KW_SELF DOT IDENT_SEG`.

---

## 2. Type Expressions

```
type_expr       ::= TYPE_NAME
                   | "collection" "<" type_ref ">"
                   | "record" "<" IDENT_SEG ">"
                   | "function" "(" param_type_list? ")" ("→" type_expr)?
                   | IDENT_SEG

TYPE_NAME       ::= "string" | "number" | "boolean" | "bytes" | "percentage"
                   | "status" | "image" | "timestamp" | "epoch_ms" | "duration"
                   | "temperature" | "signal" | "url" | "stream"

type_ref        ::= IDENT_SEG
param_type_list ::= param_type ("," param_type)*
param_type      ::= IDENT_SEG ":" type_expr
```

---

## 3. Grammar

### Top-level

```
program     ::= (definition | expression) EOF
```

### Entity definitions

```
definition  ::= "define" entity_name "{" field_def* "}"

entity_name ::= IDENT_SEG

field_def   ::= description_field
              | function_field
              | data_field

description_field ::= "description" ":" STRING

data_field  ::= IDENT_SEG (":" type_expr)? ("=" expression)?

function_field ::= IDENT_SEG ":" "function" "(" param_list? ")" "=" expression

param_list  ::= param ("," param)*
param       ::= IDENT_SEG (":" type_expr)?
```

Field body termination: after parsing a field's expression, the current field terminates when the next token sequence matches `IDENT_SEG ":"` (new field) or `}` (end of block).

### Expressions (precedence from lowest to highest)

```
expression      ::= let_expr | if_expr | pipe_expr

let_expr        ::= ("let" IDENT_SEG "=" pipe_expr)+ pipe_expr

if_expr         ::= "if" pipe_expr "then" pipe_expr "else" pipe_expr

pipe_expr       ::= or_expr ("|" pipe_stage)*

pipe_stage      ::= named_pipe_op | call_expr
```

### Named pipeline operators

```
named_pipe_op   ::= "filter" ":" predicate
                   | "sort"   ":" sort_spec
                   | "limit"  ":" or_expr
                   | "map"    ":" lambda_or_expr
                   | "pluck"  ":" field_ref
                   | "group"  ":" field_ref
                   | "count"
                   | "sum"    ":" field_ref
                   | "any"    ":" lambda_or_expr
                   | "all"    ":" lambda_or_expr

sort_spec       ::= field_ref ("asc" | "desc")?
field_ref       ::= IDENT_SEG
predicate       ::= lambda_or_expr
lambda_or_expr  ::= lambda_expr | or_expr
```

### Binary operators

```
or_expr         ::= and_expr  ("or"  and_expr)*
and_expr        ::= not_expr  ("and" not_expr)*
not_expr        ::= "not" not_expr | comparison_expr

comparison_expr ::= additive_expr (comparison_op additive_expr)?
comparison_op   ::= "==" | "!=" | "<" | "<=" | ">" | ">=" | "contains" | "startsWith"

additive_expr       ::= multiplicative_expr (("+" | "-") multiplicative_expr)*
multiplicative_expr ::= unary_expr (("*" | "/" | "%") unary_expr)*
unary_expr          ::= "-" unary_expr | postfix_expr
```

Comparison operators are non-chainable. `a < b < c` is a parse error.

### Postfix / field access

```
postfix_expr ::= primary ("." IDENT_SEG | "[" expression "]" | "(" arg_list? ")")*
```

### Primary expressions

```
primary     ::= literal
              | "self" ("." IDENT_SEG)*
              | IDENT_SEG ("." IDENT_SEG)*
              | lambda_expr
              | "(" expression ")"
              | "[" (expression ("," expression)*)? "]"

literal     ::= STRING | FLOAT | INTEGER | BOOL | NULL_LIT

lambda_expr ::= "(" lambda_params ")" "=>" expression
lambda_params ::= /* empty */ | IDENT_SEG ("," IDENT_SEG)*

arg_list    ::= expression ("," expression)*
```

Lambda body extends greedily: `(sw) => sw.state == "on"` parses as `(sw) => (sw.state == "on")`.

---

## 4. Operator Precedence

From lowest (1) to highest (11):

| Level | Operator(s) | Associativity |
|-------|-------------|---------------|
| 1 | `let ... = ... <body>` | — |
| 2 | `if ... then ... else ...` | — |
| 3 | `\|` (pipe) | left |
| 4 | `or` | left |
| 5 | `and` | left |
| 6 | `not` | right (prefix) |
| 7 | `==` `!=` `<` `<=` `>` `>=` `contains` `startsWith` | non-chainable |
| 8 | `+` `-` | left |
| 9 | `*` `/` `%` | left |
| 10 | unary `-` | right (prefix) |
| 11 | `.field` `[expr]` `(args)` | left (postfix) |

Pipe binds tighter than `or`/`and` but looser than comparison. `a or b | filter: x` parses as `a or (b | filter: x)`.

---

## 5. AST Mapping

Surface syntax compiles to `ExprNode` types from `packages/shared/src/ops.ts`:

| Surface | ExprNode |
|---------|----------|
| `42`, `"hello"`, `true` | `LiteralNode { kind: "literal", value: ... }` |
| `name`, `self.switches` | `RefNode { kind: "ref", name: "..." }` |
| `(sw) => sw.toggle()` | `LambdaNode { kind: "lambda", params: ["sw"], body: ... }` |
| `fn(a, b)` | `ApplyNode { kind: "apply", fn: "fn", args: [...] }` |
| `a == b` | `ApplyNode { fn: "eq", args: [a, b] }` |
| `a and b` | `ApplyNode { fn: "and", args: [a, b] }` |
| `not a` | `ApplyNode { fn: "not", args: [a] }` |
| `a + b` | `ApplyNode { fn: "add", args: [a, b] }` |
| `expr.field` | `ApplyNode { fn: "get", args: [expr, LiteralNode("field")] }` |
| `expr[key]` | `ApplyNode { fn: "get", args: [expr, key] }` |
| `a \| filter: pred` | `ApplyNode { fn: "std.filter", args: [a, pred] }` |
| `a \| sort: f desc` | `ApplyNode { fn: "std.sort", args: [a, Lit("f"), Lit("desc")] }` |
| `a \| limit: 5` | `ApplyNode { fn: "std.limit", args: [a, Lit(5)] }` |
| `a \| map: fn` | `ApplyNode { fn: "std.map", args: [a, fn] }` |
| `a \| count` | `ApplyNode { fn: "std.count", args: [a] }` |
| `if c then t else e` | `ApplyNode { fn: "if", args: [c, t, e] }` |

**Let desugaring**: `let` bindings lower into immediately-applied lambdas:

```
let x = V
BODY
  →  ApplyNode { fn: "call", args: [LambdaNode { params: ["x"], body: BODY }, V] }
```

Multiple sequential `let` bindings nest.

---

## 6. Token Categories for Syntax Highlighting

| Category | Tokens | CodeMirror Tag |
|----------|--------|----------------|
| keyword | `define`, `let`, `if`, `then`, `else`, `self`, `function`, `and`, `or`, `not`, `contains`, `startsWith`, `true`, `false`, `null` | `tags.keyword` |
| pipe-keyword | `filter`, `sort`, `limit`, `map`, `pluck`, `group`, `count`, `sum`, `any`, `all` (after `\|` only) | `tags.operatorKeyword` |
| operator | `==`, `!=`, `<`, `<=`, `>`, `>=`, `+`, `-`, `*`, `/`, `%`, `\|`, `=>` | `tags.operator` |
| string | String literals | `tags.string` |
| number | Integer and float literals | `tags.number` |
| type | Type names in type position | `tags.typeName` |
| entity-name | Name after `define` | `tags.definition(tags.name)` |
| self | `self` keyword | `tags.self` |
| identifier | Variable references, lambda params | `tags.variableName` |
| field-name | Left-hand side of `:` in `define` | `tags.definition(tags.propertyName)` |
| property | After `.` in dotted path | `tags.propertyName` |
| punctuation | `{`, `}`, `(`, `)`, `[`, `]`, `,`, `.`, `:` | `tags.punctuation` |
| comment | `# ...` | `tags.lineComment` |
