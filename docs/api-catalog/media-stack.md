# Media Stack API Catalog

Reference for Plex Media Server, Sonarr, Radarr, and Prowlarr — the four services in Maisie's media stack. Covers authentication, all endpoint groups, webhook events, real-time support, and a gap analysis against current Maisie implementations.

---

## Contents

1. [Plex Media Server](#plex-media-server)
2. [Sonarr](#sonarr)
3. [Radarr](#radarr)
4. [Prowlarr](#prowlarr)
5. [Gap Analysis](#gap-analysis)

---

## Plex Media Server

### Authentication

**Base URL:** `http://{host}:32400`

Auth is done via a token passed in one of two ways:
- **Header:** `X-Plex-Token: {token}`
- **Query param:** `?X-Plex-Token={token}`

All requests should include `Accept: application/json` to receive JSON instead of XML (default).

Additional client identity headers (optional but good practice):
- `X-Plex-Platform` — OS name (e.g., `Linux`)
- `X-Plex-Product` — App name
- `X-Plex-Version` — App version
- `X-Plex-Client-Identifier` — Unique client UUID
- `X-Plex-Container-Size` — Pagination page size
- `X-Plex-Container-Start` — Pagination offset

**Token acquisition:** Retrieved from Plex.tv after sign-in. For local server automation, the token from the Plex desktop app preferences or `X-Plex-Token` cookie is used. MyPlex OAuth is available for user-facing flows.

**No WebSocket support.** Plex does not expose a real-time WebSocket API for external consumers. Polling is required, or use webhooks (Plex Pass only) for push notification of events.

---

### Server Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Server capabilities, version, feature flags. Response varies by token (admin vs managed user). |
| GET | `/identity` | Machine identifier and version (unprotected — no token required). |
| GET | `/myplex/account` | Account info for the authenticated Plex.tv user. |
| GET | `/accounts` | List all local accounts (multi-user). Returns name, language prefs, subtitle mode. |
| GET | `/devices` | Historical list of all devices that have connected to this server. |
| GET | `/clients` | Currently connected clients (active sessions). |
| GET | `/servers` | List of local servers visible on the network. |
| GET | `/system` | General system information. |
| GET | `/system/agents` | Available metadata agents and their configuration. |
| GET | `/:/prefs` | All server preference settings. |
| PUT | `/:/prefs` | Update server preferences. Pass settings as query parameters. |
| GET | `/activities` | Active background tasks (uuid, type, progress, cancellable, userID). |
| DELETE | `/activities/{uuid}` | Cancel a running activity. |
| GET | `/butler` | List of scheduled Butler maintenance tasks. |
| POST | `/butler/{task}` | Execute a named Butler task immediately. |
| GET | `/updater/status` | Check for pending updates. |
| PUT | `/updater/check` | Trigger an update check. |
| GET | `/security/token` | Generate a transient access token. |
| GET | `/statistics/bandwidth` | Bandwidth usage statistics. |
| GET | `/statistics/resources` | CPU/memory resource utilization. |
| GET | `/diagnostics/databases` | Download Plex database (zipped). |
| GET | `/diagnostics/logs` | Download log files (zipped). |

---

### Library Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/library/sections` | List all libraries. Returns key, title, type (movie/show/music/photo). |
| POST | `/library/sections` | Add a new library. |
| DELETE | `/library/sections/{key}` | Delete a library. |
| GET | `/library/sections/{key}` | Details for a single library. |
| GET | `/library/sections/{key}/all` | Browse all items in a library. Supports extensive filtering (see below). |
| GET | `/library/sections/{key}/refresh` | Scan library for new/changed files. |
| GET | `/library/sections/{key}/prefs` | Library-specific preferences. |
| GET | `/library/sections/{key}/analyze` | Re-analyze media files for metadata. |
| GET | `/library/sections/{key}/emptyTrash` | Remove deleted items from the library. |
| GET | `/library/sections/{key}/indexes` | Generate preview thumbnails. |
| DELETE | `/library/sections/{key}/indexes` | Delete preview thumbnails. |
| GET | `/library/sections/{key}/firstCharacter` | Group items by first character for alphabetical nav. |
| GET | `/library/sections/{key}/folder` | Browse library as a folder tree. |
| GET | `/library/sections/{key}/timeline` | Timeline view of a section. |
| GET | `/library/onDeck` | Cross-library "On Deck" — in-progress media across all libraries. |
| GET | `/library/recentlyAdded` | Recently added items across all libraries. Supports `X-Plex-Container-Size`. |
| GET | `/library/all` | Global search across all sections. |
| GET | `/library/clean/bundles` | Clean orphaned bundle files. |
| GET | `/library/optimize` | Optimize the database. |
| GET | `/library/tags` | Tag management. |
| GET | `/hubs/search` | Hub-style search. Returns categorized results. |
| GET | `/hubs/sections/{key}` | Hub content for a specific section. |
| GET | `/hubs/continueWatching/items` | Continue watching list. |
| GET | `/hubs/sections/{key}/continueWatching/items` | Section-specific continue watching. |
| GET | `/search` | Simple search. `?query=string` |

**Library section filtering** (`/library/sections/{key}/all`):
- `type` — Media type: `1`=movie, `2`=show, `3`=season, `4`=episode, `8`=artist, `9`=album, `10`=track
- `title=` — Filter by title
- `year=`, `year>=`, `year<=` — Filter by year
- `rating>=` — Minimum rating
- `unwatched=1` — Only unwatched
- `decade=` — Decade filter (e.g., `1990`)
- `resolution=` — e.g., `1080`, `4k`
- `X-Plex-Container-Start` — Pagination offset
- `X-Plex-Container-Size` — Page size

---

### Metadata / Media Item Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/library/metadata/{ratingKey}` | Full metadata for a single item (movie, episode, show, etc.). |
| GET | `/library/metadata/{ratingKey}/children` | Children of an item (seasons of a show, episodes of a season). |
| GET | `/library/metadata/{ratingKey}/allLeaves` | All leaf items (episodes of a show across all seasons). |
| GET | `/library/metadata/{ratingKey}/related` | Related content recommendations. |
| GET | `/library/metadata/{ratingKey}/artwork` | Artwork paths for an item. |
| GET | `/library/metadata/{ratingKey}/posters` | Available posters. |
| GET | `/library/metadata/{ratingKey}/backgrounds` | Available background art. |
| GET | `/library/metadata/{ratingKey}/themes` | Available theme music. |
| PUT | `/library/metadata/{ratingKey}/poster` | Set poster. |
| PUT | `/library/metadata/{ratingKey}/background` | Set background art. |
| GET | `/library/metadata/{ratingKey}/media` | Media info (streams, container, codec). |
| GET | `/photo/:/transcode` | Resize/transcode an image. Params: `url`, `width`, `height`. |
| GET | `/:/scrobble` | Mark item as watched. Params: `key`, `identifier=com.plexapp.plugins.library`. |
| GET | `/:/unscrobble` | Mark item as unwatched. Same params as scrobble. |
| GET | `/:/progress` | Update play progress. Params: `key`, `time` (ms offset), `identifier`. |
| GET | `/:/rate` | Rate an item. Params: `key`, `identifier`, `rating` (0–10). |

---

### Session / Playback Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status/sessions` | All active playback sessions. Returns Metadata array with User, Player, TranscodeSession. |
| GET | `/status/sessions/history/all` | Full playback history (all users). |
| GET | `/transcode/sessions` | All active transcode sessions. |
| DELETE | `/transcode/sessions/{key}` | Terminate a specific transcode session. |
| GET | `/status/sessions/background` | Background processes/sessions. |
| POST | `/playQueues` | Create a play queue. Returns playQueueID for client consumption. |

**Session object key fields:**
- `Metadata`: title, type, year, grandparentTitle, parentIndex, index
- `User`: title (username)
- `Player`: title (device name), state (playing/paused/buffering), machineIdentifier, platform
- `TranscodeSession`: videoDecision (copy/transcode), audioDecision, progress, speed
- `viewOffset`: ms playback position
- `duration`: ms total duration

---

### Client Remote Control Endpoints

All client commands go to the connected client via `/player/` prefix. The client must be addressable (IP + port from `/clients`).

**Base:** `http://{clientHost}:{clientPort}/`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/player/playback/play` | Resume playback. |
| GET | `/player/playback/pause` | Pause playback. |
| GET | `/player/playback/stop` | Stop playback. |
| GET | `/player/playback/seekTo` | Seek. Param: `offset` (ms). |
| GET | `/player/playback/skipNext` | Skip to next item. |
| GET | `/player/playback/skipPrevious` | Skip to previous item. |
| GET | `/player/playback/skipTo` | Skip to specific item by key. |
| GET | `/player/playback/stepForward` | Step forward. |
| GET | `/player/playback/stepBack` | Step backward. |
| GET | `/player/playback/setParameters` | Set volume, shuffle, repeat. |
| GET | `/player/playback/setStreams` | Select audio/subtitle/video streams. |
| GET | `/player/playback/playMedia` | Start playing specific media on client. |
| GET | `/player/playback/refreshPlayQueue` | Refresh the current play queue. |
| GET | `/player/navigation/back` | Navigate back on client UI. |
| GET | `/player/navigation/home` | Navigate to home screen. |
| GET | `/player/navigation/moveUp/Down/Left/Right` | D-pad navigation. |
| GET | `/player/navigation/select` | Select current item. |
| GET | `/player/navigation/toggleOSD` | Toggle on-screen display. |
| GET | `/player/timeline/poll` | Poll client playback state. |

---

### Playlist Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/playlists` | List all playlists. Optional `?playlistType=video|audio|photo`. |
| POST | `/playlists` | Create a playlist. Params: `type`, `title`, `smart` (0/1), `uri`. |
| GET | `/playlists/{ratingKey}` | Get a single playlist's metadata. |
| PUT | `/playlists/{ratingKey}` | Update playlist (title, summary). |
| DELETE | `/playlists/{ratingKey}` | Delete a playlist. |
| GET | `/playlists/{ratingKey}/items` | List all items in a playlist. |
| PUT | `/playlists/{ratingKey}/items` | Add items to a playlist. Param: `uri` (Plex URI). |
| DELETE | `/playlists/{ratingKey}/items/{playlistItemID}` | Remove a specific item from a playlist. |
| DELETE | `/playlists/{ratingKey}/items` | Clear all items from a playlist. |
| PUT | `/playlists/{ratingKey}/items/{itemID}/moveAfter` | Reorder item (move after another item). |

**Playlist object fields:** ratingKey, key, guid, type, title, summary, smart, playlistType, composite, leafCount, duration, addedAt, updatedAt.

---

### Webhooks

Webhooks require **Plex Pass**. Configure at: Settings → Webhooks → Add Webhook.

Plex sends a multipart/form-data POST with a `payload` field containing JSON.

**Webhook event types:**

| Event | Description |
|-------|-------------|
| `media.play` | User starts playing an item. |
| `media.pause` | Playback paused. |
| `media.resume` | Playback resumed from pause. |
| `media.stop` | Playback stopped. |
| `media.scrobble` | Item marked as watched (90%+ played). |
| `media.rate` | User rates an item. |
| `library.on.deck` | Item added to On Deck. |
| `library.new` | New item added to a library. |
| `admin.database.backup` | Database backup completed. |
| `admin.database.corrupted` | Database corruption detected. |
| `device.new` | New device authorized. |
| `playback.started` | Playback session started (server-side). |

**Payload envelope:**
```json
{
  "event": "media.play",
  "user": true,
  "owner": true,
  "Account": { "id": 1, "thumb": "...", "title": "username" },
  "Server": { "title": "MyPlex", "uuid": "..." },
  "Player": { "local": true, "publicAddress": "...", "title": "AppleTV", "uuid": "..." },
  "Metadata": {
    "type": "episode",
    "title": "Episode Title",
    "grandparentTitle": "Show Name",
    "parentIndex": 1,
    "index": 5,
    "ratingKey": "12345",
    "thumb": "/library/metadata/12345/thumb/..."
  }
}
```

---

### Transcoding

| Method | Path | Description |
|--------|------|-------------|
| GET | `/video/:/transcode/universal/decision` | Determine if transcoding is needed. Params: `path`, `protocol` (hls/dash), `hasMDE`. |
| GET | `/video/:/transcode/universal/start.m3u8` | Start transcode and get HLS manifest. |
| GET | `/photo/:/transcode` | Resize/transcode images. Params: `url`, `width`, `height`, `minSize`, `upscale`. |

**TranscodeSession decision values:**
- `videoDecision`: `copy` (direct stream), `transcode`
- `audioDecision`: `copy`, `transcode`
- `protocol`: `http`, `hls`, `dash`

---

### Current Maisie Implementation (Plex)

**Implemented in** `/packages/agent/src/skills/media/plex-client.ts`:

| Method | Endpoint |
|--------|----------|
| `getServerInfo()` | `GET /` |
| `getLibraries()` | `GET /library/sections` |
| `getLibraryCount()` | `GET /library/sections/{key}/all` (size=0) |
| `getNowPlaying()` | `GET /status/sessions` |
| `getRecentlyAdded()` | `GET /library/recentlyAdded` |
| `searchShows()` | `GET /library/sections/{key}/all?type=2&title=` |
| `getShowEpisodes()` | `GET /library/metadata/{key}/allLeaves` |
| `getEpisodeFilePath()` | `GET /library/metadata/{key}` |
| `getPlaylists()` | `GET /playlists` |
| `getPlaylistItems()` | `GET /playlists/{key}/items` |
| `proxyImage()` | `GET {thumbPath}` |

**Not implemented (high value gaps):**
- Watch history (`/status/sessions/history/all`)
- Playback session management (terminate session/transcode)
- Client remote control (`/player/playback/*`)
- Collections CRUD
- Mark watched/unwatched (`/:/scrobble`)
- Update play progress (`/:/progress`)
- On Deck (`/library/onDeck`)
- Library scan trigger (`/library/sections/{key}/refresh`)
- Movie search by metadata (filtering `/library/sections/{key}/all?type=1`)
- Webhooks receiver (no current setup)

---

---

## Sonarr

### Authentication

**Base URL:** `http://{host}:8989/api/v3`
**Auth:** `X-Api-Key: {apiKey}` header on all requests.

API key is found in Sonarr → Settings → General → Security.

**Current version:** v3 is stable release. v4/v5 are in development (v5-develop branch). The OpenAPI spec is at `/api/v3/openapi.json` (served by the running instance).

**No WebSocket support.** All real-time notification is done via webhooks (push from Sonarr to a configured URL).

---

### Series Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/series` | List all series. Returns full series objects. |
| POST | `/series` | Add a series. Requires title, tvdbId, qualityProfileId, rootFolderPath, monitored. |
| GET | `/series/{id}` | Get a specific series by internal ID. |
| PUT | `/series/{id}` | Update a series (monitoring, profile, path, etc.). |
| DELETE | `/series/{id}` | Delete a series. Query param `deleteFiles=true` to also delete files. |
| PUT | `/series/editor` | Bulk update series (monitoring, quality profile, tags, etc.). |
| DELETE | `/series/bulk` | Bulk delete series. |
| GET | `/series/lookup` | Search for series by name or TVDB ID (`?term=Star+Trek` or `?term=tvdb:12345`). |

**Series object key fields:** id, title, sortTitle, status, overview, network, year, tvdbId, monitored, episodeCount, episodeFileCount, sizeOnDisk, qualityProfileId, rootFolderPath, path, images, seasons.

---

### Episode Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/episode` | List episodes. Filter by `seriesId`, `seasonNumber`, `episodeIds[]`. |
| GET | `/episode/{id}` | Get a specific episode. |
| PUT | `/episode/{id}` | Update episode (monitored flag). |
| PUT | `/episode/monitor` | Bulk update monitoring status. Body: `{ episodeIds: [], monitored: bool }`. |

**Episode object key fields:** id, seriesId, tvdbId, title, seasonNumber, episodeNumber, airDate, monitored, hasFile, episodeFileId.

---

### Episode File Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/episodefile` | List episode files. Filter by `seriesId` or `episodeFileIds[]`. |
| GET | `/episodefile/{id}` | Get a specific episode file. |
| PUT | `/episodefile/{id}` | Update file (quality override). |
| DELETE | `/episodefile/{id}` | Delete a single episode file from disk. |
| PUT | `/episodefile/editor` | Bulk update episode files. |
| DELETE | `/episodefile/bulk` | Bulk delete episode files. |

---

### Calendar Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/calendar` | Episodes airing within date range. Params: `start` (ISO date), `end` (ISO date), `includeSeries=true`, `includeEpisodeFile`, `unmonitored`, `tags[]`. |
| GET | `/calendar/{id}` | Get a specific calendar episode entry. |
| GET | `/feed/v3/calendar/sonarr.ics` | iCalendar feed export. Supports pastDays, futureDays, tags. |

---

### History Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/history` | Paginated history. Params: `page`, `pageSize`, `sortKey`, `sortDirection`, `eventType`, `seriesIds[]`, `episodeId`, `quality`, `languages[]`. |
| GET | `/history/since` | History since a timestamp. Params: `date` (ISO), `eventType`. |
| GET | `/history/series` | History for a specific series. Params: `seriesId`, `seasonNumber`, `eventType`. |
| POST | `/history/failed/{id}` | Mark a history item as failed (triggers blacklist + search retry). |

---

### Queue Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/queue` | Current download queue. Params: `pageSize`, `page`, `includeSeries=true`, `includeEpisode=true`, `includeUnknownSeriesItems`. |
| GET | `/queue/{id}` | Get a specific queue item. |
| DELETE | `/queue/{id}` | Remove from queue. Params: `removeFromClient=true`, `blocklist=true`. |
| POST | `/queue/grab` | Manually grab a release. Body: `{ id }`. |
| DELETE | `/queue/bulk` | Bulk remove queue items. |

---

### Wanted Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/wanted/missing` | Paginated list of episodes that are missing (aired, monitored, no file). |
| GET | `/wanted/cutoff` | Paginated list of episodes that exist but don't meet the quality cutoff. |

---

### Commands (Background Tasks)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/command` | List running/queued commands. |
| POST | `/command` | Execute a command. Body: `{ name, ...params }`. |
| GET | `/command/{id}` | Check command status. |
| DELETE | `/command/{id}` | Cancel a command. |

**Available command names:**

| Command | Params | Description |
|---------|--------|-------------|
| `RefreshSeries` | `seriesId` (optional) | Refresh metadata from TVDB. |
| `RescanSeries` | `seriesId` (optional) | Rescan files on disk. |
| `EpisodeSearch` | `episodeIds[]` | Search for specific episodes. |
| `SeasonSearch` | `seriesId`, `seasonNumber` | Search for all episodes in a season. |
| `SeriesSearch` | `seriesId` | Search for all missing episodes in a series. |
| `RenameFiles` | `seriesId`, `files[]` | Rename episode files per naming scheme. |
| `RenameSeries` | `seriesIds[]` | Rename all files for multiple series. |
| `Backup` | — | Create a backup. |
| `MissingEpisodeSearch` | — | Search for all missing monitored episodes. |
| `ApplicationUpdateCheck` | — | Check for Sonarr updates. |

---

### Indexer & Release Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/indexer` | List configured indexers. |
| POST | `/indexer` | Add indexer. |
| GET, PUT, DELETE | `/indexer/{id}` | CRUD for a specific indexer. |
| POST | `/indexer/test` | Test indexer connectivity. |
| GET | `/indexer/schema` | Available indexer types. |
| GET | `/release` | Search for releases. Params: `seriesId`, `seasonNumber`, `episodeId`, `indexerId`. |
| POST | `/release/push` | Push a release notification (from external indexer). |

---

### Download Client Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/downloadclient` | List download clients. |
| POST | `/downloadclient` | Add a download client. |
| GET, PUT, DELETE | `/downloadclient/{id}` | CRUD operations. |
| POST | `/downloadclient/test` | Test a client. |
| POST | `/downloadclient/testall` | Test all clients. |
| GET | `/downloadclient/schema` | Available client types. |

---

### Profiles & Configuration Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET, POST | `/qualityprofile` | List or create quality profiles. |
| GET, PUT, DELETE | `/qualityprofile/{id}` | CRUD for a profile. |
| GET | `/quality` | Available quality definitions. |
| GET, POST | `/languageprofile` | Language profiles (v3). |
| GET, PUT, DELETE | `/languageprofile/{id}` | CRUD. |
| GET, POST | `/customformat` | Custom quality format rules. |
| GET, PUT, DELETE | `/customformat/{id}` | CRUD. |
| GET, POST | `/delayprofile` | Release delay profiles. |
| GET, PUT, DELETE | `/delayprofile/{id}` | CRUD. |
| GET, PUT | `/config/host` | Host configuration (port, URL base, auth). |
| GET, PUT | `/config/mediamanagement` | File naming, folder, and import settings. |
| GET, PUT | `/config/downloadclient` | Download client global settings. |
| GET, PUT | `/config/indexer` | Indexer global settings. |
| GET, PUT | `/config/ui` | UI preferences. |
| GET, POST, DELETE | `/tag` | Tag management. |
| GET | `/language` | Available languages. |
| GET | `/rootfolder` | Configured root folder paths. |

---

### System Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/system/status` | Version, build time, OS, runtime info. |
| GET | `/health` | Health check items (warnings/errors). |
| GET | `/diskspace` | Disk usage for each root folder. |
| GET | `/system/backup` | List available backups. |
| POST | `/system/backup/restore/{id}` | Restore a backup. |
| GET | `/log` | Paginated application logs. Params: `page`, `pageSize`, `level`, `filterKey`. |
| GET | `/log/file` | List log files. |
| GET | `/filesystem` | Browse server filesystem. |
| GET | `/manualimport` | Analyze files for manual import. |
| POST | `/manualimport` | Complete a manual import. |
| GET | `/mediacover/{seriesId}/{filename}` | Serve series artwork. |
| GET | `/localization` | Localization strings. |
| GET | `/autotagging` | Auto-tagging rule management. |
| GET | `/customfilter` | Saved UI filters. |
| GET | `/blocklist` | Blocked releases (paginated). |
| DELETE | `/blocklist/{id}` | Remove from blocklist. |
| GET, POST | `/importlist` | Import list management. |
| GET, POST | `/importlistexclusion` | Managed exclusions. |
| GET | `/notification` | Notification connection list. |
| POST, PUT, DELETE | `/notification/{id}` | CRUD for notification connections. |
| POST | `/notification/test` | Test a notification connection. |

---

### Webhook Events

Configure at Settings → Connect → Webhook.

| Event | Trigger |
|-------|---------|
| `Test` | Manual test from UI. |
| `Grab` | Release grabbed (queued for download). |
| `Download` | Episode file imported. |
| `Rename` | Files renamed. |
| `SeriesAdd` | Series added to Sonarr. |
| `SeriesDelete` | Series deleted from Sonarr. |
| `EpisodeFileDelete` | Episode file deleted. |
| `Health` | Health check issue detected. |
| `HealthRestored` | Health check issue resolved. |
| `ApplicationUpdate` | Sonarr application updated. |
| `ManualInteractionRequired` | Download requires manual intervention. |

**Webhook payload envelope:**
```json
{
  "eventType": "Download",
  "instanceName": "Sonarr",
  "applicationUrl": "http://sonarr:8989",
  "series": { "id": 1, "title": "Breaking Bad", "tvdbId": 81189, ... },
  "episodes": [{ "id": 1, "seasonNumber": 1, "episodeNumber": 1, "title": "Pilot", ... }],
  "episodeFile": { "id": 1, "path": "/media/...", "quality": "HDTV-1080p", ... }
}
```

---

### Current Maisie Implementation (Sonarr)

**Implemented in** `/packages/agent/src/skills/media/sonarr-client.ts`:

| Method | Endpoint |
|--------|----------|
| `getSystemStatus()` | `GET /system/status` |
| `getCalendar()` | `GET /calendar` |
| `getQueue()` | `GET /queue` |
| `getSeries()` | `GET /series` |
| `getHealth()` | `GET /health` |
| `lookup()` | `GET /series/lookup` |
| `getRootFolders()` | `GET /rootfolder` |
| `getQualityProfiles()` | `GET /qualityprofile` |
| `getLanguageProfiles()` | `GET /languageprofile` |
| `addSeries()` | `POST /series` |

**Not implemented (high value gaps):**
- Episode listing and file management
- History (download history)
- Wanted/missing episodes
- Command execution (search, rename, rescan)
- Blocklist management
- Delete series/episode files
- Webhook receiver
- Notification connection management

---

---

## Radarr

### Authentication

**Base URL:** `http://{host}:7878/api/v3`
**Auth:** `X-Api-Key: {apiKey}` header on all requests.

API key is at Radarr → Settings → General → Security. Same pattern as Sonarr.

**No WebSocket support.** Uses webhooks for event notifications.

---

### Movie Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/movie` | List all movies. |
| POST | `/movie` | Add a movie. Requires title, tmdbId, qualityProfileId, rootFolderPath. |
| GET | `/movie/{id}` | Get a specific movie by internal ID. |
| PUT | `/movie/{id}` | Update movie metadata, monitoring, quality profile. |
| DELETE | `/movie/{id}` | Delete movie. Param: `deleteFiles=true`. |
| PUT | `/movie/editor` | Bulk edit movies (monitoring, tags, quality profile). |
| DELETE | `/movie/bulk` | Bulk delete movies. |
| POST | `/movie/import` | Import movie files from a path. |
| GET | `/movie/lookup` | Search by title or TMDB ID. `?term=Inception` or `?term=tmdb:27205`. |

**Movie object key fields:** id, title, sortTitle, status, overview, year, tmdbId, imdbId, monitored, hasFile, sizeOnDisk, qualityProfileId, rootFolderPath, path, images, movieFile.

---

### Movie File Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/moviefile` | List movie files. Filter by `movieId` or `movieFileIds[]`. |
| GET | `/moviefile/{id}` | Get a specific file. |
| PUT | `/moviefile/{id}` | Update file quality. |
| DELETE | `/moviefile/{id}` | Delete file from disk. |
| PUT | `/moviefile/editor` | Bulk update files. |
| DELETE | `/moviefile/bulk` | Bulk delete files. |
| GET | `/extrafile` | Extra files for a movie (subtitles, etc.). Param: `movieId`. |

---

### Collections Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/collection` | List collections. Filter by `tmdbId`. |
| GET | `/collection/{id}` | Get collection details (includes all movies in the collection). |
| PUT | `/collection` | Bulk update collections (monitoring, quality profile). |
| PUT | `/collection/{id}` | Update a single collection. |

---

### Calendar Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/calendar` | Movies with digital/physical release in date range. Params: `start`, `end`, `unmonitored`, `tags[]`. |
| GET | `/feed/v3/calendar/radarr.ics` | iCalendar feed. Params: `pastDays`, `futureDays`, `tags[]`, `releaseType` (inCinemas/digital/physical). |

---

### History Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/history` | Paginated download/grab history. Params: `page`, `pageSize`, `sortKey`, `movieId`, `eventType`, `downloadId`. |
| GET | `/history/since` | History since timestamp. Params: `date`, `eventType`. |
| GET | `/history/movie` | History for a specific movie. Param: `movieId`. |
| POST | `/history/failed/{id}` | Mark history item as failed. |

---

### Queue Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/queue` | Current download queue. Params: `pageSize`, `page`, `includeMovie=true`, `includeUnknownMovieItems`. |
| GET | `/queue/{id}` | Get a specific queue item. |
| DELETE | `/queue/{id}` | Remove from queue. Params: `removeFromClient`, `blocklist`. |
| DELETE | `/queue/bulk` | Bulk remove. |

---

### Wanted Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/wanted/missing` | Paginated list of missing monitored movies. |
| GET | `/wanted/cutoff` | Paginated list of movies below quality cutoff. |

---

### Commands (Background Tasks)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/command` | List running commands. |
| POST | `/command` | Execute a command. |
| GET | `/command/{id}` | Check status. |
| DELETE | `/command/{id}` | Cancel. |

**Available command names:**

| Command | Params | Description |
|---------|--------|-------------|
| `RefreshMovie` | `movieIds[]` (optional) | Refresh metadata from TMDB. |
| `RescanMovie` | `movieId` (optional) | Rescan files on disk. |
| `MoviesSearch` | `movieIds[]` | Search for specific movies. |
| `MissingMoviesSearch` | — | Search for all missing monitored movies. |
| `RenameFiles` | `movieId`, `files[]` | Rename movie files. |
| `RenameMovie` | `movieIds[]` | Rename files for movies. |
| `Backup` | — | Create a backup. |
| `ApplicationUpdateCheck` | — | Check for Radarr updates. |

---

### Alternative Titles & Credits

| Method | Path | Description |
|--------|------|-------------|
| GET | `/alttitle` | Alternative titles. Filter by `movieId` or `movieMetadataId`. |
| GET | `/alttitle/{id}` | Specific alternative title. |
| GET | `/credit` | Cast/crew credits. Filter by `movieId` or `movieMetadataId`. |
| GET | `/credit/{id}` | Specific credit. |
| GET | `/indexerflag` | Available indexer flags. |

---

### Profiles & Configuration Endpoints

Same pattern as Sonarr:

| Method | Path | Description |
|--------|------|-------------|
| GET, POST | `/qualityprofile` | List or create quality profiles. |
| GET, PUT, DELETE | `/qualityprofile/{id}` | CRUD. |
| GET, POST | `/customformat` | Custom format rules. |
| GET, PUT, DELETE | `/customformat/{id}` | CRUD. |
| PUT, DELETE | `/customformat/bulk` | Bulk operations. |
| GET, POST | `/delayprofile` | Delay profiles. |
| PUT | `/delayprofile/reorder/{id}` | Reorder delay profile priority. |
| GET, POST | `/releaseprofile` | Release profiles (preferred/ignored words). |
| GET, PUT, DELETE | `/releaseprofile/{id}` | CRUD. |
| GET, PUT | `/config/host` | Host settings. |
| GET, PUT | `/config/mediamanagement` | File/folder settings. |
| GET, PUT | `/config/importlist` | Import list settings. |
| GET, PUT | `/config/downloadclient` | Download client settings. |
| GET, PUT | `/config/indexer` | Indexer settings. |
| GET, PUT | `/config/ui` | UI preferences. |
| GET, POST, DELETE | `/tag` | Tags. |
| DELETE | `/tag/bulk` | Bulk delete tags. |
| GET | `/rootfolder` | Root folder paths. |
| GET | `/language` | Available languages. |

---

### System Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/system/status` | Version, build, runtime, OS. |
| GET | `/health` | Health check items. |
| GET | `/diskspace` | Disk usage. |
| GET | `/system/backup` | List backups. |
| DELETE | `/system/backup/{id}` | Delete backup. |
| POST | `/system/backup/restore/{id}` | Restore backup. |
| POST | `/system/backup/restore/upload` | Upload and restore backup. |
| GET | `/system/timezone` | List timezones. |
| GET | `/log` | Application logs. |
| GET | `/log/file` | Log file list. |
| GET | `/log/file/{filename}` | Download specific log file. |
| GET | `/filesystem` | Browse filesystem. |
| GET | `/filesystem/type` | Determine if path is file or directory. |
| GET | `/filesystem/mediafiles` | List media files at a path. |
| GET | `/localization` | Localization strings. |
| GET | `/localization/language` | Language info. |
| GET, POST, DELETE | `/notification` | Notification connections. |
| POST | `/notification/test` | Test a notification. |
| GET, POST | `/importlist` | Import list sources (Trakt, Letterboxd, etc.). |
| GET, POST | `/exclusions` | Import list exclusions. |
| GET, POST | `/indexer` | Configured indexers. |
| GET | `/indexer/schema` | Available indexer types. |
| GET, POST | `/downloadclient` | Download clients. |
| GET | `/downloadclient/schema` | Available download client types. |
| GET, POST | `/customfilter` | Saved UI filters. |
| GET | `/blocklist` | Blocked releases. |
| DELETE | `/blocklist/{id}` | Remove from blocklist. |
| GET | `/autotagging` | Auto-tagging rules. |

---

### Webhook Events

Configure at Settings → Connect → Webhook.

| Event | Trigger |
|-------|---------|
| `Test` | Manual test from UI. |
| `Grab` | Release grabbed for download. |
| `Download` | Movie file imported (or upgraded). |
| `Rename` | Movie files renamed. |
| `MovieAdded` | Movie added to Radarr. |
| `MovieDelete` | Movie removed from Radarr. |
| `MovieFileDelete` | Movie file deleted. |
| `Health` | Health issue detected. |
| `HealthRestored` | Health issue resolved. |
| `ApplicationUpdate` | Radarr updated. |
| `ManualInteractionRequired` | Download stuck, needs manual action. |

---

### Current Maisie Implementation (Radarr)

**Implemented in** `/packages/agent/src/skills/media/radarr-client.ts`:

| Method | Endpoint |
|--------|----------|
| `getSystemStatus()` | `GET /system/status` |
| `getCalendar()` | `GET /calendar` |
| `getQueue()` | `GET /queue` |
| `getMovies()` | `GET /movie` |
| `getHealth()` | `GET /health` |
| `lookup()` | `GET /movie/lookup` |
| `getRootFolders()` | `GET /rootfolder` |
| `getQualityProfiles()` | `GET /qualityprofile` |
| `addMovie()` | `POST /movie` |

**Not implemented (high value gaps):**
- Movie file management (delete files, bulk operations)
- History (download history per movie)
- Wanted/missing movies
- Command execution (search, rescan, rename)
- Collections management
- Alternative titles, credits
- Blocklist management
- Delete movies
- Webhook receiver
- Import list management

---

---

## Prowlarr

### Authentication

**Base URL:** `http://{host}:9696/api/v1`
**Auth:** `X-Api-Key: {apiKey}` header on all requests.

API key is at Prowlarr → Settings → General → Security.

**No WebSocket support.** Uses webhooks for event notifications.

---

### Search Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/search` | Search across indexers. Params: `query`, `type` (search/tvsearch/movie/music/book), `indexerIds[]`, `categories[]`, `limit`, `offset`. |
| POST | `/search` | Search via POST body. |
| POST | `/search/bulk` | Bulk search request. |
| GET | `/indexer/{id}/newznab` | Newznab-compatible search for a specific indexer. Full Newznab query params: `t` (search type), `q`, `season`, `ep`, `cat`, `imdbid`, `tvdbid`, `tmdbid`, `limit`, `offset`. |
| GET | `/{id}/api` | Alternative Newznab endpoint (short form). |
| GET | `/indexer/{id}/download` | Download a torrent/NZB. Params: `link`, `file`. |
| GET | `/{id}/download` | Alternative download endpoint. |

**Search result fields:** guid, title, size, seeders, leechers, indexer, indexerId, downloadUrl, infoUrl, publishDate, categories[].

---

### Indexer Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/indexer` | List all configured indexers. |
| POST | `/indexer` | Add an indexer. Param: `forceSave=true` to bypass validation. |
| GET | `/indexer/{id}` | Get a specific indexer. |
| PUT | `/indexer/{id}` | Update an indexer. |
| DELETE | `/indexer/{id}` | Remove an indexer. |
| PUT | `/indexer/bulk` | Bulk update indexers. |
| DELETE | `/indexer/bulk` | Bulk delete indexers. |
| GET | `/indexer/schema` | Available indexer types and their field definitions. |
| POST | `/indexer/test` | Test indexer connectivity. Param: `forceTest=true`. |
| POST | `/indexer/testall` | Test all configured indexers. |
| POST | `/indexer/action/{name}` | Execute an indexer-specific action (e.g., captcha solve). |
| GET | `/indexer/categories` | List default indexer categories. |
| GET | `/indexerstats` | Performance stats per indexer. Params: `startDate`, `endDate`, `indexers[]`, `protocols[]`, `tags[]`. |
| GET | `/indexerstatus` | Current status of all indexers (last error, disabled until, etc.). |

---

### Indexer Proxy Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/indexerproxy` | List configured proxies (HTTP, SOCKS5, FlareSolverr). |
| POST | `/indexerproxy` | Add a proxy. |
| GET, PUT, DELETE | `/indexerproxy/{id}` | CRUD. |
| GET | `/indexerproxy/schema` | Available proxy types. |
| POST | `/indexerproxy/test` | Test proxy. |
| POST | `/indexerproxy/testall` | Test all proxies. |

---

### Application (Connected Apps) Endpoints

Applications are downstream services that Prowlarr syncs indexers to (Sonarr, Radarr, Readarr, etc.).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/applications` | List connected applications. |
| POST | `/applications` | Add an application. |
| GET, PUT, DELETE | `/applications/{id}` | CRUD. |
| PUT | `/applications/bulk` | Bulk update. |
| DELETE | `/applications/bulk` | Bulk delete. |
| GET | `/applications/schema` | Available application types. |
| POST | `/applications/test` | Test a connection. |
| POST | `/applications/testall` | Test all connections. |
| POST | `/applications/action/{name}` | Execute custom action (e.g., sync indexers now). |
| GET | `/appprofile` | App sync profiles (which indexers sync to which apps). |
| POST | `/appprofile` | Create a sync profile. |
| GET, PUT, DELETE | `/appprofile/{id}` | CRUD. |

---

### History Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/history` | Paginated search/grab history. Params: `page`, `pageSize`, `sortKey`, `sortDirection`, `eventType`, `successful`, `downloadId`, `indexerIds[]`. |
| GET | `/history/since` | History since timestamp. Params: `date`, `eventType`. |
| GET | `/history/indexer` | History for a specific indexer. Params: `indexerId`, `eventType`, `limit`. |

---

### Download Client Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/downloadclient` | List download clients. |
| POST | `/downloadclient` | Add a download client. |
| GET, PUT, DELETE | `/downloadclient/{id}` | CRUD. |
| PUT, DELETE | `/downloadclient/bulk` | Bulk operations. |
| GET | `/downloadclient/schema` | Available client types. |
| POST | `/downloadclient/test` | Test a client. |
| POST | `/downloadclient/testall` | Test all. |
| POST | `/downloadclient/action/{name}` | Execute action. |

---

### Notification Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notification` | List notification connections. |
| POST | `/notification` | Add a notification connection. |
| GET, PUT, DELETE | `/notification/{id}` | CRUD. |
| GET | `/notification/schema` | Available notification types. |
| POST | `/notification/test` | Test. |
| POST | `/notification/testall` | Test all. |
| POST | `/notification/action/{name}` | Execute action. |

---

### System & Configuration Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/system/status` | Version, build, OS, runtime. |
| GET | `/health` | Health check items. |
| GET | `/system/task` | Scheduled task list. |
| GET | `/system/task/{id}` | Specific task info. |
| GET | `/system/backup` | List backups. |
| POST | `/system/backup/restore/{id}` | Restore backup. |
| POST | `/system/backup/restore/upload` | Upload and restore. |
| DELETE | `/system/backup/{id}` | Delete backup. |
| POST | `/system/restart` | Restart Prowlarr. |
| POST | `/system/shutdown` | Shutdown Prowlarr. |
| GET | `/system/routes` | List all registered routes. |
| GET | `/config/host` | Host configuration. |
| PUT | `/config/host/{id}` | Update host config. |
| GET | `/config/ui` | UI preferences. |
| PUT | `/config/ui/{id}` | Update UI prefs. |
| GET | `/config/downloadclient` | Download client config. |
| PUT | `/config/downloadclient/{id}` | Update. |
| GET | `/tag` | List tags. |
| POST | `/tag` | Create tag. |
| GET, PUT, DELETE | `/tag/{id}` | CRUD. |
| GET | `/tag/detail` | Tags with associated item counts. |
| GET | `/log` | Application logs. |
| GET | `/log/file` | Log files list. |
| GET | `/log/file/{filename}` | Download log file. |
| GET | `/log/file/update` | Update log list. |
| GET | `/filesystem` | Browse filesystem. |
| GET | `/filesystem/type` | Path type detection. |
| GET | `/localization` | Localization strings. |
| GET | `/localization/options` | Localization options. |
| GET | `/update` | Available updates. |
| GET | `/customfilter` | Saved UI filters. |
| GET | `/ping` | Health check (no auth required). |

---

### Webhook Events

Configure at Settings → Connect → Webhook.

| Event | Trigger |
|-------|---------|
| `Test` | Manual test from UI. |
| `Grab` | Release grabbed (sent to download client). |
| `Download` | File downloaded and processed. |
| `Rename` | Files renamed. |
| `Health` | Health issue detected. |
| `HealthRestored` | Health issue resolved. |
| `ApplicationUpdate` | Prowlarr updated. |

---

### Current Maisie Implementation (Prowlarr)

**Implemented in** `/packages/agent/src/skills/media/prowlarr-client.ts`:

| Method | Endpoint |
|--------|----------|
| `searchAudiobooks()` | `GET /search?categories=3030&indexerIds=1` |

**Not implemented (high value gaps):**
- General search across all categories (`/search` without hardcoded category)
- Indexer management (list, add, test, stats)
- Application sync management
- History
- System status
- Notification management

---

---

## Gap Analysis

### Priority Additions for Maisie

The table below identifies the highest-value endpoints not yet covered, ranked by utility for a home AI agent.

#### Plex

| Priority | Endpoint | Use Case |
|----------|----------|----------|
| High | `GET /status/sessions/history/all` | "What has the family watched lately?" |
| High | `GET /library/onDeck` | "What should I watch next?" |
| High | `GET /:/scrobble` + `/:/unscrobble` | Agent marks items watched/unwatched. |
| High | Webhook receiver | React to play/stop/scrobble without polling. |
| Medium | `DELETE /transcode/sessions/{key}` | Kill a runaway transcode. |
| Medium | `GET /library/sections/{key}/all?type=1` | AI-driven movie discovery/filtering. |
| Medium | Client remote control (`/player/playback/*`) | "Pause the TV in the living room." |
| Low | Collections CRUD | Collection management. |
| Low | `POST /playQueues` | Queue up a playlist on a device. |

#### Sonarr

| Priority | Endpoint | Use Case |
|----------|----------|----------|
| High | `GET /wanted/missing` | "What episodes am I missing?" |
| High | `POST /command` (EpisodeSearch, SeriesSearch) | Trigger searches on-demand. |
| High | `GET /history` | "What was recently downloaded?" |
| High | Webhook receiver | React to grabs/imports without polling. |
| Medium | `DELETE /series/{id}` | Remove a show. |
| Medium | `GET /episode` + `PUT /episode/monitor` | Manage episode monitoring. |
| Medium | `DELETE /episodefile/{id}` | Clean up bad files. |
| Low | `GET /blocklist` + `DELETE` | Manage blocked releases. |

#### Radarr

| Priority | Endpoint | Use Case |
|----------|----------|----------|
| High | `GET /wanted/missing` | "What movies am I missing?" |
| High | `POST /command` (MoviesSearch) | Trigger movie search. |
| High | `GET /history` | "What was recently downloaded?" |
| High | Webhook receiver | React to grabs/imports. |
| Medium | `DELETE /movie/{id}` | Remove a movie. |
| Medium | `GET /collection` | Browse movie collections. |
| Medium | `DELETE /moviefile/{id}` | Clean up bad files. |
| Low | `GET /credit` | Cast/crew lookups. |

#### Prowlarr

| Priority | Endpoint | Use Case |
|----------|----------|----------|
| High | `GET /search` (general) | Universal search across all indexers, all categories. |
| High | `GET /indexerstats` | "Which indexers are working well?" |
| High | `GET /indexerstatus` | Detect down/erroring indexers. |
| Medium | `POST /applications/action/{name}` | Force sync indexers to Sonarr/Radarr. |
| Medium | `GET /history` | Search history audit. |
| Low | Indexer CRUD | Add/remove indexers via AI. |

### Shared Patterns

All four services follow the same conventions — these apply universally:
- Auth: `X-Api-Key` header
- Pagination: `page` + `pageSize` query params
- Bulk ops: `PUT /resource/bulk` + `DELETE /resource/bulk`
- Commands/tasks: `POST /command` with `{ name, ...params }`
- Test endpoints: `POST /resource/test` and `POST /resource/testall`
- Schema discovery: `GET /resource/schema` returns available types and their field definitions

### Real-Time Summary

None of the four services offer WebSocket or SSE for external consumers. All real-time integration must use either:
1. **Webhooks** — all four support outbound HTTP POST on events (Plex requires Plex Pass)
2. **Polling** — the current Maisie approach

For the AI agent, a webhook receiver endpoint in the agent API would allow instant reaction to: new downloads completing (Sonarr/Radarr → auto-add to Plex watch list), plays starting (Plex → log activity), and indexer failures (Prowlarr → notify).
