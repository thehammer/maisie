/**
 * AddCardPanel — right-side drawer shown in layout edit mode.
 *
 * Lists all catalog cards grouped by section. Cards already in the
 * layout are shown as "Added" (greyed out). Clicking a row adds it.
 */

import type { CardDescriptor } from "./DynamicCard";

interface Props {
  open: boolean;
  onClose: () => void;
  catalog: CardDescriptor[];
  existingIds: Set<string>;
  onAdd: (id: string) => void;
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
  // Group by section, filtering out hidden ones
  const sections = new Map<string, CardDescriptor[]>();
  for (const w of catalog) {
    if (HIDDEN_SECTIONS.has(w.section)) continue;
    const group = sections.get(w.section) ?? [];
    group.push(w);
    sections.set(w.section, group);
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
        {sections.size === 0 && (
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
