/**
 * ComponentRenderer — React wrapper for the component rendering engine.
 *
 * Accepts a ComponentDef (or component name) plus input data and props,
 * validates the input against the component contract, then delegates to the
 * rendering engine to produce React elements.
 *
 * Usage:
 *   <ComponentRenderer componentName="MovieTile" input={movie} />
 *   <ComponentRenderer component={def} input={movie} skipValidation />
 */

import React, { useEffect, useState } from 'react'
import type { ComponentDef, MaisieRecord, MaisieValue } from '@maisie/shared'
import { satisfies, inferType, formatErrors } from '@maisie/shared'
import { resolveComponent, ensureComponentsLoaded } from '../lib/components/resolver'
import { renderNode, renderLayout, type RenderContext } from '../lib/components/renderer'
import { renderBaseComponent } from '../lib/components/base-component-renderer'

interface Props {
  /** Component definition. If omitted, resolved from componentName. */
  component?: ComponentDef
  /** Resolve by name from the component registry. */
  componentName?: string
  /** Data to render. */
  input: MaisieValue
  /** Props passed to the component. */
  props?: MaisieRecord
  /** Skip input contract validation (useful during active editing). */
  skipValidation?: boolean
}

export function ComponentRenderer({
  component: providedComponent,
  componentName,
  input,
  props = {},
  skipValidation,
}: Props) {
  const [ready, setReady] = useState(false)
  const [component, setComponent] = useState<ComponentDef | undefined>(providedComponent)

  useEffect(() => {
    ensureComponentsLoaded().then(() => {
      if (!providedComponent && componentName) {
        setComponent(resolveComponent(componentName))
      }
      setReady(true)
    })
  }, [componentName, providedComponent])

  if (!ready) return <div className="render-loading">Loading…</div>
  if (!component) {
    return (
      <div className="render-error">
        Component not found: {componentName ?? 'unknown'}
      </div>
    )
  }

  // Validate input against the declared input contract
  if (!skipValidation && component.input) {
    const actual = inferType(input)
    const result = satisfies(actual, component.input)
    if (!result.ok) {
      return (
        <div className="render-error">
          <strong>Input does not match component contract:</strong>
          <pre>{formatErrors(result.errors)}</pre>
        </div>
      )
    }
  }

  const baseCtx: RenderContext = { env: {}, stack: [component.name] }

  // Base components: render directly via base-component-renderer
  if (component.kind === 'base') {
    return <>{renderBaseComponent(component, { value: input, ...props })}</>
  }

  // Layout primitives: render with input as children, props as layout args
  if (component.kind === 'layout') {
    return <>{renderLayout(component, { ...props, children: input }, baseCtx)}</>
  }

  // Derived: needs render tree
  if (!component.render) {
    return <div className="render-error">Derived component has no render tree</div>
  }

  const selfValue: MaisieRecord = {
    input: input as MaisieValue,
    props: props as unknown as MaisieValue,
    ...(typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as MaisieRecord)
      : {}),
  }

  const ctx: RenderContext = {
    env: { self: selfValue as MaisieValue },
    stack: [component.name],
  }

  return <>{renderNode(component.render, ctx)}</>
}
