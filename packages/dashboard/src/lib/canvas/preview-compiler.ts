import type { CanvasDocument } from './document'
import type { MaisieValue, TypeExpr } from '@maisie/shared'

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
        input = wired
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
