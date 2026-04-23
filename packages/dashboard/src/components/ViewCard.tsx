/**
 * ViewCard — renders a named View on the dashboard.
 *
 * A View bundles an entity source, optional function chain, and a component.
 * ViewCard resolves all three at render time:
 *   1. Fetch the ViewDef from /api/views/:name
 *   2. Fetch the source entity field from /api/entities/:entity/:field
 *   3. POST each chain step to /api/eval in sequence
 *   4. Render the result via ComponentRenderer with the view's component + props
 *
 * Used when a CardConfig has a `view` field set.
 */

import { useEffect, useState } from "react";
import { ComponentRenderer } from "./ComponentRenderer";
import type { MaisieValue, MaisieRecord } from "@maisie/shared";

// Mirrors ViewDef + ChainStep from @maisie/shared (no dep on plugin-core from dashboard)
interface ChainStep {
  functionId: string;
  params?: Record<string, unknown>;
}

interface ViewDef {
  name: string;
  description?: string;
  source: { entity: string; field?: string };
  chain: ChainStep[];
  component: string;
  componentProps?: Record<string, unknown>;
}

interface ViewCardProps {
  viewName: string;
  titleOverride?: string;
}

export function ViewCard({ viewName, titleOverride }: ViewCardProps) {
  const [view, setView] = useState<ViewDef | null>(null);
  const [data, setData] = useState<MaisieValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      setLoading(true);
      setError(null);

      try {
        // Step 1: fetch the ViewDef
        const viewRes = await fetch(`/api/views/${encodeURIComponent(viewName)}`);
        if (!viewRes.ok) {
          setError(`View "${viewName}" not found`);
          return;
        }
        const viewDef = await viewRes.json() as ViewDef;
        if (cancelled) return;
        setView(viewDef);

        // Step 2: fetch the source entity field
        const field = viewDef.source.field ?? "result";
        const entityRes = await fetch(
          `/api/entities/${encodeURIComponent(viewDef.source.entity)}/${encodeURIComponent(field)}`,
        );
        if (!entityRes.ok) {
          setError(`Could not fetch entity "${viewDef.source.entity}.${field}"`);
          return;
        }
        const entityBody = await entityRes.json() as unknown;
        // Entity field values are wrapped in { value: ... }
        let value: MaisieValue =
          entityBody !== null && typeof entityBody === "object" && "value" in (entityBody as object)
            ? (entityBody as { value: MaisieValue }).value
            : (entityBody as MaisieValue);

        if (cancelled) return;

        // Step 3: apply each chain step via /api/eval
        for (const step of viewDef.chain) {
          const paramEntries = Object.entries(step.params ?? {});
          // Build an apply expression: apply(functionId, value, ...params)
          const paramLiterals = paramEntries.map(([, v]) => ({ kind: "literal" as const, value: v as import("@maisie/shared").MaisieScalar }));
          const expr = {
            kind: "apply" as const,
            fn: step.functionId,
            args: [
              { kind: "literal" as const, value: value as import("@maisie/shared").MaisieScalar },
              ...paramLiterals,
            ],
          };

          const evalRes = await fetch("/api/eval", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expr }),
          });
          if (!evalRes.ok) {
            setError(`Chain step "${step.functionId}" failed`);
            return;
          }
          const evalBody = await evalRes.json() as { result?: MaisieValue; error?: string };
          if (evalBody.error) {
            setError(`Chain step "${step.functionId}" error: ${evalBody.error}`);
            return;
          }
          value = evalBody.result ?? value;
          if (cancelled) return;
        }

        setData(value);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void resolve();
    return () => { cancelled = true; };
  }, [viewName]);

  const title = titleOverride ?? view?.name ?? viewName;

  return (
    <div className="resource-card">
      <h3 className="card-title">{title}</h3>
      {loading && <div className="resource-loading">Loading…</div>}
      {error && <div className="resource-error">{error}</div>}
      {!loading && !error && data !== null && view && (
        <ComponentRenderer
          componentName={view.component}
          input={data}
          props={(view.componentProps ?? {}) as MaisieRecord}
        />
      )}
    </div>
  );
}
