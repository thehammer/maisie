import { useEffect, useState } from 'react'
import type { CanvasDocument } from '../../lib/canvas/document'
import type { MaisieValue, TypeExpr } from '@maisie/shared'
import { compilePreview, type PreviewTarget } from '../../lib/canvas/preview-compiler'
import { ComponentRenderer } from '../ComponentRenderer'

interface PreviewProps {
  doc: CanvasDocument
  /** Fetches the actual output of a placement (e.g., via /api/entities). */
  resolveInput: (placementId: string) => Promise<MaisieValue | undefined>
  /** Returns the declared input TypeExpr for a placement. */
  resolveInputType: (placementId: string) => TypeExpr | undefined
}

export function Preview({ doc, resolveInput, resolveInputType }: PreviewProps) {
  const [targets, setTargets] = useState<PreviewTarget[]>([])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      const compiled = await compilePreview(doc, resolveInput, resolveInputType)
      if (!cancelled) setTargets(compiled)
    }, 250)  // debounce
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [doc, resolveInput, resolveInputType])

  if (targets.length === 0) {
    return (
      <div className="canvas-preview-empty">
        Drop a component on the canvas to see it rendered here.
      </div>
    )
  }

  return (
    <div className="canvas-preview">
      {targets.map((target) => (
        <div key={target.placementId} className="canvas-preview-target">
          <div className="canvas-preview-header">
            <span className="canvas-preview-name">{target.componentName}</span>
            <span className={`canvas-preview-badge canvas-preview-badge-${target.source}`}>
              {target.source === 'wired' ? 'live' : target.source === 'fixture' ? 'fixture' : 'no data'}
            </span>
          </div>
          {target.error && <div className="canvas-preview-note">{target.error}</div>}
          <div className="canvas-preview-body">
            <ComponentRenderer
              componentName={target.componentName}
              input={target.input}
              skipValidation={true}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
