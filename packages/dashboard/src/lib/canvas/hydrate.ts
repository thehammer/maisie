/**
 * Round-trip hydration — reconstruct a CanvasDocument from a saved artifact.
 *
 * Phase 3l focus: clean cases only.
 *   - ViewDef: entity → (function chain) → component  (most direct case)
 *   - EntityDef: entity with a simple derivation expression (entity ref + chain)
 *   - ComponentDef: single root component-call or layout-call
 *
 * Complex expressions (deep let bindings, multiple nested calls, etc.) fall
 * back gracefully — the function still returns a document, but sets a
 * `hydrateNote` on it describing what was dropped. The caller can surface this
 * note to the user.
 *
 * None of these functions perform I/O — they are pure transformers.
 */

import type { CanvasDocument, Placement } from './document'
import { emptyDocument } from './document'
import type { EntityDef, ComponentDef, ViewDef, ChainStep } from '@maisie/shared'
import type { ExprNode } from '@maisie/shared'

// ── Extended document type (carries an optional note for the UI) ──────────────

export interface HydratedDocument extends CanvasDocument {
  /** Non-empty if hydration was approximate (some structure was dropped). */
  hydrateNote?: string
}

// ── View hydration ────────────────────────────────────────────────────────────

/**
 * Hydrate a ViewDef into a CanvasDocument.
 *
 * Views are the cleanest case: entity → function chain → component is exactly
 * the canvas model. Each ChainStep becomes a function placement.
 *
 *   entity placement (x=60)
 *     → fn1 (x=240, if chain)
 *     → fn2 (x=420, if chain)
 *     → component placement (x=right side)
 */
export function hydrateView(view: ViewDef): HydratedDocument {
  const entityId = makeId('p')
  const componentId = makeId('p')

  const n = view.chain.length
  // Space entity, fns, component evenly: entity at 60, component at 60 + (n+1)*200
  const componentX = 60 + (n + 1) * 200

  const entityPlacement: Placement = {
    id: entityId,
    kind: 'entity',
    targetName: view.source.entity,
    position: { x: 60, y: 120 },
  }

  // Build function placements from chain steps (if any)
  const fnPlacements: Placement[] = view.chain.map((step: ChainStep, i: number) => ({
    id: makeId('p'),
    kind: 'function' as const,
    targetName: step.functionId,
    position: { x: 60 + (i + 1) * 200, y: 120 },
    config: step.params,
  }))

  const componentPlacement: Placement = {
    id: componentId,
    kind: 'component',
    targetName: view.component,
    position: { x: componentX, y: 120 },
    config: view.componentProps,
  }

  const allPlacements: Placement[] = [entityPlacement, ...fnPlacements, componentPlacement]

  // Wire them in sequence: entity → fn[0] → fn[1] → ... → component
  const allIds = [entityId, ...fnPlacements.map((p) => p.id), componentId]
  const wires: CanvasDocument['wires'] = []
  for (let i = 0; i < allIds.length - 1; i++) {
    wires.push({
      id: makeId('w'),
      source: { placementId: allIds[i] },
      target: { placementId: allIds[i + 1] },
    })
  }

  return { version: 1, placements: allPlacements, wires }
}

// ── Entity hydration ──────────────────────────────────────────────────────────

/**
 * Hydrate an EntityDef into a CanvasDocument.
 *
 * Clean cases:
 *   - Derived entity whose primary data field expression is a ref (entity source)
 *     optionally chained through apply nodes (function placements).
 *
 * Everything else falls back: produces a single entity placement with a note.
 */
export function hydrateEntity(entity: EntityDef): HydratedDocument {
  // Find the first data field with an expression
  const dataFields = Object.entries(entity.fields).filter(
    ([, f]) => f.kind === 'data' && f.expression != null,
  )

  if (dataFields.length === 0) {
    // No expression to reverse-engineer — a plugin entity or bare declaration
    const id = makeId('p')
    return {
      version: 1,
      placements: [{ id, kind: 'entity', targetName: entity.name, position: { x: 60, y: 120 } }],
      wires: [],
      hydrateNote: 'Entity has no expression to visualize — showing as a bare entity node.',
    }
  }

  const [, fieldDef] = dataFields[0]
  if (fieldDef.kind !== 'data') {
    return fallbackEntity(entity, 'Primary field is not a data field.')
  }

  const expr = fieldDef.expression!

  // Try to decompose the expression as a chain: ref → apply → apply → ...
  const chain = extractChain(expr)
  if (!chain) {
    return fallbackEntity(entity, 'Expression is too complex to visualize cleanly — showing entity node only.')
  }

  const { sourceRef, steps } = chain
  const n = steps.length
  const componentX = 60 + (n + 1) * 200

  const sourceId = makeId('p')
  const fnPlacements: Placement[] = steps.map((step, i) => ({
    id: makeId('p'),
    kind: 'function' as const,
    targetName: step.fnId,
    position: { x: 60 + (i + 1) * 200, y: 120 },
    config: step.params,
  }))

  const entityTargetId = makeId('p')
  const entityTargetPlacement: Placement = {
    id: entityTargetId,
    kind: 'entity',
    targetName: entity.name,
    position: { x: componentX, y: 120 },
  }

  const sourcePlacement: Placement = {
    id: sourceId,
    kind: 'entity',
    targetName: sourceRef,
    position: { x: 60, y: 120 },
  }

  const allPlacements: Placement[] = [sourcePlacement, ...fnPlacements, entityTargetPlacement]
  const allIds = [sourceId, ...fnPlacements.map((p) => p.id), entityTargetId]
  const wires: CanvasDocument['wires'] = []
  for (let i = 0; i < allIds.length - 1; i++) {
    wires.push({
      id: makeId('w'),
      source: { placementId: allIds[i] },
      target: { placementId: allIds[i + 1] },
    })
  }

  return { version: 1, placements: allPlacements, wires }
}

// ── Component hydration ───────────────────────────────────────────────────────

/**
 * Hydrate a ComponentDef into a CanvasDocument.
 *
 * Clean cases:
 *   - A component whose render tree is a single component-call or layout-call node
 *     (with optional wired arguments from another component or entity).
 *
 * Complex render trees fall back to a single component node.
 */
export function hydrateComponent(component: ComponentDef): HydratedDocument {
  if (!component.render) {
    const id = makeId('p')
    return {
      version: 1,
      placements: [{ id, kind: 'component', targetName: component.name, position: { x: 60, y: 120 } }],
      wires: [],
      hydrateNote: 'Component has no render tree to visualize.',
    }
  }

  const render = component.render as ExprNode

  // Handle component-call / layout-call at the root
  if (render.kind === 'component-call' || render.kind === 'layout-call') {
    const call = render as { kind: string; name: string; args?: Record<string, ExprNode> }
    const rootId = makeId('p')
    const rootPlacement: Placement = {
      id: rootId,
      kind: 'component',
      targetName: call.name,
      position: { x: 300, y: 120 },
    }

    const placements: Placement[] = [rootPlacement]
    const wires: CanvasDocument['wires'] = []

    // For each arg that is a ref or apply chain, add an entity/function placement
    const args = call.args ?? {}
    let x = 60
    for (const [slot, argExpr] of Object.entries(args)) {
      const chain = extractChain(argExpr as ExprNode)
      if (chain) {
        const sourceId = makeId('p')
        placements.push({
          id: sourceId,
          kind: 'entity',
          targetName: chain.sourceRef,
          position: { x, y: 120 },
        })
        x += 180

        const fnIds: string[] = []
        for (const step of chain.steps) {
          const fnId = makeId('p')
          placements.push({
            id: fnId,
            kind: 'function',
            targetName: step.fnId,
            position: { x, y: 120 },
            config: step.params,
          })
          fnIds.push(fnId)
          x += 160
        }

        const allIds = [sourceId, ...fnIds]
        for (let i = 0; i < allIds.length - 1; i++) {
          wires.push({ id: makeId('w'), source: { placementId: allIds[i] }, target: { placementId: allIds[i + 1] } })
        }
        // Wire the last in chain to root
        wires.push({
          id: makeId('w'),
          source: { placementId: allIds[allIds.length - 1] },
          target: { placementId: rootId, slot },
        })
      }
      // Literal / other args: skip (they're props, not wires)
    }

    return { version: 1, placements, wires }
  }

  // Fallback: can't cleanly visualize
  const id = makeId('p')
  return {
    version: 1,
    placements: [{ id, kind: 'component', targetName: component.name, position: { x: 60, y: 120 } }],
    wires: [],
    hydrateNote: `Render tree kind "${render.kind}" cannot be cleanly visualized — showing component node only.`,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ChainDecomposition {
  /** The leaf entity reference name (e.g. "plex.list_recently_added"). */
  sourceRef: string
  /** Function applications from source to output (source-first order). */
  steps: Array<{ fnId: string; params?: Record<string, unknown> }>
}

/**
 * Try to decompose an ExprNode into a linear chain of: ref → apply → apply → ...
 *
 * Returns null if the expression doesn't fit the pattern cleanly.
 *
 * Handles:
 *   { kind: 'ref', name: 'entity.result' }  → sourceRef = 'entity', no steps
 *   { kind: 'apply', fn: 'std.limit', args: [upstream, {kind:'literal', value:5}] }
 */
function extractChain(expr: ExprNode): ChainDecomposition | null {
  const steps: Array<{ fnId: string; params?: Record<string, unknown> }> = []

  let current: ExprNode = expr
  // Walk back through apply nodes, collecting steps in reverse
  while (current.kind === 'apply') {
    const apply = current as { kind: 'apply'; fn: string; args: ExprNode[] }
    if (!apply.fn || !Array.isArray(apply.args) || apply.args.length === 0) return null

    // Collect literal params (args[1], args[2], ...) as config
    const params: Record<string, unknown> = {}
    for (let i = 1; i < apply.args.length; i++) {
      const arg = apply.args[i]
      if (arg.kind === 'literal') {
        params[`arg${i}`] = (arg as { kind: 'literal'; value: unknown }).value
      }
    }

    steps.unshift({ fnId: apply.fn, params: Object.keys(params).length > 0 ? params : undefined })
    current = apply.args[0]
  }

  // The head must be a ref
  if (current.kind !== 'ref') return null
  const refName = (current as { kind: 'ref'; name: string }).name

  // Strip trailing ".result" or ".fieldName" from the ref to get the entity name
  const sourceRef = refName.includes('.') ? refName.slice(0, refName.lastIndexOf('.')) : refName

  return { sourceRef, steps }
}

function fallbackEntity(entity: EntityDef, note: string): HydratedDocument {
  const id = makeId('p')
  return {
    version: 1,
    placements: [{ id, kind: 'entity', targetName: entity.name, position: { x: 60, y: 120 } }],
    wires: [],
    hydrateNote: note,
  }
}

let _counter = 0
function makeId(prefix: string): string {
  _counter++
  return `${prefix}-hydrate-${Date.now().toString(36)}-${_counter}`
}
