/**
 * DefaultTile — built-in component that auto-renders any input shape.
 *
 * Priority:
 *   1. Image field + title field → image card with title + badge
 *   2. Title/name field + status → label + status badge
 *   3. Fallback: label-value list for all fields
 *
 * Never throws on unknown shapes — always renders something useful.
 */

import React from 'react'
import type { MaisieValue } from '@maisie/shared'

type MaisieRecord = Record<string, MaisieValue>

export function DefaultTile({ input }: { input: MaisieValue }): React.ReactNode {
  if (input === null || input === undefined) {
    return <span className="resource-null">—</span>
  }

  // Scalar value — render as text
  if (typeof input !== 'object' || Array.isArray(input)) {
    return <span className="default-tile-scalar">{String(input)}</span>
  }

  const record = input as MaisieRecord
  const fields = Object.entries(record)

  // Find an image field
  const imageEntry = fields.find(
    ([k, v]) =>
      typeof v === 'string' &&
      (v as string).startsWith('http') &&
      /coverUrl|thumbnail|image|poster|art|thumb|url/i.test(k),
  )

  // Find a title field
  const titleEntry = fields.find(
    ([k, v]) => typeof v === 'string' && /^(title|name|label|heading)$/i.test(k),
  )

  // Find a status field
  const statusEntry = fields.find(
    ([k, v]) => typeof v === 'string' && /^(status|state|type|kind)$/i.test(k),
  )

  // Find a percentage/progress field
  const percentEntry = fields.find(
    ([k, v]) =>
      typeof v === 'number' &&
      (v as number) >= 0 &&
      (v as number) <= 100 &&
      /percent|progress|level|usage|completion/i.test(k),
  )

  // Image-first layout
  if (imageEntry) {
    return (
      <div className="default-tile">
        <img
          src={imageEntry[1] as string}
          className="default-tile-image"
          alt=""
          loading="lazy"
        />
        {titleEntry && (
          <div className="default-tile-title">{titleEntry[1] as string}</div>
        )}
        <div className="default-tile-footer">
          {statusEntry && (
            <span className="default-tile-badge">{statusEntry[1] as string}</span>
          )}
          {percentEntry && (
            <span className="default-tile-percent">
              {Math.round(percentEntry[1] as number)}%
            </span>
          )}
        </div>
      </div>
    )
  }

  // Title + metadata layout (no image)
  if (titleEntry) {
    return (
      <div className="default-tile default-tile-text">
        <div className="default-tile-title">{titleEntry[1] as string}</div>
        {statusEntry && (
          <span className="default-tile-badge">{statusEntry[1] as string}</span>
        )}
        {percentEntry && (
          <div className="default-tile-progress-bar">
            <div
              className="default-tile-progress-fill"
              style={{ width: `${Math.round(percentEntry[1] as number)}%` }}
            />
          </div>
        )}
      </div>
    )
  }

  // Fallback: label-value list for all primitive fields
  const primitiveFields = fields.filter(
    ([, v]) => v === null || typeof v !== 'object' || Array.isArray(v),
  )
  return (
    <div className="default-tile-fields">
      {primitiveFields.map(([k, v]) => (
        <div key={k} className="default-tile-field">
          <span className="default-tile-label">
            {k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')}
          </span>
          <span className="default-tile-value">
            {Array.isArray(v)
              ? `[${(v as unknown[]).length} items]`
              : String(v ?? '')}
          </span>
        </div>
      ))}
    </div>
  )
}
