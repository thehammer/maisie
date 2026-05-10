/**
 * Coverage matrix — tracks which hand-coded dashboard cards have been converted
 * to the three-layer entity + component system (entity → ViewDef → ViewCard).
 *
 * Each entry records three conversion dimensions:
 *   visual     — the component renders in AppNext via ViewCard
 *   scriptable — the entity is MEL-addressable (resolve_address works)
 *   agentic    — the entity is exposed to agent personas (ai tier declared)
 */

export interface CoverageEntry {
  cardId: string;
  description: string;
  /** ViewCard renders in AppNext home page */
  visual: boolean;
  /** Entity is addressable via resolve_address() in MEL */
  scriptable: boolean;
  /** Entity is exposed to agent personas as an AI tool */
  agentic: boolean;
  notes?: string;
}

export const COVERAGE_MATRIX: CoverageEntry[] = [
  {
    cardId: "ServiceStatus",
    description:
      "Service health chips — connected/error/unconfigured per integration",
    visual: true,
    scriptable: true,
    agentic: false,
    notes:
      "Rendered via ViewCard (services-status view) in AppNext home page. " +
      "Entity: services.status sentinel backed by /api/services/status. " +
      "Agentic exposure deferred.",
  },
  {
    cardId: "NetworkCard",
    description: "UniFi device list",
    visual: false,
    scriptable: false,
    agentic: false,
    notes: "Not yet converted.",
  },
  {
    cardId: "PlexCard",
    description: "Plex server status with libraries, now playing, recently added",
    visual: false,
    scriptable: false,
    agentic: false,
    notes: "Not yet converted.",
  },
  {
    cardId: "NasCard",
    description: "Synology NAS storage health",
    visual: false,
    scriptable: false,
    agentic: false,
    notes: "Not yet converted.",
  },
  {
    cardId: "RecentlyAddedCard",
    description: "Plex recently added with RAF carousel animation",
    visual: false,
    scriptable: false,
    agentic: false,
    notes:
      "Requires carousel base component stub (registered, implementation pending). " +
      "Deliberate exception: requestAnimationFrame loop is outside the component DSL scope by design.",
  },
  {
    cardId: "NightlyCard",
    description: "Nightly maintenance task status",
    visual: false,
    scriptable: false,
    agentic: false,
    notes: "Not yet converted.",
  },
  {
    cardId: "DockerUpgradesCard",
    description: "Docker image upgrade status",
    visual: false,
    scriptable: false,
    agentic: false,
    notes: "Not yet converted.",
  },
  {
    cardId: "NowPlayingCard",
    description: "Plex now playing",
    visual: false,
    scriptable: false,
    agentic: false,
    notes: "Not yet converted.",
  },
  {
    cardId: "CalibreEnrichmentCard",
    description: "Calibre book metadata enrichment status with per-item approve/reject queue",
    visual: true,
    scriptable: true,
    agentic: false,
    notes:
      "Wave 1: rendered via ViewCard (calibre-enrichment view) in AppNext. " +
      "Entity: calibre.enrichment backed by /api/calibre/enrichment/status. " +
      "Component: json with expanded:true (Wave 1 fallback). " +
      "This is the richest proof point for Phase 3P: per-item approve/reject, write path, " +
      "and conditional sections are all Wave 5 agentic surface work. " +
      "Wave 2: derive calibre-enrichment-stats component (progress bar, gap breakdown). " +
      "Wave 5: per-item review queue with approve/reject via agentic invoke tier.",
  },
];

/** Returns all cards that have both visual and scriptable conversion complete. */
export function getConvertedCards(): CoverageEntry[] {
  return COVERAGE_MATRIX.filter((e) => e.visual && e.scriptable);
}

/** Returns the conversion percentage (visual + scriptable). */
export function getCoveragePercent(): number {
  const converted = getConvertedCards().length;
  return Math.round((converted / COVERAGE_MATRIX.length) * 100);
}
