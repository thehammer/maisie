/**
 * AddCardPanel — right-side drawer shown in layout edit mode.
 *
 * Lists all catalog cards grouped by section, plus saved templates.
 * Cards already in the layout are shown as "Added" (greyed out).
 * Clicking a row adds it.
 */

import type { CardDescriptor } from "./DynamicCard";
import { useApi } from "../hooks/useApi";

interface CardTemplate {
  id: string;
  name: string;
  descriptorId: string;
  config: Record<string, unknown>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  catalog: CardDescriptor[];
  existingIds: Set<string>;
  onAdd: (id: string, templateConfig?: Record<string, unknown>) => void;
}

// Sections to omit from the catalog browser — meta widgets that don't
// belong on the home dashboard.
const HIDDEN_SECTIONS = new Set(["dashboard"]);

// Friendly display names for section keys
const SECTION_LABELS: Record<string, string> = {
  system:       "System",
  ai:           "AI",
  personal:     "Personal",
  integrations: "Integrations",
  printer:      "Printer",
  smarthome:    "Smart Home",
  enrichment:   "Enrichment",
  library:      "Library",
  media:        "Media",
  nas:          "NAS",
  network:      "Network",
  protect:      "Cameras",
};

export function AddCardPanel({ open, onClose, catalog, existingIds, onAdd }: Props) {
  const templatesApi = useApi<CardTemplate[]>(open ? "/api/cards/templates" : null, 0);
  const templates = templatesApi.data ?? [];

  // Group by section, filtering out hidden ones
  const sections = new Map<string, CardDescriptor[]>();
  for (const w of catalog) {
    if (HIDDEN_SECTIONS.has(w.section)) continue;
    const group = sections.get(w.section) ?? [];
    group.push(w);
    sections.set(w.section, group);
  }

  async function handleDeleteTemplate(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/cards/templates/${id}`, { method: "DELETE" });
    templatesApi.refresh();
  }

  return (
    <div className={`customize-panel${open ? " open" : ""}`}>
      <div className="customize-panel-header">
        <span className="customize-panel-title">Add Card</span>
        <button
          className="card-edit-btn"
          onClick={onClose}
          title="Close"
          style={{ fontSize: "1rem" }}
        >
          ✕
        </button>
      </div>

      <div className="customize-catalog">
        {/* ── Templates ──────────────────────────────────────── */}
        {templates.length > 0 && (
          <div className="customize-catalog-section">
            <div className="customize-catalog-section-title">Templates</div>
            {templates.map((t) => {
              // Template cards get a unique layout ID: template:{id}
              const templateCardId = `template:${t.id}`;
              const added = existingIds.has(templateCardId);
              return (
                <div
                  key={t.id}
                  className="customize-catalog-item"
                  onClick={() => !added && onAdd(t.descriptorId, t.config)}
                  style={{ opacity: added ? 0.45 : 1, cursor: added ? "default" : "pointer" }}
                >
                  <span className="customize-catalog-item-label">
                    {t.name}
                    <span className="customize-catalog-item-sub">
                      {t.descriptorId}
                    </span>
                  </span>
                  <span className="customize-catalog-actions">
                    <button
                      className="customize-catalog-delete"
                      onClick={(e) => handleDeleteTemplate(t.id, e)}
                      title="Delete template"
                    >
                      ✕
                    </button>
                    <span className="customize-catalog-add">
                      {added ? "✓" : "+"}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Catalog ────────────────────────────────────────── */}
        {sections.size === 0 && templates.length === 0 && (
          <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.83rem" }}>
            No cards available.
          </div>
        )}
        {[...sections.entries()].map(([section, widgets]) => (
          <div key={section} className="customize-catalog-section">
            <div className="customize-catalog-section-title">
              {SECTION_LABELS[section] ?? section}
            </div>
            {widgets.map((w) => {
              const added = existingIds.has(w.id);
              return (
                <div
                  key={w.id}
                  className="customize-catalog-item"
                  onClick={() => !added && onAdd(w.id)}
                  style={{ opacity: added ? 0.45 : 1, cursor: added ? "default" : "pointer" }}
                >
                  <span className="customize-catalog-item-label">{w.label}</span>
                  <span className="customize-catalog-add">
                    {added ? "✓" : "+"}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
