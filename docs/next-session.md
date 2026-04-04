# Next Session

## Priority: Re-enable UniFi/Protect

The UDM Pro locked us out from too many login attempts. Session persistence
is now in place (`data/unifi-session.json`, `data/protect-session.json`).

**To re-enable:**
1. Make one test login: `ssh tokyo 'PASS=$(grep UNIFI_PASSWORD ~/maisie/.env | cut -d= -f2-); curl -sk -X POST https://192.168.1.1/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"Maisie\",\"password\":\"$PASS\"}" -w "\nHTTP %{http_code}"'`
2. If 200: set `UNIFI_PROTECT_ENABLED=true` in Tokyo .env and deploy
3. On first successful connect, session files are written — subsequent restarts won't login

## Known Issues

- **Double Natalie in agent log**: `[agent] 4 personas active: Channing, Alexandria, Natalie, Natalie` — dedup in `builtInPersonas()` fixed the API response but `personaRouter` still sees duplicates from `loadedPlugins` (plugin-unifi and plugin-synology both declare her). Fix: dedup in `createPersonaRouter` or `createAgent`.

- **Chat has no conversation history**: `runForMessage` accepts a `history` param but the chat route always passes `[]`. Each message is a fresh context. Fix: send history from ChatPage/ChatPanel and pass it through the route.

## Universal Interface Project

`docs/super-plan.md` is committed. The phases:

- **Phase 0** — Complete. API catalog written (`docs/api-catalog/`), dashboard layout customization implemented (all three surfaces: UI drag/drop, REST, agent actions).

- **Phase 1** — Next: Taxonomy & Protocol Design.
  - Produce `docs/protocol.md` — universal resource model derived from the catalog
  - Vocabulary: Resource, Field, Action, Entity, Capability, Tier
  - Semantic types: `bytes`, `percentage`, `status`, `image`, `progress`, `list<T>`, `action`, `toggle`
  - Define the three-surface contract precisely enough to build the framework

- **Phase 2** — Core Framework
  - `packages/plugin-core` gets Resource Registry, typed pipeline operators
  - `PluginAction` gets explicit `ui` surface declaration (not just `false`)
  - Auto-generated OpenAPI from action definitions

- **Phase 3** — Fill integration gaps (per catalog gap analyses)
- **Phase 4** — Surface layers (dashboard auto-generation, agent discovery)

## Rename "widget" → "card"

Discussed but not implemented. `WidgetConfig` → `CardConfig`, `widgetId` → `cardId`,
CSS class names, layout-service, DB schema comment. Do this before Phase 2 adds more
surface area.

## Completed This Session

- Fixed CI (TypeScript error in useApi.ts — null narrowing in async closure)
- Added exponential backoff for UniFi/Protect reconnect (2m → 4 → 8 → 16 → 30m cap)
- Removed conflicting 30-min client-side cooldowns
- Persisted UniFi/Protect sessions to disk
- Dashboard layout customization — all three surfaces (drag/drop UI, REST API, agent actions)
- Full API catalog: UniFi, Synology, Home Assistant, media stack, devices/tools
- Universal interface super plan (`docs/super-plan.md`)
