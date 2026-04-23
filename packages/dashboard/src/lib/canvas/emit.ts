/**
 * Canvas composition → artifact emitter (Phase 3e).
 *
 * Pure functions — no I/O, no DOM. All functions are fully testable.
 * The save UI in Canvas.tsx calls these, then POSTs the result to the API.
 */

import type { CanvasDocument, Placement, Wire } from './document'
import type { ComponentDef, EntityDef, DataFieldDef, ViewDef, ChainStep } from '@maisie/shared'
import type { ExprNode, ComponentCallNode, LayoutCallNode, MaisieScalar } from '@maisie/shared'
import { STD_LIB } from '@maisie/shared'
import { compileLinkExpr } from './link-expr'

// ── Public interface ──────────────────────────────────────────────────────────

export interface EmitOptions {
  name: string
  description?: string
}

export interface EmitResult<T> {
  ok: boolean
  artifact?: T
  error?: string
}

// ── Root detection ────────────────────────────────────────────────────────────

/**
 * Find the "root" of a canvas composition — the placement with no outgoing wires
 * (nothing sends data from it to another placement). If there is exactly one such
 * placement it is the root. Anything else (0 or 2+) returns null.
 */
export function findRoot(doc: CanvasDocument): Placement | null {
  const hasOutgoing = new Set(doc.wires.map((w) => w.source.placementId))
  const roots = doc.placements.filter((p) => !hasOutgoing.has(p.id))
  if (roots.length === 1) return roots[0]
  return null
}

// ── Emit readiness checks ─────────────────────────────────────────────────────

/**
 * Check whether the canvas can be emitted as a component.
 * Requirements:
 *   - At least one placement
 *   - Exactly one root placement
 *   - Root is a component (not an entity)
 */
export function canEmitComponent(
  doc: CanvasDocument,
): { ok: true } | { ok: false; error: string } {
  if (doc.placements.length === 0) return { ok: false, error: 'canvas is empty' }
  const root = findRoot(doc)
  if (!root) {
    return {
      ok: false,
      error: 'canvas needs exactly one root (a placement with no outgoing wires)',
    }
  }
  if (root.kind !== 'component') {
    return {
      ok: false,
      error: 'root must be a component (not an entity) to emit as component',
    }
  }
  return { ok: true }
}

/**
 * Check whether the canvas can be emitted as an entity.
 * Requirements:
 *   - At least one placement
 *   - Exactly one root placement (any kind is fine)
 */
export function canEmitEntity(
  doc: CanvasDocument,
): { ok: true } | { ok: false; error: string } {
  if (doc.placements.length === 0) return { ok: false, error: 'canvas is empty' }
  const root = findRoot(doc)
  if (!root) {
    return { ok: false, error: 'canvas needs exactly one root' }
  }
  return { ok: true }
}

/**
 * Check whether the canvas can be emitted as a view.
 * Requirements:
 *   - Exactly one root placement that is a component
 *   - At least one entity placement that feeds (directly or through functions) into the root
 */
export function canEmitView(
  doc: CanvasDocument,
): { ok: true } | { ok: false; error: string } {
  if (doc.placements.length === 0) return { ok: false, error: 'canvas is empty' }
  const root = findRoot(doc)
  if (!root) {
    return { ok: false, error: 'canvas needs exactly one root (a placement with no outgoing wires)' }
  }
  if (root.kind !== 'component') {
    return { ok: false, error: 'root must be a component to emit as view' }
  }
  // There must be an entity placement reachable upstream of the root
  const entitySource = findEntitySource(doc, root)
  if (!entitySource) {
    return { ok: false, error: 'canvas must have an entity source connected to the component' }
  }
  return { ok: true }
}

// ── Component emission ────────────────────────────────────────────────────────

/**
 * Emit a ComponentDef from the canvas composition.
 *
 * Strategy:
 *   - Find the root (a component placement)
 *   - Walk the wire graph recursively, substituting upstream data into the
 *     component call's arguments
 *   - The emitted component is self-contained: all wired data is baked in as
 *     references; no external inputs required
 *
 * Future work: support "open" canvases with parameterized inputs (unwired ports).
 */
export function emitComponent(
  doc: CanvasDocument,
  options: EmitOptions,
  resolveComponentDef: (name: string) => ComponentDef | undefined,
): EmitResult<ComponentDef> {
  const check = canEmitComponent(doc)
  if (!check.ok) return { ok: false, error: check.error }

  const root = findRoot(doc)!

  try {
    const render = buildRenderTree(doc, root, resolveComponentDef)
    const artifact: ComponentDef = {
      name: options.name,
      kind: 'derived',
      description: options.description,
      render,
    }
    return { ok: true, artifact }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Entity emission ───────────────────────────────────────────────────────────

/**
 * Emit an EntityDef from the canvas composition.
 *
 * Strategy: the root placement's effective output is captured as a single
 * derived data field on the emitted entity.
 *   - Entity root → a RefNode to the entity's primary output (entity.result)
 *   - Component root → the render tree captured as data (uncommon but valid)
 */
export function emitEntity(
  doc: CanvasDocument,
  options: EmitOptions,
  resolveComponentDef: (name: string) => ComponentDef | undefined,
): EmitResult<EntityDef> {
  const check = canEmitEntity(doc)
  if (!check.ok) return { ok: false, error: check.error }

  const root = findRoot(doc)!

  try {
    const expression = buildDataExpression(doc, root, resolveComponentDef)
    const field: DataFieldDef = {
      kind: 'data',
      type: 'record',
      expression,
    }
    const artifact: EntityDef = {
      name: options.name,
      source: 'derived',
      description: options.description,
      fields: { result: field },
    }
    return { ok: true, artifact }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Internal tree builders ────────────────────────────────────────────────────

/**
 * Build the render ExprNode for a component placement by substituting upstream
 * data into the component call's arguments via incoming wires.
 */
function buildRenderTree(
  doc: CanvasDocument,
  placement: Placement,
  resolveComponentDef: (name: string) => ComponentDef | undefined,
): ExprNode {
  if (placement.kind !== 'component') {
    throw new Error(`expected component placement, got ${placement.kind}`)
  }

  const def = resolveComponentDef(placement.targetName)
  const isLayout = def?.kind === 'layout'

  // Collect wires whose target is this placement. The wire's target.slot
  // determines which arg name to use; defaults to 'input'.
  const incomingWires = doc.wires.filter((w) => w.target.placementId === placement.id)

  const args: Record<string, ExprNode> = {}
  for (const wire of incomingWires) {
    const slot = wire.target.slot ?? 'input'
    const sourcePlacement = doc.placements.find((p) => p.id === wire.source.placementId)
    if (!sourcePlacement) continue

    let sourceExpr: ExprNode = buildSourceExpression(doc, sourcePlacement, resolveComponentDef)

    // Apply the wire's transform if present and non-identity
    if (wire.transform && wire.transform.kind !== 'identity') {
      const lambda = compileLinkExpr(wire.transform)
      // Generate: call(transformLambda, source)
      // Collection mapping is handled at the caller level when needed;
      // in 3e we emit a direct call which the runtime interprets correctly.
      sourceExpr = {
        kind: 'apply',
        fn: 'call',
        args: [lambda, sourceExpr],
      }
    }

    args[slot] = sourceExpr
  }

  if (isLayout) {
    return {
      kind: 'layout-call',
      name: placement.targetName,
      args,
    } as LayoutCallNode
  }
  return {
    kind: 'component-call',
    name: placement.targetName,
    args,
  } as ComponentCallNode
}

/**
 * Build the source ExprNode for a placement that is feeding data into another
 * placement's wire.
 *
 *   - Entity placements → a RefNode to `{entityName}.result`
 *   - Function placements → an ApplyNode wrapping the upstream source expression
 *   - Component placements → recurse into that component's render tree
 */
function buildSourceExpression(
  doc: CanvasDocument,
  placement: Placement,
  resolveComponentDef: (name: string) => ComponentDef | undefined,
): ExprNode {
  if (placement.kind === 'entity') {
    // Ref to the entity's primary output field. By convention derived entities
    // expose their primary output as `.result`, and plugin entities wrap their
    // primary action similarly. The consuming component receives a data value.
    return { kind: 'ref', name: `${placement.targetName}.result` }
  }

  if (placement.kind === 'function') {
    // Find the wire feeding into this function placement
    const incomingWire = doc.wires.find((w) => w.target.placementId === placement.id)
    const upstreamPlacement = incomingWire
      ? doc.placements.find((p) => p.id === incomingWire.source.placementId)
      : undefined

    let upstreamExpr: ExprNode
    if (upstreamPlacement) {
      upstreamExpr = buildSourceExpression(doc, upstreamPlacement, resolveComponentDef)
      // Apply the incoming wire's transform if present
      if (incomingWire?.transform && incomingWire.transform.kind !== 'identity') {
        const lambda = compileLinkExpr(incomingWire.transform)
        upstreamExpr = { kind: 'apply', fn: 'call', args: [lambda, upstreamExpr] }
      }
    } else {
      // No upstream — produce a ref to a placeholder (incomplete canvas)
      upstreamExpr = { kind: 'literal', value: null }
    }

    // Build the function application: apply(fnId, upstream, ...inlineParams)
    // Inline param values come from placement.config
    const config = placement.config ?? {}
    // Look up the FunctionDef to know the param names and build positional args
    const fnId = placement.targetName
    const def = STD_LIB[fnId]
    if (!def) {
      // Unknown function — just pass through the upstream
      return upstreamExpr
    }

    const paramArgs: ExprNode[] = def.params.slice(1).map((paramName) => {
      const val = config[paramName]
      return {
        kind: 'literal',
        value: (val !== undefined ? val : null) as MaisieScalar,
      }
    })

    return {
      kind: 'apply',
      fn: fnId,
      args: [upstreamExpr, ...paramArgs],
    }
  }

  // Component-as-data-source: recurse into its render tree.
  return buildRenderTree(doc, placement, resolveComponentDef)
}

/**
 * Build a data-oriented ExprNode for an emitted entity's primary field.
 * Delegates to buildSourceExpression for entity/function roots and
 * buildRenderTree for component roots (captures the composed render as data).
 */
function buildDataExpression(
  doc: CanvasDocument,
  root: Placement,
  resolveComponentDef: (name: string) => ComponentDef | undefined,
): ExprNode {
  if (root.kind === 'entity' || root.kind === 'function') {
    return buildSourceExpression(doc, root, resolveComponentDef)
  }
  return buildRenderTree(doc, root, resolveComponentDef)
}

// ── View emission ─────────────────────────────────────────────────────────────

/**
 * Emit a ViewDef from the canvas composition.
 *
 * Strategy:
 *   - Root must be a component placement
 *   - Walk back through function placements to find the entity source
 *   - Collect each function placement as a ChainStep (in source→root order)
 *   - Emit a ViewDef capturing source, chain, and component
 */
export function emitView(
  doc: CanvasDocument,
  options: EmitOptions,
): EmitResult<ViewDef> {
  const check = canEmitView(doc)
  if (!check.ok) return { ok: false, error: check.error }

  const root = findRoot(doc)!
  const entitySource = findEntitySource(doc, root)!

  try {
    const chain = buildChainSteps(doc, root, entitySource)

    const artifact: ViewDef = {
      name: options.name,
      description: options.description,
      source: {
        entity: entitySource.targetName,
        field: 'result',
      },
      chain,
      component: root.targetName,
      componentProps: root.config && Object.keys(root.config).length > 0
        ? root.config
        : undefined,
    }
    return { ok: true, artifact }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Walk upstream from a component placement through function placements to find
 * the entity source placement. Returns null if no entity is reachable.
 */
function findEntitySource(doc: CanvasDocument, root: Placement): Placement | null {
  let current: Placement = root
  // Walk upstream following wires; limit depth to prevent infinite loops
  for (let depth = 0; depth < doc.placements.length + 1; depth++) {
    const incomingWire = doc.wires.find((w) => w.target.placementId === current.id)
    if (!incomingWire) return null

    const upstream = doc.placements.find((p) => p.id === incomingWire.source.placementId)
    if (!upstream) return null

    if (upstream.kind === 'entity') return upstream
    if (upstream.kind === 'function') {
      current = upstream
      continue
    }
    // Component feeding into another component — not a valid entity source path
    return null
  }
  return null
}

/**
 * Build the ordered list of ChainStep entries between the entity source and the
 * component root. Steps are in source → root order (first function applied first).
 *
 * Example: entity → fn1 → fn2 → component  →  [fn1, fn2]
 */
function buildChainSteps(
  doc: CanvasDocument,
  root: Placement,
  entitySource: Placement,
): ChainStep[] {
  // Walk back from root to entity, collecting function placements
  const reversed: Placement[] = []
  let current: Placement = root

  for (let depth = 0; depth < doc.placements.length + 1; depth++) {
    const incomingWire = doc.wires.find((w) => w.target.placementId === current.id)
    if (!incomingWire) break

    const upstream = doc.placements.find((p) => p.id === incomingWire.source.placementId)
    if (!upstream) break

    if (upstream.id === entitySource.id) break
    if (upstream.kind === 'function') {
      reversed.push(upstream)
      current = upstream
    } else {
      break
    }
  }

  // Reverse to get source → root order
  return reversed.reverse().map((p) => ({
    functionId: p.targetName,
    params: p.config && Object.keys(p.config).length > 0 ? p.config : undefined,
  }))
}
