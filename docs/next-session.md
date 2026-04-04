# Next Session

## Priority: Re-enable UniFi/Protect

The UDM Pro locked us out from too many login attempts today. Session persistence
is now in place (`data/unifi-session.json`, `data/protect-session.json`).

**To re-enable:**
1. Make one test login: `ssh tokyo 'PASS=$(grep UNIFI_PASSWORD ~/maisie/.env | cut -d= -f2-); curl -sk -X POST https://192.168.1.1/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"Maisie\",\"password\":\"$PASS\"}" -w "\nHTTP %{http_code}"'`
2. If 200: set `UNIFI_PROTECT_ENABLED=true` in Tokyo .env and deploy
3. On first successful connect, session files are written — subsequent restarts won't login

## Known Issues

- **Double Natalie in agent log**: `[agent] 4 personas active: Channing, Alexandria, Natalie, Natalie` — dedup in `builtInPersonas()` fixed the API response but `personaRouter` still sees duplicates from `loadedPlugins` (plugin-unifi and plugin-synology both declare her). Fix: dedup in `createPersonaRouter` or `createAgent`.

- **Chat has no conversation history**: `runForMessage` accepts a `history` param but the chat route always passes `[]`. Each message is a fresh context. Fix: send history from ChatPage/ChatPanel and pass it through the route.

## Completed This Session

- Fixed CI (TypeScript error in useApi.ts — null narrowing in async closure)
- Added exponential backoff for UniFi/Protect reconnect (2m → 4 → 8 → 16 → 30m cap)
- Removed conflicting 30-min client-side cooldowns (backoff in index.ts is the sole governor)
- Persisted UniFi/Protect sessions to disk (restarts no longer burn a login attempt)
- Fixed MQTT mixed-content (Caddy `/mqtt` proxy, wss on HTTPS)
- Fixed AgentStatus rendering, Personas page, plugin configure modal
- Added Maison Mark favicon + header icon
- Fixed Google OAuth redirect URI
- Fixed chat (wrong model IDs — `claude-sonnet-4-5-20251001` doesn't exist)
