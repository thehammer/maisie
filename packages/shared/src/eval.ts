/**
 * Async expression evaluator for Maisie.
 *
 * This module provides `evalExprAsync`, an async version of `evalExpr` that
 * can resolve RefNode names through an `AddressResolver` — enabling expressions
 * that reference live entity data (plugin actions, derived entity fields).
 *
 * Lambda nodes produce MaisieFunctions that return `Promise<MaisieValue>` at
 * runtime. Callers using `await` handle this transparently.
 */

import {
  PRIMITIVES,
  type ExprNode,
  type ApplyNode,
  type FunctionDef,
  type MaisieFunction,
  type MaisieRecord,
  type MaisieValue,
} from './ops'
import { STD_LIB } from './std-lib'

// ── AddressResolver ───────────────────────────────────────────────────────────

/**
 * Resolves entity addresses to live values.
 *
 * Implemented by the agent runtime (Phase 2b). During Phase 1, tests can use
 * a mock resolver.
 */
export interface AddressResolver {
  /**
   * Resolve an address to a live value. May call plugin actions or evaluate
   * derived entity field expressions. Always async.
   *
   * @param address — dotted path like "home-assistant.list_switches"
   */
  resolve(address: string): Promise<MaisieValue>

  /**
   * Invoke a function at an address with named arguments.
   *
   * @param address — dotted path like "home-assistant.switch.front.toggle"
   * @param args — named arguments for the function
   */
  invoke(address: string, args: MaisieRecord): Promise<MaisieValue>
}

// ── evalExprAsync ─────────────────────────────────────────────────────────────

/**
 * Evaluate an ExprNode asynchronously.
 *
 * Unlike the sync `evalExpr`, this version resolves unbound `RefNode` names
 * through the `AddressResolver` — allowing expressions to reference live entity
 * data. All node types are supported including `LetNode` and `PipeNode`.
 *
 * @param node     — the expression tree to evaluate
 * @param resolver — resolves addresses to live values
 * @param env      — local variable bindings (lambda params, let bindings)
 * @param defs     — FunctionDef registry (defaults to STD_LIB)
 */
export async function evalExprAsync(
  node: ExprNode,
  resolver: AddressResolver,
  env: Record<string, MaisieValue> = {},
  defs: Record<string, FunctionDef> = STD_LIB,
): Promise<MaisieValue> {
  switch (node.kind) {
    case 'literal':
      return node.value

    case 'ref': {
      // Local env takes priority over the resolver.
      if (node.name in env) return env[node.name]
      // Dotted ref: if the root segment is in env (lambda param, let binding,
      // row-scope field), drill into it via field access. This handles cases
      // like `e.section` in `(e) => e.section == "x"` where `e` is the lambda
      // param and `section` is a field on the row record.
      const dot = node.name.indexOf('.')
      if (dot > 0) {
        const root = node.name.slice(0, dot)
        if (root in env) {
          let val: MaisieValue = env[root]
          const parts = node.name.slice(dot + 1).split('.')
          for (const part of parts) {
            if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
              val = (val as MaisieRecord)[part] ?? null
            } else {
              val = null
              break
            }
          }
          return val
        }
      }
      // Fall through: delegate to the resolver for entity addresses.
      return resolver.resolve(node.name)
    }

    case 'lambda': {
      // Capture env and resolver in a closure.
      // The returned function is synchronously typed (MaisieFunction) but
      // its body evaluation is async — callers must await the return value.
      const capturedEnv = { ...env }
      const fn: MaisieFunction = (args: MaisieRecord): MaisieValue => {
        const newEnv: Record<string, MaisieValue> = { ...capturedEnv }
        if (node.params.length === 1) {
          // Single-param convention: bind the whole args record to the param.
          // This allows `(sw) => sw.state == "on"` to receive an item record
          // and access it as `sw`, rather than looking up args["sw"].
          newEnv[node.params[0]] = args as MaisieValue
          // Row-scope: also expose the record's own fields as env vars
          // so `(__row) => name contains "x"` can resolve `name` from the row.
          if (args && typeof args === 'object' && !Array.isArray(args)) {
            for (const [k, v] of Object.entries(args)) {
              if (!(k in newEnv)) newEnv[k] = v
            }
          }
        } else {
          for (const param of node.params) {
            newEnv[param] = args[param] ?? null
          }
        }
        // Returns a Promise<MaisieValue> — compatible with MaisieValue since
        // MaisieValue includes MaisieRecord (and Promise is an object).
        // Callers using await handle this transparently.
        return evalExprAsync(node.body, resolver, newEnv, defs) as unknown as MaisieValue
      }
      return fn
    }

    case 'apply': {
      // Special-case async-incompatible primitives before evaluating args.
      // `reduce` calls the lambda repeatedly in a sync loop — we must handle
      // it here with proper awaiting.
      if (node.fn === 'reduce' && node.args.length === 3) {
        const coll = await evalExprAsync(node.args[0], resolver, env, defs) as MaisieRecord[]
        const reducer = await evalExprAsync(node.args[1], resolver, env, defs) as MaisieFunction
        let acc = await evalExprAsync(node.args[2], resolver, env, defs)
        for (const item of (coll ?? [])) {
          const result = reducer({ acc, item })
          acc = await (result as unknown as Promise<MaisieValue>)
        }
        return acc
      }

      // `call` invokes a MaisieFunction — must await if it returns a Promise.
      if (node.fn === 'call' && node.args.length === 2) {
        const fn = await evalExprAsync(node.args[0], resolver, env, defs) as MaisieFunction
        const argRecord = await evalExprAsync(node.args[1], resolver, env, defs) as MaisieRecord
        const result = fn(argRecord)
        return await (result as unknown as Promise<MaisieValue>)
      }

      // Evaluate all arguments first.
      const args = await Promise.all(node.args.map((a) => evalExprAsync(a, resolver, env, defs)))

      // Primitive?
      if (node.fn in PRIMITIVES) {
        const result = PRIMITIVES[node.fn](...args)
        // Primitives may return MaisieValue or a Promise — await either.
        return await Promise.resolve(result)
      }

      // FunctionDef (standard library or user-defined)?
      if (node.fn in defs) {
        const def = defs[node.fn]
        const newEnv: Record<string, MaisieValue> = {}
        for (let i = 0; i < def.params.length; i++) {
          newEnv[def.params[i]] = args[i] ?? null
        }
        return evalExprAsync(def.body, resolver, newEnv, defs)
      }

      throw new Error(`Unknown function: "${node.fn}"`)
    }

    case 'let': {
      // Evaluate each binding in order, extending the env.
      let letEnv = { ...env }
      for (const binding of node.bindings) {
        const val = await evalExprAsync(binding.value, resolver, letEnv, defs)
        letEnv = { ...letEnv, [binding.name]: val }
      }
      return evalExprAsync(node.body, resolver, letEnv, defs)
    }

    case 'component-call':
    case 'layout-call':
      throw new Error('Component nodes not evaluable here — use the component renderer')

    case 'pipe': {
      // Evaluate the initial value, then thread through each step.
      let current = await evalExprAsync(node.value, resolver, env, defs)

      for (const step of node.steps) {
        if (step.kind === 'apply') {
          // Prepend the piped value as the first argument via a temp env binding.
          const pipeEnv = { ...env, __pipe_value: current }
          const injectedStep: ApplyNode = {
            kind: 'apply',
            fn: step.fn,
            args: [{ kind: 'ref', name: '__pipe_value' }, ...step.args],
          }
          current = await evalExprAsync(injectedStep, resolver, pipeEnv, defs)
        } else {
          // Evaluate the step to get a function, then call it with the piped value.
          const fn = await evalExprAsync(step, resolver, env, defs) as MaisieFunction
          const result = fn({ __value: current })
          current = await (result as unknown as Promise<MaisieValue>)
        }
      }
      return current
    }
  }
}
