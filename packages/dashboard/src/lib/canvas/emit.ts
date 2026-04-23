/**
 * Canvas composition → artifact emitter (Phase 3e).
 *
 * Pure functions — no I/O, no DOM. All functions are fully testable.
 * The save UI in Canvas.tsx calls these, then POSTs the result to the API.
 */

import type { CanvasDocument, Placement, Wire } from './document'
import type { ComponentDef, EntityDef, DataFieldDef } from '@maisie/shared'
import type { ExprNode, ComponentCallNode, LayoutCallNode } from '@maisie/shared'
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
  // Component-as-data-source: recurse into its render tree.
  return buildRenderTree(doc, placement, resolveComponentDef)
}

/**
 * Build a data-oriented ExprNode for an emitted entity's primary field.
 * Delegates to buildSourceExpression for entity roots (simple ref) and
 * buildRenderTree for component roots (captures the composed render as data).
 */
function buildDataExpression(
  doc: CanvasDocument,
  root: Placement,
  resolveComponentDef: (name: string) => ComponentDef | undefined,
): ExprNode {
  if (root.kind === 'entity') {
    return buildSourceExpression(doc, root, resolveComponentDef)
  }
  return buildRenderTree(doc, root, resolveComponentDef)
}
