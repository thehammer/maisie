import { useEffect, useState } from "react";

interface ViewSource {
  entity: string;
  field: string;
  endpoint: string;
}

interface ViewDef {
  name: string;
  description: string;
  source: ViewSource;
  chain: unknown[];
  component: string;
  componentProps: Record<string, unknown>;
}

interface ServiceChip {
  name: string;
  status: "connected" | "error" | "unconfigured";
  detail?: string;
}

interface Props {
  viewName: string;
  titleOverride?: string;
}

// ── Base component renderers ─────────────────────────────────────────────────

/** Renders an array of service status chips (connected / error / unconfigured) */
function ServiceChipsRenderer({ data }: { data: unknown }) {
  const items = Array.isArray(data) ? (data as ServiceChip[]) : [];
  return (
    <div className="service-chips">
      {items.map((s) => (
        <div key={s.name} className="service-chip">
          <div
            className={`status-dot ${
              s.status === "connected"
                ? ""
                : s.status === "error"
                  ? "down"
                  : "degraded"
            }`}
          />
          <span className="service-chip-name">{s.name}</span>
          {s.detail && (
            <span className="service-chip-detail">{s.detail}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Fallback renderer — formats data as indented JSON */
function JsonRenderer({ data }: { data: unknown }) {
  return (
    <pre
      style={{
        margin: 0,
        fontSize: "0.75rem",
        overflowX: "auto",
        whiteSpace: "pre-wrap",
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function renderComponent(component: string, data: unknown) {
  switch (component) {
    case "service-chips":
      return <ServiceChipsRenderer data={data} />;
    default:
      return <JsonRenderer data={data} />;
  }
}

// ── ViewCard ─────────────────────────────────────────────────────────────────

/**
 * ViewCard resolves a named view through the three-layer pipeline:
 *   1. Fetch ViewDef from /api/views/:name (source endpoint + component)
 *   2. Fetch entity field data from source.endpoint
 *   3. Render with the declared component
 */
export function ViewCard({ viewName, titleOverride }: Props) {
  const [viewDef, setViewDef] = useState<ViewDef | null>(null);
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const vRes = await fetch(`/api/views/${viewName}`);
        if (!vRes.ok) throw new Error(`View not found: ${viewName}`);
        const vDef = (await vRes.json()) as ViewDef;
        if (cancelled) return;

        const dRes = await fetch(vDef.source.endpoint);
        if (!dRes.ok) {
          throw new Error(`Data fetch failed (HTTP ${dRes.status})`);
        }
        const d: unknown = await dRes.json();
        if (cancelled) return;

        setViewDef(vDef);
        setData(d);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [viewName]);

  const title = titleOverride ?? viewDef?.description ?? viewName;

  if (loading) {
    return (
      <div className="card wide">
        <div className="card-header">
          <span className="card-title">{title}</span>
        </div>
        <div style={{ padding: "1rem", opacity: 0.5 }}>Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card wide">
        <div className="card-header">
          <span className="card-title">{title}</span>
        </div>
        <div style={{ padding: "1rem", color: "var(--color-error, #e05)" }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="card wide">
      <div className="card-header">
        <span className="card-title">{title}</span>
      </div>
      {viewDef && renderComponent(viewDef.component, data)}
    </div>
  );
}
