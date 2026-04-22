# The Maisie Entity Model

*Reference manual — last updated 2026-04-22*

---

## Introduction

Maisie is built on a single idea: every capability in the system — reading a sensor, toggling a light, listing movies, checking ink levels — is an **entity** with a typed interface. An entity has data fields you can read and function fields you can call. Whether it comes from a hardware integration or from a user-defined composition, the shape is the same.

This uniformity is what makes the system composable. The catalog doesn't distinguish base entities from derived ones. The dashboard renders them identically. The agent calls their functions with the same tool vocabulary. The pipeline operates on them with the same operators. Every layer sees the same thing: entities with typed interfaces.

This document describes the complete model: entities, types, functions, derived entities, the catalog, components, addressing, and events.

---

## 1. Entities

An entity is the fundamental unit of the system. It has:

- A **name** — a unique identifier in the catalog
- **Data fields** — typed values you can read (a switch's current state, a printer's ink level)
- **Function fields** — typed operations you can call (toggle a switch, cancel a print job)

A base entity comes from a plugin integration. Its data fields resolve by calling an external API. Its function fields execute commands against that API.

```
home-assistant.switch.front_exterior_lights: {
  name:     string        = "Front Exterior Lights"
  state:    status        = "off"
  toggle:   function()    → { success: boolean, newState: status }
  turn_on:  function()    → { success: boolean }
  turn_off: function()    → { success: boolean }
}
```

A derived entity is composed from other entities using expressions. Its data fields resolve by evaluating pipelines. Its function fields execute composed operations.

```
exterior-lights: {
  switches:     collection<switch>  = home-assistant.list_switches
                                        | filter: name contains "exterior"
  sync_toggle:  function()          = let states = self.switches | pluck: state
                                      let any_on = states | any: eq("on")
                                      let action = if any_on then turn_off else turn_on
                                      self.switches | map: (sw) => sw[action]()
  on:           function()          = self.switches | map: (sw) => sw.turn_on()
  off:          function()          = self.switches | map: (sw) => sw.turn_off()
}
```

Both have the same shape: name, data fields, function fields. Every layer of the system — catalog, wizard, agent, renderer — treats them identically.

### Entity interfaces

An entity's interface is the set of its field names and types. Two entities with the same interface are interchangeable in any context that consumes that interface. A component that renders `{ name: string, state: status, toggle: function() }` works for any entity — a light switch, a smart plug, a camera motion sensor — that provides those fields.

This is how the catalog supports filtering: "show me all entities that provide the `{ state: status, toggle: function() }` interface" returns both individual switches and the derived `exterior-lights` entity.

---

## 2. The Type System

Every field on every entity has a type. The type system has four layers:

### Scalars

Primitive values with semantic meaning. The type tells the renderer how to display the value and tells the agent how to reason about it.

| Type | Base | Meaning |
|------|------|---------|
| `string` | string | Text — names, IDs, labels |
| `number` | number | Numeric value — counts, indices, raw measurements |
| `boolean` | boolean | True/false flag |
| `bytes` | number | Storage or transfer size; renders with unit suffix |
| `percentage` | number | 0–100; renders as progress bar, gauge, or text |
| `status` | string | Named state from shared vocabulary: ok, warning, error, idle, busy, unknown |
| `image` | string | URL; renders as thumbnail |
| `timestamp` | string | ISO 8601; renders as relative time |
| `epoch_ms` | number | Unix milliseconds; renders as relative time |
| `duration` | number | Seconds; renders as "2h 34m" |
| `temperature` | number | Celsius; renders with threshold coloring |
| `signal` | number | dBm; renders as signal strength bars |
| `url` | string | Clickable link |
| `stream` | string | Media stream URL; renders as inline player |

### Records

A named collection of typed fields. An entity's interface is a record type.

```
record<ink-levels>: {
  black:   percentage
  cyan:    percentage
  magenta: percentage
  yellow:  percentage
}
```

Records nest. A record field can contain another record:

```
record<printer-status>: {
  name:     string
  supplies: record<ink-levels>
  job:      record<print-job>
}
```

### Collections

An ordered sequence of records sharing the same type. A list of switches, a list of movies, a list of books.

```
collection<switch>: [
  { name: string, state: status, toggle: function(), ... },
  { name: string, state: status, toggle: function(), ... },
  ...
]
```

Collections are the primary input to pipeline operations (filter, sort, limit, map, group).

### Functions

A callable operation with typed inputs and outputs. Functions are first-class values in the type system — they can be fields on entities, arguments to other functions, and return values from expressions.

```
function()                              → { success: boolean }
function(brightness: number)            → { success: boolean }
function(query: string)                 → collection<media>
function(entityId: string, state: bool) → { success: boolean }
```

A function's signature determines how the component layer renders it:

| Signature | Default component |
|-----------|-------------------|
| `function() → T` | Button |
| `function() → boolean` | Toggle switch |
| `function(n: number) → T` | Slider |
| `function(s: string) → T` | Text input / search box |
| `function(...args) → T` | Form |

### The vocabulary is finite

Adding a new scalar type is a deliberate protocol change. This constraint is the price of generic rendering — every type must have at least one component, and every component must handle every value it claims to support. New types are added by updating this spec, the shared type definitions, and the component library simultaneously.

---

## 3. The Function Library

The function library provides the operations used to compose derived entities. It has three layers: primitives, the standard library, and expressions.

### Primitives

The atomic operations. These are implemented in TypeScript and are the leaves of every expression tree.

**Collection operators:**
- `filter(collection, predicate)` — keep elements matching a condition
- `sort(collection, field, direction)` — reorder by a field
- `limit(collection, n)` — take the first n elements
- `pluck(collection, field)` — extract a single field from each element
- `map(collection, fn)` — apply a function to each element
- `group(collection, field)` — partition into groups by a field value
- `count(collection)` — number of elements
- `sum(collection, field)` — sum a numeric field
- `any(collection, predicate)` — true if any element matches
- `all(collection, predicate)` — true if all elements match

**Comparison operators:**
- `eq`, `neq`, `lt`, `lte`, `gt`, `gte` — value comparisons
- `contains`, `startsWith` — string matching

**Arithmetic:**
- `add`, `sub`, `mul`, `div`, `mod`

**Logic:**
- `and`, `or`, `not`
- `if(condition, then, else)`

**String:**
- `concat`, `len`, `str` (coerce to string)

**Composition:**
- `parallel(fns[])` — execute functions concurrently, collect results
- `sequence(fns[])` — execute in order, pass result forward
- `pipe(value, fn1, fn2, ...)` — thread a value through a chain of functions
- `identity(value)` — pass through unchanged

### Standard library

Higher-level functions defined as compositions of primitives. These are stored as named `FunctionDef` entries and can be referenced by name in expressions.

```
std.filter(collection, pred)   = primitives.filter(collection, pred)
std.map(collection, fn)        = primitives.map(collection, fn)
std.pluck(collection, field)   = collection | map: (item) => item[field]
std.count(collection)          = primitives.count(collection)
std.first(collection)          = collection | limit: 1 | map: identity
std.last(collection)           = collection | sort: _index desc | limit: 1
std.unique(collection, field)  = collection | group: field | map: (g) => g.items[0]
```

The standard library is extensible. Users and the agent can define new named functions that compose existing ones.

### Expressions

The expression language is how derived entity fields are defined. An expression is a tree of nodes:

```
LiteralNode   — a constant value: 42, "hello", true
RefNode       — a reference to a named value: self.switches, state
ApplyNode     — a function application: filter(collection, predicate)
LambdaNode    — an anonymous function: (sw) => sw.toggle()
```

Expressions compose freely. A derived entity field's definition is an expression. A function field's body is an expression. An expression can reference `self` to access the entity's own fields, enabling internal composition.

**Let bindings** provide named intermediate values within an expression:

```
let states = self.switches | pluck: state
let any_on = states | any: eq("on")
let action = if any_on then turn_off else turn_on
self.switches | map: (sw) => sw[action]()
```

Bindings are scoped to the expression. They are not entity fields and are not visible outside the expression.

### Expressions are serializable

Every expression can be serialized to JSON and stored in the database. There is no eval, no string-based code generation. The expression tree is a pure data structure that the runtime evaluates.

```json
{
  "kind": "apply",
  "fn": "map",
  "args": [
    { "kind": "ref", "name": "self.switches" },
    {
      "kind": "lambda",
      "params": ["sw"],
      "body": {
        "kind": "apply",
        "fn": "call",
        "args": [
          { "kind": "ref", "name": "sw.toggle" }
        ]
      }
    }
  ]
}
```

---

## 4. Derived Entities

A derived entity is composed from other entities using expressions. It follows the same shape as a base entity — data fields and function fields — but its field definitions are expressions rather than API calls.

### Definition

```
define exterior-lights {
  description: "The front and back exterior light switches, grouped."

  switches: collection<switch> =
    home-assistant.list_switches | filter: name contains "exterior"

  sync_toggle: function() =
    let states = self.switches | pluck: state
    let any_on = states | any: eq("on")
    let action = if any_on then turn_off else turn_on
    self.switches | map: (sw) => sw[action]()

  on: function() =
    self.switches | map: (sw) => sw.turn_on()

  off: function() =
    self.switches | map: (sw) => sw.turn_off()
}
```

### Self-references

The `self` keyword refers to the entity being defined. Function fields can reference the entity's own data fields. This is what makes an entity a cohesive unit rather than a loose collection of unrelated expressions.

```
define printer-summary {
  supplies: record<ink-levels> = hp-printer.get_supply_levels
  low_supplies: collection<{ name: string, level: percentage }> =
    self.supplies | entries | filter: level < 20
}
```

### Composition depth

Derived entities compose over other derived entities. There is no limit to the depth.

```
define all-lights {
  exterior:  exterior-lights
  interior:  interior-lights

  everything_off: function() =
    parallel: [self.exterior.off(), self.interior.off()]

  any_on: boolean =
    let ext = self.exterior.switches | any: (sw) => sw.state == "on"
    let int = self.interior.switches | any: (sw) => sw.state == "on"
    ext or int
}
```

### Safety tiers

Every function field on a derived entity has a safety tier, just like base entity functions. The tier is either declared explicitly or inferred from the tiers of the functions it composes:

- If any composed function is `advise`, the derived function is `advise`
- If all composed functions are `act`, the derived function is `act`
- If all composed functions are `inform`, the derived function is `inform`

The highest tier in the composition chain wins. This ensures that wrapping a destructive operation in a derived function cannot bypass the safety model.

### Persistence

Derived entities are stored in the database as serialized expression trees. They are loaded at boot (or on creation) and registered in the catalog alongside base entities. The storage format is the JSON representation of each field's expression node.

---

## 5. The Catalog

The catalog is the registry of all entities in the system — base entities from plugins and derived entities from the database. It is the single source of truth for what the system can do.

### Homogeneity

The catalog presents all entities uniformly. A consumer of the catalog — the wizard, the agent, a pipeline expression — sees the same shape for every entry: name, description, data fields with types, function fields with signatures. The distinction between base and derived is an implementation detail invisible to consumers.

### Browsing

The catalog supports several access patterns:

**By section** — entities are grouped by section (network, media, smart home, printer, etc.) for human browsing in the wizard and dashboard.

**By interface** — "show me all entities that have a `state: status` field and a `toggle: function()` field." This is how the wizard can offer compatible alternatives and how the agent can discover entities that match a capability.

**By search** — full-text search across entity names, descriptions, and field names.

### The catalog is itself an entity

The catalog is a collection of entity descriptors. It can be filtered, sorted, and queried using the same pipeline operations that work on any other collection:

```
catalog
  | filter: fields contains { state: status, toggle: function() }
  | sort: name asc
  → collection<entity-descriptor>
```

This means you can compose derived entities from the catalog itself:

```
define toggleable-things {
  items: collection<entity-descriptor> =
    catalog | filter: fields contains { toggle: function() }

  toggle_all: function() =
    self.items | map: (entity) => entity.toggle()
}
```

### Registration

Base entities are registered at boot when plugins initialize. Derived entities are registered when created (via the wizard or agent) or loaded from the database at boot. Both go through the same validation: field types are checked, function signatures are verified, and the entity is indexed for lookup.

---

## 6. Components

Components are the rendering layer. Every type in the type system maps to one or more visual components. The user (or a default) chooses which component renders which field.

### The type-to-component mapping

Each scalar type has at least one component. Some have several:

| Type | Available components |
|------|---------------------|
| `percentage` | Progress bar, Gauge, Text ("42%") |
| `status` | Badge (colored), Dot (small indicator) |
| `string` | Text, Code (monospace), Badge |
| `number` | Number (formatted), Gauge |
| `boolean` | Yes/No label, Toggle switch |
| `timestamp` | Relative ("2h ago"), Date & time, Date only |
| `duration` | Compact ("2h 34m"), Full ("2 hours 34 minutes") |
| `bytes` | Auto-scaled file size |
| `temperature` | Celsius, Fahrenheit (with threshold colors) |
| `signal` | Signal bars |
| `image` | Thumbnail |
| `url` | Link |
| `stream` | Inline player |
| `toggle` | Toggle switch (interactive) |
| `action` | Button |

For composite types:

| Shape | Available components |
|-------|---------------------|
| `record` | Field list (label-value pairs), Compact fields |
| `collection` | Table, Card list (thumbnail + title + metadata), Simple list (titles only) |
| `function()` | Button |
| `function(n: number)` | Slider |
| `function(s: string)` | Search box / text input |
| `function(...args)` | Form |

### The rendering tree

A card is a rendering tree that mirrors the entity's type structure. Each node in the tree is a binding from a field to a component:

```
Card: exterior-lights
├── switches: collection<switch> → Table
│     ├── name: string → Text
│     ├── state: status → Badge
│     └── toggle: function() → Toggle switch
├── sync_toggle: function() → Button ("Toggle All")
├── on: function() → Button ("All On")
└── off: function() → Button ("All Off")
```

The tree is recursive. A record field expands to show its sub-fields, each with their own component. A collection field shows its display style (table, card list, simple list) and its column renderers. A collection of records within a record is another level of nesting.

### The component tree is serializable

The rendering tree — which component renders which field at which level of nesting — is stored as a JSON configuration in the layout database. It uses the existing `RendererConfig` type system, which supports nesting via `RecordRendererConfig.fieldConfigs` and `CollectionRendererConfig.columnConfigs`.

### Component selection

Component selection happens in the wizard (the card builder). The wizard walks the entity's type tree and for each field presents the available components for that field's type. The user picks, and the wizard stores the rendering tree.

When no explicit selection is made, the system infers a default component from the field type using `inferRendererConfig()`. The defaults are sensible — percentage gets a progress bar, status gets a badge, timestamps get relative time — so a card can render without any explicit configuration.

---

## 7. Addressing

Every entity, field, and function in the system has an address. Addresses are the connective tissue — expressions reference data by address, components bind to data by address, the agent calls functions by address.

### Address format

```
{entity-name}                        # the entity itself
{entity-name}.{field}                # a data field
{entity-name}.{function}             # a function field
{entity-name}.{field}.{sub-field}    # nested field access
```

For base entities, the entity name includes the plugin namespace:

```
home-assistant.switch.front_exterior_lights
home-assistant.switch.front_exterior_lights.state
home-assistant.switch.front_exterior_lights.toggle
```

For derived entities, the name is user-chosen:

```
exterior-lights
exterior-lights.switches
exterior-lights.sync_toggle
```

### Resolution

The address resolver maps an address to a live value or a callable function:

- `exterior-lights.switches` → evaluates the expression, returns the current collection
- `exterior-lights.sync_toggle` → returns the function (callable)
- `exterior-lights.sync_toggle()` → invokes the function, returns the result

Resolution is lazy. Data fields are evaluated when accessed, not when the entity is registered. Function fields are only invoked when explicitly called.

### Addresses in expressions

Expressions use addresses to reference other entities and their fields:

```
home-assistant.list_switches | filter: name contains "exterior"
```

Here `home-assistant.list_switches` is an address that resolves to a function call (the `list_switches` action on the `home-assistant` plugin), and `name` is a field address within each element of the resulting collection.

### Addresses in component bindings

Components bind to data by address. When the data at an address changes (via events), the component re-renders:

```json
{
  "type": "badge",
  "bind": "exterior-lights.switches.0.state"
}
```

---

## 8. Events

Entities emit events when their state changes. Events are the real-time layer — they drive dashboard updates, wake agent personas, and trigger derived entity re-evaluation.

### Event structure

An event carries:

- **Source address** — which entity field changed
- **Type** — the semantic type of the value
- **Value** — the new value
- **Timestamp** — when the change occurred

### Event propagation

When a base entity's data changes (a switch is toggled, a print job completes), the plugin emits an event on the MQTT bus with the entity's address as the topic.

Derived entities propagate events from their sources. When `home-assistant.switch.front_exterior_lights.state` changes, the `exterior-lights.switches` field is invalidated. Any component bound to `exterior-lights.switches` re-renders. Any agent persona subscribed to `exterior-lights.*` is notified.

### Subscriptions

Components subscribe to addresses. The subscription model is:

- **Exact** — `exterior-lights.switches` → notified when the switches collection changes
- **Wildcard** — `exterior-lights.*` → notified when any field on the entity changes
- **Deep wildcard** — `home-assistant.switch.*.state` → notified when any switch state changes

### Events and the agent

Agent personas declare event subscriptions as address patterns. When a matching event fires, the persona is woken with the event context and can decide whether to act.

```
persona natalie {
  subscriptions: ["unifi.network-device.*.state", "synology.volume.*.used_percent"]
}
```

Natalie wakes when a network device goes offline or a volume crosses a usage threshold.

---

## Summary

The complete model:

1. **Entities** are the fundamental unit — data fields and function fields, same shape whether base or derived
2. **Types** are the vocabulary — scalars, records, collections, and functions, finite and stable
3. **Functions** are the composition layer — primitives, standard library, and serializable expressions
4. **Derived entities** are composed from other entities using expressions, with self-references for cohesion
5. **The catalog** is the homogeneous registry — all entities, browsable, filterable, itself an entity
6. **Components** are the rendering layer — one or more per type, organized as a recursive tree matching the entity's type structure
7. **Addresses** are the connective tissue — every entity, field, and function is reachable by address
8. **Events** are the real-time layer — state changes propagate through the entity graph to components and agents

The system composes at every level. Entities compose into derived entities. Functions compose into derived functions. Components compose into rendering trees. The catalog itself composes. Every layer uses the same type system, the same addresses, and the same expression language.
