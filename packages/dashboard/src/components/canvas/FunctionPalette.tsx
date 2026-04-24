/**
 * FunctionPalette — collapsible dock listing all std lib functions.
 *
 * When `highlightInputTarget` is provided (entity output or component input),
 * functions are evaluated on their input port: does the candidate accept data
 * of that type? When `highlightOutputTarget` is provided (component input),
 * functions are evaluated on their output port: does the function produce data
 * that satisfies that type?
 *
 * The displayed status is the better of the two sides:
 *   compatible > chain > incompatible > unknown
 */

import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { STD_FUNCTION_DESCRIPTORS } from '@maisie/shared'
import type { FunctionDescriptor } from '@maisie/shared'
import {
  classifyCompatibility,
  sortByCompatibility,
} from '../../lib/canvas/palette-sort'
import type { CompatibilityStatus } from '../../lib/canvas/palette-sort'
import type { TypeExpr } from '@maisie/shared'

interface FunctionPaletteProps {
  /**
   * Evaluate each function's INPUT port against this type.
   * Set when an entity is selected (entity output → function input).
   */
  highlightInputTarget?: TypeExpr
  /**
   * Evaluate each function's OUTPUT port against this type.
   * Set when a component is selected (function output → component input).
   */
  highlightOutputTarget?: TypeExpr
  /**
   * Called when an item is right-clicked. Receives kind, name, and client-space position.
   */
  onItemContextMenu?: (kind: 'function', name: string, position: { x: number; y: number }) => void
}

const STATUS_RANK: Record<CompatibilityStatus, number> = {
  compatible: 0,
  chain: 1,
  incompatible: 2,
  unknown: 3,
}

function betterStatus(a: CompatibilityStatus, b: CompatibilityStatus): CompatibilityStatus {
  return STATUS_RANK[a] <= STATUS_RANK[b] ? a : b
}

export function FunctionPalette({ highlightInputTarget, highlightOutputTarget, onItemContextMenu }: FunctionPaletteProps) {
  const [collapsed, setCollapsed] = useState(false)

  const hasHighlight = !!(highlightInputTarget ?? highlightOutputTarget)

  const annotated = STD_FUNCTION_DESCRIPTORS.map((fn) => {
    let status: CompatibilityStatus = 'unknown'
    if (hasHighlight) {
      const inputStatus = highlightInputTarget
        ? classifyCompatibility(highlightInputTarget, fn.input)
        : 'unknown'
      const outputStatus = highlightOutputTarget
        ? classifyCompatibility(fn.output, highlightOutputTarget)
        : 'unknown'
      // When only one side is active, use that side's status.
      // When both are active, use the better of the two.
      if (highlightInputTarget && highlightOutputTarget) {
        status = betterStatus(inputStatus, outputStatus)
      } else if (highlightInputTarget) {
        status = inputStatus
      } else {
        status = outputStatus
      }
    }
    return { ...fn, compatibilityStatus: status }
  })

  const sorted = hasHighlight ? sortByCompatibility(annotated) : annotated

  return (
    <div className={`canvas-function-dock ${collapsed ? 'collapsed' : ''}`}>
      <div className="canvas-function-dock-header">
        <span className="canvas-function-dock-title">Functions</span>
        <button
          className="canvas-function-dock-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand functions' : 'Collapse functions'}
        >
          {collapsed ? '+' : '-'}
        </button>
      </div>
      {!collapsed && (
        <div className="canvas-function-dock-items">
          {sorted.map((fn) => (
            <FunctionPaletteItem
              key={fn.id}
              fn={fn}
              compatibilityStatus={hasHighlight ? fn.compatibilityStatus : undefined}
              onContextMenu={onItemContextMenu ? (pos) => onItemContextMenu('function', fn.id, pos) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Item ──────────────────────────────────────────────────────────────────────

interface FunctionPaletteItemProps {
  fn: FunctionDescriptor
  compatibilityStatus?: CompatibilityStatus
  onContextMenu?: (position: { x: number; y: number }) => void
}

function FunctionPaletteItem({ fn, compatibilityStatus, onContextMenu }: FunctionPaletteItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `function:${fn.id}`,
    data: { kind: 'function', targetName: fn.id, source: 'palette' },
  })

  const compatClass = compatibilityStatus
    ? `canvas-palette-item-compat-${compatibilityStatus}`
    : ''

  return (
    <div
      ref={setNodeRef}
      className={`canvas-palette-item canvas-palette-item-function ${compatClass} ${isDragging ? 'dragging' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu?.({ x: e.clientX, y: e.clientY })
      }}
      {...attributes}
      {...listeners}
    >
      <div className="canvas-palette-item-label">{fn.name}</div>
      {fn.description && (
        <div className="canvas-palette-item-sub">{fn.description}</div>
      )}
      {compatibilityStatus && (
        <CompatBadge status={compatibilityStatus} />
      )}
    </div>
  )
}

// ── Compatibility badge ────────────────────────────────────────────────────────

function CompatBadge({ status }: { status: CompatibilityStatus }) {
  const labels: Record<CompatibilityStatus, string> = {
    compatible: 'direct',
    chain: 'via fn',
    incompatible: 'no match',
    unknown: '?',
  }
  return (
    <span className={`canvas-compat-badge canvas-compat-badge-${status}`}>
      {labels[status]}
    </span>
  )
}
