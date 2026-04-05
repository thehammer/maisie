# Next Session

## State as of 2026-04-05

### What's Running

- **Tokyo** (192.168.1.10): all services up, latest code deployed
- **Webster**: ✅ Chrome working, ✅ Safari working (got it working this morning)
  - MCP server registered in `~/.claude.json`
  - Agent definition at `~/.claude/agents/webster.md`
  - If `mcp__webster__*` tools don't appear, orphan process on port 3000:
    ```bash
    kill $(lsof -ti :3000) && claude
    ```

---

## Overnight Commits (all deployed)

| Commit | What |
|--------|------|
| `25b84c5` | fix: dedup Natalie persona (plugin-unifi + plugin-synology both declared her) |
| `795e856` | fix: chat history — each message now carries prior turns to the agent |
| `b33872e` | refactor: widget→card rename + Phase 2 semantic type propagation |
| `69e8748` | feat: Phase 3 gaps — Sonarr/Radarr missing+history+search, Plex on-deck+history, Synology system status+backups |
| `7e58705` | docs: next-session update |

### Phase 2 detail (in b33872e)
- `CardField.maisieType: MaisieFieldType | null` — field() annotations now flow through schema introspector → catalog API → DynamicCard renderer
- Full widget→card vocabulary rename (CardConfig, CardDescriptor, CardField, /api/cards/catalog, addCard/removeCard, CardSlot, AddCardPanel)

---

## What to Test This Session

### Dashboard (http://maisie.1368bayoupathcourt.net or http://192.168.1.10:3001)
1. **Add Card panel** — Edit Layout → "+ Add Card" — catalog drawer should slide in
2. **DynamicCard rendering** — add `synology.get_system_status`, `plex.list_on_deck`, `sonarr.list_missing_episodes` — verify they render with correct semantic types (percentages as bars, timestamps as "2h ago", status as colored badge)
3. **Chat memory** — start a conversation, ask a follow-up that requires context ("what about the second one?") — should work now
4. **Personas** — agent log should show "3 personas active: Channing, Alexandria, Natalie" (not 4)

### Webster (with Safari now working)
- Use the webster agent (`.claude/agents/webster.md`) or `mcp__webster__*` tools directly
- Navigate, read pages, interact with dashboard via browser automation

---

## Pending Items

### UniFi — still rate-limited (try first thing)
```bash
ssh tokyo 'PASS=$(grep UNIFI_PASSWORD ~/maisie/.env | cut -d= -f2-); curl -sk -X POST https://192.168.1.1/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"Maisie\",\"password\":\"$PASS\"}" -w "\nHTTP %{http_code}"'
```
If 200 → set `UNIFI_PROTECT_ENABLED=true` in Tokyo `.env` and deploy.

### Remaining Phase 3 gaps (lower priority)
- UniFi: expose RTSP stream URLs from Protect bootstrap (data's already there)
- Plex/Sonarr/Radarr: webhook receivers to eliminate polling
- Synology: network interface info, package status

### Housekeeping
- File renames: `WidgetSlot.tsx` → `CardSlot.tsx`, `AddWidgetPanel.tsx` → `AddCardPanel.tsx` (exports already renamed, imports still work)

### OpenAPI auto-generation (Phase 2 remainder — low priority)
- Auto-generate OpenAPI spec from PluginAction definitions

---

## Webster Project State

Repo: `~/Software Development/Open Source/webster`

- MCP server: `src/server.ts` + `src/index.ts` (Bun, stdio transport)
- Extension: `extension/` (MV3, Chrome/Safari/Firefox)
- Build: `./scripts/build-extension.sh [--safari|--firefox]`
- Tests: `bun test` in the webster repo

**Safari build notes:**
- `Allow Unsigned Extensions` resets on Safari restart — re-enable each time
- Build + install: `./scripts/build-extension.sh --safari --xcode` → Cmd+R in Xcode
- Grant website access on first toolbar click

**Firefox:**
- `about:debugging` → "Load Temporary Add-on" → `build/extension/firefox/manifest.json`
