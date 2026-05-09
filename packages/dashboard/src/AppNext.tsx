import { useState } from "react";
import { ViewCard } from "./components/ViewCard";

type Page = "home" | "studio";

interface PlaceholderPageProps {
  name: string;
}

function PlaceholderPage({ name }: PlaceholderPageProps) {
  return (
    <div style={{ padding: 24, opacity: 0.5 }}>
      <em>{name} — coming soon</em>
    </div>
  );
}

/**
 * AppNext — the new dashboard shell for the entity + component system.
 *
 * Replaces hand-coded card assembly with ViewCard components backed by the
 * three-layer entity → view → renderer pipeline. The legacy App.tsx continues
 * to serve the original dashboard; AppNext is accessible at /next.
 *
 * Wave 1 conversions rendered here:
 *   - ServiceStatus → <ViewCard viewName="services-status" />
 */
export function AppNext() {
  const [page, setPage] = useState<Page>("home");

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="dashboard-nav">
          <h1 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <img
              src="/favicon.svg"
              alt=""
              width="28"
              height="28"
              style={{ display: "block" }}
            />
            Maisie
            <span
              style={{
                fontSize: "0.6rem",
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                opacity: 0.5,
                marginLeft: 2,
              }}
            >
              next
            </span>
          </h1>
          <nav className="nav-links">
            <button
              className={`nav-link${page === "home" ? " active" : ""}`}
              onClick={() => setPage("home")}
              style={{ background: "none", border: "none", cursor: "pointer" }}
            >
              Home
            </button>
            <button
              className={`nav-link${page === "studio" ? " active" : ""}`}
              onClick={() => setPage("studio")}
              style={{ background: "none", border: "none", cursor: "pointer" }}
            >
              Studio
            </button>
            <a href="/" className="nav-link" style={{ opacity: 0.6 }}>
              ← Classic
            </a>
          </nav>
        </div>
      </div>

      <div>
        {page === "home" ? (
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            <ViewCard viewName="services-status" titleOverride="Services" />
          </div>
        ) : (
          <PlaceholderPage name={page} />
        )}
      </div>
    </div>
  );
}
