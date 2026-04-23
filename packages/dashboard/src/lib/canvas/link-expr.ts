/**
 * Link expression DSL for wire transforms.
 *
 * A LinkExpr describes how to reshape a value at a wire boundary.
 * Stored as part of a Wire; compiled to an ExprNode lambda for evaluation.
 *
 * Each LinkExpr compiles to a lambda that takes one parameter (__row)
 * representing the source value and returns the reshaped value.
 *
 * Collections: callers are responsible for mapping the lambda over collection
 * elements. This module produces record-to-record transforms; the preview
 * compiler handles the collection wrapping.
 */

import type { ExprNode } from '@maisie/shared'

export type LinkExpr =
  | IdentityLink
  | PickLink
  | RenameLink
  | ComputeLink
  | ChainLink

/** Identity — passes the value through unchanged. */
export interface IdentityLink {
  kind: 'identity'
}

/** Pick — project to a subset of fields. Unmentioned fields are dropped. */
export interface PickLink {
  kind: 'pick'
  fields: string[]
}

/** Rename — map fields to new names. Unmentioned fields are dropped unless keepRest is true. */
export interface RenameLink {
  kind: 'rename'
  mappings: Array<{ from: string; to: string }>
  keepRest?: boolean
}

/** Compute — add or replace fields with literal values (full expressions deferred to 3e). */
export interface ComputeLink {
  kind: 'compute'
  assignments: Array<{ name: string; value: LiteralValue }>
  /** Whether to keep existing fields. Defaults to true. */
  keepRest?: boolean
}

export type LiteralValue = string | number | boolean | null

/** Chain — apply multiple links in order, left to right. */
export interface ChainLink {
  kind: 'chain'
  links: LinkExpr[]
}

// ── Compiler ──────────────────────────────────────────────────────────────────

/**
 * Compile a LinkExpr to an ExprNode lambda.
 * The lambda takes one parameter (__row) and returns the reshaped value.
 */
export function compileLinkExpr(link: LinkExpr): ExprNode {
  switch (link.kind) {
    case 'identity':
      return {
        kind: 'lambda',
        params: ['__row'],
        body: { kind: 'ref', name: '__row' },
      }

    case 'pick':
      return {
        kind: 'lambda',
        params: ['__row'],
        body: buildPickBody(link.fields, '__row'),
      }

    case 'rename':
      return {
        kind: 'lambda',
        params: ['__row'],
        body: buildRenameBody(link, '__row'),
      }

    case 'compute':
      return {
        kind: 'lambda',
        params: ['__row'],
        body: buildComputeBody(link, '__row'),
      }

    case 'chain': {
      if (link.links.length === 0) {
        // Empty chain is identity
        return {
          kind: 'lambda',
          params: ['__row'],
          body: { kind: 'ref', name: '__row' },
        }
      }
      // Compose left-to-right: first link runs first, its output feeds the next.
      // We fold by nesting calls: chain([A, B, C]) => x => C(B(A(x)))
      const compiled = link.links.map(compileLinkExpr)
      return {
        kind: 'lambda',
        params: ['__row'],
        body: compiled.reduce<ExprNode>(
          (acc, innerLambda) => ({
            kind: 'apply',
            fn: 'call',
            args: [
              innerLambda,
              // The result of the previous transform becomes __row for the next
              acc,
            ],
          }),
          { kind: 'ref', name: '__row' },
        ),
      }
    }
  }
}

// ── Body builders ─────────────────────────────────────────────────────────────

/**
 * Build a record that contains only the named fields from rowRef.
 * Uses chained set() calls starting from an empty-record base.
 */
function buildPickBody(fields: string[], rowRef: string): ExprNode {
  let current: ExprNode = { kind: 'apply', fn: 'empty-record', args: [] }
  for (const f of fields) {
    current = {
      kind: 'apply',
      fn: 'set',
      args: [
        current,
        { kind: 'literal', value: f },
        { kind: 'apply', fn: 'get', args: [{ kind: 'ref', name: rowRef }, { kind: 'literal', value: f }] },
      ],
    }
  }
  return current
}

/**
 * Build the body for a rename transform.
 * Starts with the full row (if keepRest) or empty record, then adds renamed fields.
 */
function buildRenameBody(link: RenameLink, rowRef: string): ExprNode {
  const base: ExprNode = link.keepRest
    ? { kind: 'ref', name: rowRef }
    : { kind: 'apply', fn: 'empty-record', args: [] }

  return link.mappings.reduce<ExprNode>((acc, { from, to }) => ({
    kind: 'apply',
    fn: 'set',
    args: [
      acc,
      { kind: 'literal', value: to },
      {
        kind: 'apply',
        fn: 'get',
        args: [{ kind: 'ref', name: rowRef }, { kind: 'literal', value: from }],
      },
    ],
  }), base)
}

/**
 * Build the body for a compute transform.
 * Starts with the full row (if keepRest, default true) or empty record, then
 * adds/replaces each assigned field with its literal value.
 */
function buildComputeBody(link: ComputeLink, rowRef: string): ExprNode {
  const keepRest = link.keepRest ?? true
  const base: ExprNode = keepRest
    ? { kind: 'ref', name: rowRef }
    : { kind: 'apply', fn: 'empty-record', args: [] }

  return link.assignments.reduce<ExprNode>((acc, { name, value }) => ({
    kind: 'apply',
    fn: 'set',
    args: [
      acc,
      { kind: 'literal', value: name },
      { kind: 'literal', value },
    ],
  }), base)
}
