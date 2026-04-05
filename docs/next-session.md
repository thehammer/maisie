# Next Session

## What Was Completed Today (Phase 4)

Dashboard auto-generation is live:
- `DynamicCard` — fetches its own data, renders with ResourceCard/ResourceList, derives HTTP path using same logic as plugin-core's `deriveHttpPath`
- `AddWidgetPanel` — right-side catalog drawer in edit mode, grouped by section, one-click add
- `useLayout.addWidget` / `removeWidget` — catalog-sourced widgets (dot in ID) get a remove button
- **Bug fixed**: DynamicCard was using raw action name as URL path (`/list_lights`) instead of derived path (`/lights`)

## Ready to Test Tomorrow

- Open dashboard, click Edit Layout → "+ Add Widget"
- Try: `synology.get_system_info`, `unifi.get_wan_health`, `plex.get_now_playing`, `plex.list_libraries`
- Catalog widgets have a red ✕ to remove (not just hide)

---

## Known Issues (Quick Fixes)

- **Double Natalie in agent log**: `[agent] 4 personas active: Channing, Alexandria, Natalie, Natalie`
  - plugin-unifi and plugin-synology both declare her
  - Fix: dedup in `createPersonaRouter` or `createAgent`

- **Chat has no conversation history**: `runForMessage` always passes `[]`
  - Fix: propagate history from ChatPage/ChatPanel through the route

- **UniFi re-enable** (rate limit should have cleared long ago):
  ```bash
  ssh tokyo 'PASS=$(grep UNIFI_PASSWORD ~/maisie/.env | cut -d= -f2-); curl -sk -X POST https://192.168.1.1/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"Maisie\",\"password\":\"$PASS\"}" -w "\nHTTP %{http_code}"'
  ```
  If 200: set `UNIFI_PROTECT_ENABLED=true` in Tokyo .env and deploy.

---

## Universal Interface Plan — Current Position

See `docs/super-plan.md` for full detail.

- **Phase 0** ✅ API catalog, dashboard layout customization, three-surface framework running
- **Phase 3/4 (session phases)** ✅ Plugin migration complete, dashboard auto-generation complete

**Next up — Phase 1: Taxonomy & Protocol Design**
- Produce `docs/protocol.md` — universal resource model derived from the catalog
- Vocabulary: Resource, Field, Action, Entity, Capability, Tier
- Semantic types: `bytes`, `percentage`, `status`, `image`, `progress`, `list<T>`, `action`, `toggle`
- This is design work — no code yet. Output is a protocol doc tight enough to build the Phase 2 framework from.

**Then Phase 2: Core Framework**
- Resource Registry in `packages/plugin-core`
- `PluginAction` gets explicit `ui` surface declaration (type: data | action | list)
- Auto-generated OpenAPI from action definitions
- MaisieFieldType semantic annotations propagated through to widget catalog (currently lost at introspection)

---

## Rename "widget" → "card"

Still deferred. Do before Phase 2 adds more surface area:
- `WidgetConfig` → `CardConfig`, `widgetId` → `cardId`
- CSS class names, layout service, DB schema

---

## Webster Browser Automation

Webster (`~/Software Development/Open Source/webster`) — Chrome working, Safari popup unresolved.

**MCP tools registration:** If `mcp__webster__*` tools don't appear, orphan process on port 3000:
```bash
kill $(lsof -ti :3000)
claude   # fresh session — tools register
```

**Safari popup** — still not confirmed working. To rebuild:
```bash
cd ~/Software\ Development/Open\ Source/webster && ./scripts/build-extension.sh --safari --xcode
```
Cmd+R in Xcode. Then: Safari → Develop → Allow Unsigned Extensions ✓ (resets on restart!), grant website access on first click.

**Firefox** — MV3 background script bundled, manifest uses `background.scripts`. Load from `build/extension/firefox/`:
1. `about:debugging` → "This Firefox" → "Load Temporary Add-on..." → select `manifest.json`
