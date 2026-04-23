/**
 * Base component renderer.
 *
 * Maps each base component name to a React element via FieldRenderer.
 * Args from the render tree become the RendererConfig for the renderer.
 */

import React from 'react'
import type { ComponentDef, MaisieRecord, MaisieValue, RendererConfig } from '@maisie/shared'
import { FieldRenderer } from '../renderers/FieldRenderer'

export function renderBaseComponent(component: ComponentDef, args: MaisieRecord): React.ReactNode {
  // Convention: base components receive their value via args. Prefer `value`,
  // then `src`, then `input`, then the first arg present.
  const value = args.value ?? args.src ?? args.input ?? pickFirst(args)
  const config = buildRendererConfig(component.name, args)
  return <FieldRenderer value={value as MaisieValue} config={config} />
}

function pickFirst(args: MaisieRecord): MaisieValue | undefined {
  const keys = Object.keys(args)
  return keys.length > 0 ? args[keys[0]] : undefined
}

function buildRendererConfig(componentName: string, args: MaisieRecord): RendererConfig {
  switch (componentName) {
    case 'text':
      return { type: 'string', maxLength: args.maxLength as number, code: args.code as boolean }
    case 'number':
      return { type: 'number', decimals: args.decimals as number, prefix: args.prefix as string, suffix: args.suffix as string }
    case 'boolean':
      return { type: 'boolean', trueLabel: args.trueLabel as string, falseLabel: args.falseLabel as string }
    case 'bytes':
      return { type: 'bytes', unit: args.unit as any }
    case 'percentage':
      return { type: 'percentage', style: args.style as any, warnAt: args.warnAt as number, critAt: args.critAt as number }
    case 'status':
      return { type: 'status', colorMap: args.colorMap as any }
    case 'image':
      return { type: 'image', aspectRatio: args.aspectRatio as string, fit: args.fit as any }
    case 'timestamp':
      return { type: 'timestamp', format: args.format as any }
    case 'duration':
      return { type: 'duration', style: args.style as any }
    case 'temperature':
      return { type: 'temperature', unit: args.unit as any, warnAt: args.warnAt as number, critAt: args.critAt as number }
    case 'signal':
      return { type: 'signal', bars: args.bars as number }
    case 'gauge':
      return { type: 'gauge', warnAt: args.warnAt as number, critAt: args.critAt as number, label: args.label as string }
    case 'progress':
      return { type: 'progress', showFraction: args.showFraction as boolean, showLabel: args.showLabel as boolean }
    case 'url':
      return { type: 'url', label: args.label as string, newTab: args.newTab as boolean }
    case 'toggle':
      return { type: 'toggle', writeEndpoint: args.writeEndpoint as string, payloadField: args.payloadField as string }
    case 'button':
      return { type: 'action', label: args.label as string, confirm: args.confirm as boolean, writeEndpoint: args.writeEndpoint as string }
    case 'json':
      return { type: 'json', expanded: args.expanded as boolean }
    default:
      return { type: 'string' }
  }
}
