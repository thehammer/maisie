# Next Session

## Overnight Progress (2026-04-04 → 05)

### Completed

**Quick fixes (committed)**
- `fix: dedup personas by name in createPersonaRouter` — Natalie was showing twice (plugin-unifi + plugin-synology both declare her). First occurrence wins.
- `fix: propagate conversation history to chat API` — Chat was always sending [] as history. Now snapshots settled turns and includes them in every POST.

**Refactor + Phase 2 (committed as one)**
- `refactor: rename widget → card throughout + Phase 2 semantic types`
  - WidgetConfig → CardConfig, WidgetDescriptor → CardDescriptor, WidgetField → CardField
  - getWidgetCatalog → getCardCatalog, /api/widgets/catalog → /api/cards/catalog
  - addWidget/removeWidget → addCard/removeCard, WidgetSlot → CardSlot
  - CSS: widget-edit-* → card-edit-*, widget-hidden → card-hidden
  - **Phase 2**: CardField now has `maisieType: MaisieFieldType | null`; schema-introspector reads field() annotations via getMaisieType(); DynamicCard prefers maisieType over raw Zod fallback. Plugin fields annotated with field(z.number(), 'bytes') now render as "1.2 GB" automatically.

**Phase 1 (committed)**
- `docs: Phase 1 universal interface protocol spec` — docs/protocol.md written

**Phase 3 (in flight at time of writing)**
- Sonarr: list_missing_episodes, list_download_history, invoke_series_search
- Radarr: list_missing_movies, list_download_history, invoke_movie_search
- Plex: list_on_deck, list_watch_history
- Synology: get_system_status, list_backup_tasks

---

## UniFi — Still Locked Out

Rate limit (429) still active at end of session. Try again tomorrow:
```bash
ssh tokyo 'PASS=$(grep UNIFI_PASSWORD ~/maisie/.env | cut -d= -f2-); curl -sk -X POST https://192.168.1.1/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"Maisie\",\"password\":\"$PASS\"}" -w "\nHTTP %{http_code}"'
```
If 200: set `UNIFI_PROTECT_ENABLED=true` in Tokyo .env and deploy.

---

## What's Left

### Phase 3 remaining gaps (lower priority)
- UniFi: RTSP stream URLs from protect bootstrap (cameras already have the data, just needs mapping)
- Plex: webhook receiver for play/stop events without polling
- Sonarr/Radarr: webhook receivers for grab/import events
- Synology: network interface info, package status

### Phase 4 (surface layers — mostly done)
- Dashboard auto-generation: ✅ complete
- Add Widget catalog panel: ✅ complete
- Semantic type propagation: ✅ complete (Phase 2)
- OpenAPI auto-generation: not yet implemented (lower priority)

### Rename follow-up
- File names WidgetSlot.tsx and AddWidgetPanel.tsx not renamed (exports renamed, imports still work)
- Can do as housekeeping

### Webster
- Chrome: ✅ working
- Safari: popup still unconfirmed — see steps in previous notes
- Firefox: temporary add-on load from build/extension/firefox/

---

## Deploy

Run when Phase 3 agents complete and typecheck is green:
```bash
LAN_IP=192.168.1.10 ./scripts/deploy-tokyo.sh maisie
```
