/**
 * AppNext — three-layer UI
 *
 * Entry point for the new dashboard at /next. Every card and page here
 * is driven by the type system + function library + component system.
 * No hand-coded data fetching or layout inside this tree.
 *
 * Navigation mirrors the legacy app so pages can be compared tab-by-tab.
 * Switch back to legacy at any time via the banner link.
 */

import { useState } from "react";
import { StudioPage } from "./pages/StudioPage";
import { ViewCard } from "./components/ViewCard";

type Page =
  | "home"
  | "media"
  | "tv"
  | "cameras"
  | "network"
  | "studio";

const NAV_ITEMS: { id: Page; label: string }[] = [
  { id: "home",    label: "Home"    },
  { id: "media",   label: "Media"   },
  { id: "tv",      label: "TV"      },
  { id: "cameras", label: "Cameras" },
  { id: "network", label: "Network" },
  { id: "studio",  label: "Studio"  },
];

export function AppNext() {
  const [page, setPage] = useState<Page>("home");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0a0a0a", color: "#e5e5e5", fontFamily: "system-ui, sans-serif" }}>

      {/* Preview banner */}
      <div style={{ background: "#1a1a2e", borderBottom: "1px solid #7c3aed", padding: "6px 16px", display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "#a78bfa" }}>
        <span style={{ fontWeight: 600, letterSpacing: "0.05em" }}>◈ NEW UI</span>
        <span style={{ color: "#6b7280" }}>Three-layer preview — everything here is driven by the component + function + type system</span>
        <a href="/" style={{ marginLeft: "auto", color: "#6b7280", textDecoration: "none" }}>← Back to legacy</a>
      </div>

      {/* Nav */}
      <nav style={{ display: "flex", gap: 2, padding: "8px 12px", borderBottom: "1px solid #1f1f1f" }}>
        {NAV_ITEMS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setPage(id)}
            style={{
              background: page === id ? "#1f1f2e" : "transparent",
              color: page === id ? "#a78bfa" : "#9ca3af",
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: page === id ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Page content */}
      <main style={{ flex: 1, overflow: "auto" }}>
        {page === "home" ? (
          <HomePage />
        ) : page === "media" ? (
          <MediaPage />
        ) : page === "studio" ? (
          // Studio is already three-layer — reuse it directly
          <StudioPage onBack={() => setPage("home")} />
        ) : (
          <PlaceholderPage name={page} />
        )}
      </main>
    </div>
  );
}

/** Home page — Wave 1 conversions. Each card here is a ViewCard bound to an entity via the three-layer system. */
function HomePage() {
  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#4b5563", marginBottom: 4 }}>
        Home
      </div>
      {/* Wave 1 — ServiceStatus: entity + view → ViewCard */}
      <ViewCard viewName="services-status" titleOverride="Services" />
    </div>
  );
}

/** Media page — library management cards. */
function MediaPage() {
  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#4b5563", marginBottom: 4 }}>
        Media
      </div>
      {/* Wave 1 — CalibreEnrichmentCard: entity + view → ViewCard */}
      <ViewCard viewName="calibre-enrichment" titleOverride="Calibre Enrichment" />
    </div>
  );
}

function PlaceholderPage({ name }: { name: Page }) {
  return (
    <div style={{ padding: 40, color: "#4b5563" }}>
      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8, color: "#374151" }}>
        {name}
      </div>
      <div style={{ fontSize: 13 }}>
        Not yet implemented — convert the legacy{" "}
        <a href={`/?page=${name}`} style={{ color: "#6b7280" }}>
          {name} page
        </a>{" "}
        here using ViewCard + entity bindings.
      </div>
    </div>
  );
}
