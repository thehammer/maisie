# Next Session

## State as of 2026-04-08

### What's Running

- **Tokyo** (192.168.1.10): all services up, latest code deployed
- **Dashboard**: http://192.168.1.10:3001

### What We Built This Session

8 commits landing the card type system + configurator + card migration:

| Commit | What |
|--------|------|
| `ddb31ee` | fix: plugin DB config → env (configure without restart) |
| `a5cacf9` | fix: HP printer graceful offline + namespace-aware XML parsing |
| `a327fe7` | feat: schema-level type inference (scalar/record/collection/json) |
| `749e4a4` | feat: function library — ops, renderers, pipeline (1676 lines) |
| `78b0799` | feat: card configurator — gear icon on every card, edit overlay |
| `77806c1` | refactor: convert HdhrCard, BambuCard, DakboardCard → DynamicCard |
| `e9848b8` | refactor: convert PackagesCard + DynamicListItems layout |
| `7c83d51` | feat: static descriptors for all remaining hand-written cards |

### Key New Files

- `packages/shared/src/ops.ts` — MaisieValue types, ExprNode DAG, primitives, STD_LIB, compileOp, evalExpr
- `packages/shared/src/renderers.ts` — 19 RendererConfig types + RENDERER_DEFAULTS
- `packages/shared/src/__tests__/ops.test.ts` — 51 tests for ops
- `packages/dashboard/src/lib/renderers/FieldRenderer.tsx` — React renderer for all MaisieFieldTypes
- `packages/dashboard/src/lib/pipeline.ts` — applyPipeline(data, ops[])
- `packages/dashboard/src/lib/static-descriptors.ts` — CardDescriptors for all 15 hand-written cards
- `packages/dashboard/src/components/CardConfigurator.tsx` — the edit panel

### Deleted Components (converted to DynamicCard)

- ResourceCard.tsx (dead code)
- HdhrCard.tsx → DynamicCard record
- BambuCard.tsx → DynamicCard record
- DakboardCard.tsx → DynamicCard list-items
- PackagesCard.tsx → DynamicCard list-items with image thumbnails

---

## Next Steps (in priority order)

### 1. Compound Cards (11A.9 in design doc)

Multi-section rendering from one API response. The main blocker for converting NasCard, PlexCard, MediaCard, CalibreCard. Design is written in the plan doc — add `SectionConfig` to CardConfig, build `DynamicCompound` renderer, update configurator.

### 2. Write Path (11A.10 in design doc)

Wire ToggleRenderer and ActionRenderer to POST mutations. Unblocks SmartHomeCard (per-device toggles) and YouTubeCleanupCard (Run Now button). Design is in the plan doc.

### 3. Card Template Library (11A.7)

Save/load named card configurations. Templates appear in the Add Card panel alongside raw actions. E.g. "Low Ink Alert" = hp-printer.get_supply_levels filtered to levelPercent < 20.

### Remaining Hand-Written Cards

| Card | Blocker | Converts After |
|------|---------|----------------|
| NasCard | Multi-section | Compound cards |
| PlexCard | Multi-section | Compound cards |
| MediaCard | Multi-section | Compound cards |
| CalibreCard | Multi-section | Compound cards |
| SmartHomeCard | Toggle mutations | Write path |
| YouTubeCleanupCard | Action button | Write path |
| NightlyCard | Start/stop toggle | Write path |
| CalibreEnrichmentCard | Complex mutations | Stays hand-written (or becomes page) |
| RecentlyAddedCard | Carousel animation | Stays hand-written (custom renderer) |
| NetworkCard | Aggregated analytics | Stays hand-written (needs summary endpoint) |
| ServiceStatus | Multi-API aggregation | Stays hand-written (computed in App.tsx) |

---

## Other Pending Items

### From Previous Session
- UniFi Protect RTSP stream URLs (data is already in bootstrap)
- Webhook receivers for Plex/Sonarr/Radarr (eliminate polling)
- File renames: WidgetSlot.tsx → CardSlot.tsx, AddWidgetPanel.tsx → AddCardPanel.tsx

### Housekeeping
- Vite chunk warning: App.tsx bundle is 1.6MB — needs code splitting
- `packagesConfiguredApi` pattern could be generalized for all optional services
