import type { CanvasDocument } from './document'
import type { LinkExpr } from './link-expr'
import { compileLinkExpr } from './link-expr'
import type { MaisieValue, MaisieRecord, TypeExpr } from '@maisie/shared'
import { evalExprAsync, type AddressResolver } from '@maisie/shared'

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
 */
export async function compilePreview(
  doc: CanvasDocument,
  resolvePlacementInput: (placementId: string) => Promise<MaisieValue | undefined>,
  resolvePlacementType: (placementId: string) => TypeExpr | undefined,
): Promise<PreviewTarget[]> {
  const targets: PreviewTarget[] = []

  for (const placement of doc.placements) {
    if (placement.kind !== 'component') continue

    const wire = doc.wires.find((w) => w.target.placementId === placement.id)

    let input: MaisieValue = null
    let source: PreviewTarget['source'] = 'none'
    let error: string | undefined

    if (wire) {
      const wired = await resolvePlacementInput(wire.source.placementId)
      if (wired !== undefined) {
        // Apply transform if present
        let transformed = wired
        if (wire.transform && wire.transform.kind !== 'identity') {
          try {
            transformed = await applyLinkTransform(wired, wire.transform)
          } catch (e) {
            error = `transform error: ${e instanceof Error ? e.message : String(e)}`
            transformed = wired
          }
        }
        input = transformed
        source = 'wired'
      } else {
        // Fall back to fixture
        const inputType = resolvePlacementType(placement.id)
        if (inputType) {
          const { generateFixture } = await import('./fixture-generator')
          input = generateFixture(inputType)
          source = 'fixture'
          error = 'wired source unresolved — showing fixture'
        }
      }
    } else {
      // Not wired — use fixture
      const inputType = resolvePlacementType(placement.id)
      if (inputType) {
        const { generateFixture } = await import('./fixture-generator')
        input = generateFixture(inputType)
        source = 'fixture'
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
