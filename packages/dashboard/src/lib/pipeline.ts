/**
 * Card rendering pipeline — applies a sequence of OpConfigs to a data payload.
 *
 * Sits between the API response and the renderer. Currently used by DynamicCard;
 * the card configurator will attach stored OpConfig[] to each card layout.
 *
 * Usage:
 *   const result = applyPipeline(rawData, ops)
 *   // result is the transformed MaisieCollection (or the original record/scalar if
 *   // no ops apply)
 */

import { compileOp } from "@maisie/shared";
import type { OpConfig, MaisieCollection, MaisieRecord, MaisieScalar } from "@maisie/shared";

export type PipelineInput = MaisieCollection | MaisieRecord | MaisieScalar | null | undefined;

/**
 * Apply a sequence of OpConfigs to collection data.
 * Non-collection payloads are passed through unchanged.
 */
export function applyPipeline(data: PipelineInput, ops: OpConfig[]): PipelineInput {
  if (!ops.length || !Array.isArray(data)) return data;

  let rows = data as MaisieCollection;
  for (const op of ops) {
    const compiled = compileOp(op);
    rows = compiled(rows);
  }
  return rows;
}
