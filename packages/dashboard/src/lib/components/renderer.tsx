/**
 * Component rendering engine.
 *
 * Walks an ExprNode render tree and produces React elements. Handles:
 *   - Base component nodes    → FieldRenderer via base-component-renderer
 *   - Layout primitive nodes  → React layout components (Stack, Row, etc.)
 *   - Derived component nodes → recurse with self binding
 *   - MEL expressions         → evaluate synchronously, then render result
 *   - Collections of nodes    → render each element as a React.Fragment
 */

import React, { type ReactNode } from 'react'
import type {
  ComponentDef,
  ExprNode,
  MaisieRecord,
  MaisieValue,
  ComponentCallNode,
  LayoutCallNode,
} from '@maisie/shared'
import { evalExpr } from '@maisie/shared'
import { Stack } from '../../components/layout/Stack'
import { Row } from '../../components/layout/Row'
import { Grid } from '../../components/layout/Grid'
import { Overlay } from '../../components/layout/Overlay'
import { Scroll } from '../../components/layout/Scroll'
import { CardContainer } from '../../components/layout/CardContainer'
import { Spacer } from '../../components/layout/Spacer'
import { resolveComponent } from './resolver'
import { renderBaseComponent } from './base-component-renderer'

// ── RenderContext ─────────────────────────────────────────────────────────────

export interface RenderContext {
  /** Variables in scope: self, loop vars, let bindings. */
  env: Record<string, MaisieValue>
  /** Component names currently in the render stack — for cycle detection. */
  stack: string[]
}

const MAX_RECURSION = 20

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Render an ExprNode or MaisieValue that represents a render tree (or part of one).
 */
export function renderNode(node: ExprNode | MaisieValue, ctx: RenderContext): ReactNode {
  if (ctx.stack.length > MAX_RECURSION) {
    return (
      <div className="render-error">
        Render cycle detected: {ctx.stack.join(' → ')}
      </div>
    )
  }

  if (isExprNode(node)) {
    switch (node.kind) {
      case 'component-call':
        return renderComponentCall(node as ComponentCallNode, ctx)
      case 'layout-call':
        return renderLayoutCall(node as LayoutCallNode, ctx)
      case 'literal':
        return node.value !== null && node.value !== undefined ? String(node.value) : null
      case 'ref':
      case 'apply':
      case 'pipe':
      case 'let':
      case 'lambda': {
        // Evaluate as data — the result may be a render node, a primitive, or a collection.
        try {
          const value = evalExpr(node, ctx.env, {})
          return renderValue(value, ctx)
        } catch (err) {
          return <div className="render-error">eval error: {String(err)}</div>
        }
      }
    }
  }

  return renderValue(node as MaisieValue, ctx)
}

// ── Value rendering ───────────────────────────────────────────────────────────

function renderValue(value: MaisieValue, ctx: RenderContext): ReactNode {
  // Render nodes passed through as values by evalExpr (the pass-through behavior):
  if (isRenderNode(value)) {
    return renderNode(value as unknown as ExprNode, ctx)
  }
  // Collection: render each element
  if (Array.isArray(value)) {
    return (value as MaisieValue[]).map((v, i) => (
      <React.Fragment key={i}>{renderValue(v, ctx)}</React.Fragment>
    ))
  }
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // Records and other objects — JSON fallback (unusual in well-formed render trees)
  return <code className="render-fallback">{JSON.stringify(value)}</code>
}

// ── Type guards ───────────────────────────────────────────────────────────────

const EXPR_NODE_KINDS = new Set([
  'literal', 'ref', 'apply', 'lambda', 'let', 'pipe', 'component-call', 'layout-call',
])

function isExprNode(v: unknown): v is ExprNode {
  return (
    typeof v === 'object' &&
    v !== null &&
    'kind' in v &&
    typeof (v as { kind: unknown }).kind === 'string' &&
    EXPR_NODE_KINDS.has((v as { kind: string }).kind)
  )
}

function isRenderNode(v: unknown): v is ComponentCallNode | LayoutCallNode {
  if (!isExprNode(v)) return false
  return v.kind === 'component-call' || v.kind === 'layout-call'
}

// ── Component call ────────────────────────────────────────────────────────────

function renderComponentCall(node: ComponentCallNode, ctx: RenderContext): ReactNode {
  const component = resolveComponent(node.name)
  if (!component) {
    return <div className="render-error">Unknown component: {node.name}</div>
  }

  // Evaluate args
  const resolvedArgs = evalArgs(node.args, ctx)

  switch (component.kind) {
    case 'base':
      return renderBaseComponent(component, resolvedArgs)

    case 'layout':
      return renderLayout(component, resolvedArgs, ctx)

    case 'derived':
      return renderDerived(component, resolvedArgs, ctx)
  }
}

// ── Layout call ───────────────────────────────────────────────────────────────

function renderLayoutCall(node: LayoutCallNode, ctx: RenderContext): ReactNode {
  const component = resolveComponent(node.name)
  if (!component || component.kind !== 'layout') {
    return <div className="render-error">Unknown layout: {node.name}</div>
  }
  const resolvedArgs = evalArgs(node.args, ctx)
  return renderLayout(component, resolvedArgs, ctx)
}

// ── Layout rendering ──────────────────────────────────────────────────────────

export function renderLayout(component: ComponentDef, args: MaisieRecord, ctx: RenderContext): ReactNode {
  const children = renderChildrenArg(args.children, ctx)

  switch (component.name) {
    case 'stack':
      return (
        <Stack
          gap={args.gap as number}
          padding={args.padding as number}
          align={args.align as any}
          fit={args.fit as any}
        >
          {children}
        </Stack>
      )
    case 'row':
      return (
        <Row
          gap={args.gap as number}
          padding={args.padding as number}
          align={args.align as any}
        >
          {children}
        </Row>
      )
    case 'grid':
      return (
        <Grid
          columns={args.columns as any}
          gap={args.gap as number}
          padding={args.padding as number}
        >
          {children}
        </Grid>
      )
    case 'overlay':
      return <Overlay>{children}</Overlay>
    case 'scroll':
      return (
        <Scroll
          direction={args.direction as any}
          gap={args.gap as number}
          padding={args.padding as number}
        >
          {children}
        </Scroll>
      )
    case 'card':
      return (
        <CardContainer title={args.title as string} padding={args.padding as number}>
          {children}
        </CardContainer>
      )
    case 'spacer':
      return <Spacer size={args.size as number} flex={args.flex as number} />
    default:
      return <div className="render-error">Unknown layout primitive: {component.name}</div>
  }
}

function renderChildrenArg(children: unknown, ctx: RenderContext): ReactNode {
  if (!children) return null
  if (Array.isArray(children)) {
    return (children as unknown[]).map((child, i) => (
      <React.Fragment key={i}>{renderNode(child as ExprNode, ctx)}</React.Fragment>
    ))
  }
  return renderNode(children as ExprNode, ctx)
}

// ── Derived component rendering ───────────────────────────────────────────────

function renderDerived(component: ComponentDef, args: MaisieRecord, ctx: RenderContext): ReactNode {
  if (!component.render) {
    return (
      <div className="render-error">
        Derived component "{component.name}" has no render tree
      </div>
    )
  }

  if (ctx.stack.includes(component.name)) {
    return (
      <div className="render-error">
        Render cycle: {[...ctx.stack, component.name].join(' → ')}
      </div>
    )
  }

  // Build self binding: flat args merged, with input/props accessible
  const input = args.input ?? args
  const props = extractProps(args, component)
  const selfValue: MaisieRecord = {
    input: input as MaisieValue,
    props: props as MaisieValue,
    ...(isPlainObject(input) ? (input as MaisieRecord) : {}),
  }

  const childCtx: RenderContext = {
    env: { ...ctx.env, self: selfValue as MaisieValue },
    stack: [...ctx.stack, component.name],
  }

  return renderNode(component.render, childCtx)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function evalArgs(
  argNodes: Record<string, ExprNode>,
  ctx: RenderContext,
): MaisieRecord {
  const resolved: MaisieRecord = {}
  for (const [argName, argNode] of Object.entries(argNodes)) {
    try {
      resolved[argName] = evalExpr(argNode, ctx.env, {})
    } catch {
      resolved[argName] = null
    }
  }
  return resolved
}

function extractProps(args: MaisieRecord, component: ComponentDef): MaisieRecord {
  const props: MaisieRecord = {}
  if (!component.props) return props
  for (const propName of Object.keys(component.props)) {
    if (propName in args) props[propName] = args[propName]
  }
  return props
}

function isPlainObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
