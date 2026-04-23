import type { CanvasDocument, Placement } from './document'
import type { LinkExpr } from './link-expr'
import { compileLinkExpr } from './link-expr'
import type { MaisieValue, MaisieRecord, TypeExpr } from '@maisie/shared'
import { evalExprAsync, STD_LIB, type AddressResolver } from '@maisie/shared'

export interface PreviewTarget {
  placementId: string
  componentName: string
  input: MaisieValue
  props?: Record<string, MaisieValue>
  /** Source of the input data: 'wired' = from a connected entity, 'fixture' = synthesized. */
  source: 'wired' | 'fixture' | 'none'
  /** Error message if the component can't be previewed. */
  error?: string
}

/**
 * Scan the canvas document, find placements that are components (or layouts
 * that have children wired), and produce preview targets. Placements without
 * a contract or with incompatible wiring get fixture data based on their
 * declared input type.
 *
 * Function placements act as transparent transform nodes in the chain:
 *   entity → fn1 → fn2 → component
 * Each function is applied in order to the upstream value.
 */
export async function compilePreview(
  doc: CanvasDocument,
  resolvePlacementInput: (placementId: string) => Promise<MaisieValue | undefined>,
  resolvePlacementType: (placementId: string) => TypeExpr | undefined,
): Promise<PreviewTarget[]> {
  const targets: PreviewTarget[] = []

  for (const placement of doc.placements) {
    if (placement.kind !== 'component') continue

    let input: MaisieValue = null
    let source: PreviewTarget['source'] = 'none'
    let error: string | undefined

    // Resolve the value arriving at this component, following the wire chain
    // (which may pass through function placements).
    const resolved = await resolveValueForPlacement(doc, placement, resolvePlacementInput)

    if (resolved.found) {
      input = resolved.value
      source = 'wired'
      if (resolved.error) error = resolved.error
    } else {
      // Fall back to fixture
      const inputType = resolvePlacementType(placement.id)
      if (inputType) {
        const { generateFixture } = await import('./fixture-generator')
        input = generateFixture(inputType)
        source = resolved.hadWire ? 'fixture' : 'fixture'
        if (resolved.hadWire) error = 'wired source unresolved — showing fixture'
      }
    }

    targets.push({
      placementId: placement.id,
      componentName: placement.targetName,
      input,
      source,
      error,
    })
  }

  return targets
}

/**
 * Walk the wire chain backwards from a given placement to resolve the effective
 * value at its input port. Follows function placements as transform nodes.
 *
 * Returns:
 *   { found: true, value, error? } — value successfully resolved (possibly through fns)
 *   { found: false, hadWire }      — no value resolved; hadWire=true means there is a
 *                                    wire but the source couldn't be resolved
 */
async function resolveValueForPlacement(
  doc: CanvasDocument,
  placement: Placement,
  resolvePlacementInput: (placementId: string) => Promise<MaisieValue | undefined>,
): Promise<{ found: true; value: MaisieValue; error?: string } | { found: false; hadWire: boolean }> {
  const wire = doc.wires.find((w) => w.target.placementId === placement.id)
  if (!wire) return { found: false, hadWire: false }

  const sourcePlacement = doc.placements.find((p) => p.id === wire.source.placementId)
  if (!sourcePlacement) return { found: false, hadWire: true }

  // If the source is a function placement, recursively resolve its input first,
  // then apply the function.
  if (sourcePlacement.kind === 'function') {
    const upstream = await resolveValueForPlacement(doc, sourcePlacement, resolvePlacementInput)
    if (!upstream.found) return { found: false, hadWire: true }

    try {
      const transformed = await applyFunctionPlacement(upstream.value, sourcePlacement)
      // Apply link transform on the wire too (rare for fn→component wires, but supported)
      let result = transformed
      if (wire.transform && wire.transform.kind !== 'identity') {
        result = await applyLinkTransform(result, wire.transform)
      }
      return { found: true, value: result, error: upstream.error }
    } catch (e) {
      return {
        found: true,
        value: upstream.value,
        error: `function error: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }

  // Source is an entity or component placement — resolve its raw output
  const rawValue = await resolvePlacementInput(wire.source.placementId)
  if (rawValue === undefined) return { found: false, hadWire: true }

  // Apply the wire's link transform if present
  let result = rawValue
  let transformError: string | undefined
  if (wire.transform && wire.transform.kind !== 'identity') {
    try {
      result = await applyLinkTransform(result, wire.transform)
    } catch (e) {
      transformError = `transform error: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  return { found: true, value: result, error: transformError }
}

// ── Function placement evaluation ─────────────────────────────────────────────

/**
 * Apply a function placement (std lib function) to a value.
 * The function's inline params come from placement.config.
 *
 * Builds an ApplyNode that references each param by name, then evaluates it
 * with an env that pre-binds the input value and all inline params.
 */
async function applyFunctionPlacement(
  value: MaisieValue,
  placement: Placement,
): Promise<MaisieValue> {
  const fnId = placement.targetName
  const def = STD_LIB[fnId]
  if (!def) throw new Error(`Unknown std function: "${fnId}"`)

  const config = placement.config ?? {}

  // Build env: first param = the input value; remaining params = inline config values
  const env: Record<string, MaisieValue> = {}
  env[def.params[0]] = value
  for (let i = 1; i < def.params.length; i++) {
    const paramName = def.params[i]
    const configVal = config[paramName]
    env[paramName] = configVal !== undefined ? (configVal as MaisieValue) : null
  }

  // Build: apply(fnId, ref(param0), ref(param1), ...) evaluated against env
  const refExpr = {
    kind: 'apply' as const,
    fn: fnId,
    args: def.params.map((p) => ({ kind: 'ref' as const, name: p })),
  }

  const NOOP_RESOLVER: AddressResolver = {
    resolve: (addr) => Promise.reject(new Error(`unexpected address in fn eval: ${addr}`)),
    invoke: (addr) => Promise.reject(new Error(`unexpected invoke in fn eval: ${addr}`)),
  }

  return await evalExprAsync(refExpr, NOOP_RESOLVER, env, STD_LIB)
}

// ── Transform application ─────────────────────────────────────────────────────

/**
 * A minimal resolver for transform evaluation. Transforms only reference
 * local bindings (__row), so the resolver should never be called. It throws
 * if an address escapes, which would indicate a bug in compileLinkExpr.
 */
const TRANSFORM_RESOLVER: AddressResolver = {
  resolve: (address) => Promise.reject(new Error(`unexpected address in transform: ${address}`)),
  invoke: (address) => Promise.reject(new Error(`unexpected invoke in transform: ${address}`)),
}

/**
 * Apply a LinkExpr to a value.
 *
 * If the value is a collection, maps the transform over each element.
 * If the value is a record, applies the transform directly.
 * If the value is a scalar or null, returns it unchanged.
 */
async function applyLinkTransform(value: MaisieValue, link: LinkExpr): Promise<MaisieValue> {
  const lambdaExpr = compileLinkExpr(link)

  // Evaluate the lambda expression to get the transform function
  const fn = await evalExprAsync(lambdaExpr, TRANSFORM_RESOLVER) as (args: MaisieRecord) => MaisieValue | Promise<MaisieValue>

  if (Array.isArray(value)) {
    const results = await Promise.all(
      value.map(async (row) => {
        const result = fn(row as MaisieRecord)
        return await Promise.resolve(result)
      }),
    )
    return results as MaisieValue
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const result = fn(value as MaisieRecord)
    return await Promise.resolve(result)
  }

  // Scalars and null pass through unchanged
  return value
}
