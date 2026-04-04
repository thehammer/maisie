# Devices and Tools API Catalog

Reference for all external APIs and tools used in Maisie. Covers protocol details,
endpoint signatures, authentication, and known gotchas.

---

## Table of Contents

1. [HDHomeRun PRIME](#hdhr-prime)
2. [Bambu X1C Printer](#bambu-x1c)
3. [Calibre](#calibre)
4. [DAKboard](#dakboard)
5. [go2rtc](#go2rtc)
6. [Tokyo Server (SSH/Shell)](#tokyo-server)

---

## HDHomeRun PRIME {#hdhr-prime}

HDHomeRun PRIME is a CableCARD network tuner. It exposes a simple HTTP API
for discovery, lineup management, and stream access.

### Discovery

#### SSDP

The device broadcasts via SSDP on UDP port 1900 and responds to M-SEARCH
requests for `urn:schemas-upnp-org:device:MediaServer:1` and
`urn:silicondust-com:device:SiliconDustDevice:1`. The LOCATION header in the
response points to the device description URL.

#### HTTP Discovery Endpoints

**`GET /discover.json`** — Primary discovery (used by Plex, Maisie EPG)

```json
{
  "FriendlyName": "HDHomeRun PRIME",
  "Manufacturer": "Silicondust",
  "ModelNumber": "HDHR3-CC",
  "FirmwareName": "hdhomerun3_atsc",
  "FirmwareVersion": "20230601",
  "DeviceID": "XXXXXXXX",
  "DeviceAuth": "YYYYYYYY",
  "BaseURL": "http://192.168.1.x",
  "LineupURL": "http://192.168.1.x/lineup.json",
  "TunerCount": 3
}
```

`DeviceAuth` is the token used to authenticate against the SiliconDust guide API
(`https://ipv4-api.hdhomerun.com/api/guide?DeviceAuth=<token>`). It is specific
to the device and the CableCARD market.

**`GET /device.xml`** — UPnP device description (XML). Includes manufacturer
info, device type URNs, and service list. Used by UPnP clients.

### Lineup

**`GET /lineup.json`** — Full channel lineup as JSON array

```json
[
  {
    "GuideNumber": "2",
    "GuideName": "WBBMDT",
    "URL": "http://192.168.1.x:5004/auto/v2",
    "DRM": 0
  }
]
```

Fields:
- `GuideNumber` — channel number as string (e.g. `"2"`, `"850"`)
- `GuideName` — call sign or channel name
- `URL` — direct MPEG-TS stream URL for this channel
- `DRM` — `1` if the channel is CableCARD DRM-protected (streams will fail)

**`GET /lineup_status.json`** — Scan/source status

```json
{
  "ScanInProgress": 0,
  "ScanPossible": 1,
  "Source": "Cable",
  "SourceList": ["Cable"]
}
```

**`POST /lineup.post`** — Trigger a channel scan. Body is form-encoded:
`scan=start` or `scan=abort`. Returns `{"ScanInProgress": 1}` while scanning.

### Streaming

**`GET /auto/v{channel}`** — Tune to channel and return MPEG-TS stream. This is
the canonical tuning URL that Plex uses. No session management — the device
handles tuner allocation automatically.

```
http://192.168.1.x:5004/auto/v2        # tune cable channel 2
http://192.168.1.x:5004/auto/v850      # tune cable channel 850
```

The PRIME delivers raw MPEG-TS. The device uses port 5004 for streams
regardless of the management port (80).

Stream characteristics:
- Container: MPEG-TS
- Video: usually H.264 or MPEG-2 depending on channel
- Audio: AC-3 (Dolby) on most cable channels
- DRM channels return a valid stream that players reject — check `DRM` field
  before tuning
- Channel 183 (WCIU) and some cable channels may produce MPEG-TS that ffmpeg
  cannot parse; exclude them from the lineup

### Tuner Status

**`GET /tuner{n}/status`** (where n = 0, 1, 2) — Per-tuner status

```json
{
  "Resource": "cable",
  "VirtualChannel": "2",
  "Name": "WBBMDT",
  "Modulation": "qam256",
  "Frequency": 453000000,
  "SignalStrength": 84,
  "SymbolQuality": 100,
  "NetworkError": 0,
  "PacketError": 0
}
```

Returns empty if the tuner is idle.

**`GET /tuner{n}/vstatus`** — Virtual channel status (stream-level info). Shows
PCR lock, bytes per second, etc.

### SiliconDust Guide API

The free cloud guide API associated with the PRIME device:

```
GET https://ipv4-api.hdhomerun.com/api/guide?DeviceAuth=<token>
```

Response is an array of channel objects, each with a `Guide` array:

```json
[
  {
    "GuideNumber": "2",
    "GuideName": "WBBMDT",
    "ImageURL": "https://...",
    "Guide": [
      {
        "Title": "CBS Mornings",
        "EpisodeTitle": "...",
        "Synopsis": "...",
        "StartTime": 1712000000,
        "EndTime": 1712003600,
        "ImageURL": "https://...",
        "SeriesID": "...",
        "EpisodeNumber": "S2024E04",
        "Filter": ["News"]
      }
    ]
  }
]
```

Notes:
- Free tier returns approximately 4 hours of data per request. Maisie refreshes
  every 30 minutes and accumulates up to 12 hours of history.
- Requesting `?hours=336` does not give more data on the free tier; it is used
  to signal intent for when extended guide data is available.
- The `DeviceAuth` token is fetched from `/discover.json` on the local device.

### Known Limitations / Gotchas

- DRM channels: check `DRM: 1` in lineup before tuning — the stream will play
  but content will be garbled
- ffmpeg MPEG-TS parsing issues on some channels (e.g., WCIU channel 183) —
  maintain an exclusion list
- The PRIME has 3 physical tuners; a fourth concurrent tune will fail with no
  clean error
- Maisie proxies PRIME streams through ffmpeg (`-c copy -f mpegts`) to add
  resend_headers and normalize the transport stream

---

## Bambu X1C Printer {#bambu-x1c}

The Bambu X1C uses MQTT over TLS for all communication. There is no HTTP API
for printer control — all commands and status updates go through MQTT.

### Connection

| Parameter | Value |
|-----------|-------|
| Protocol | MQTT over TLS (`mqtts://`) |
| Port | 8883 |
| Username | `bblp` (fixed) |
| Password | Access code (shown in printer Settings → Network) |
| MQTT version | 3.1.1 |
| TLS | Self-signed cert — use `rejectUnauthorized: false` |
| Reconnect | 30 second interval recommended |

```typescript
mqtt.connect(`mqtts://${BAMBU_HOST}:8883`, {
  username: "bblp",
  password: BAMBU_ACCESS_CODE,
  rejectUnauthorized: false,
  protocolVersion: 4,
})
```

### MQTT Topics

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `device/{serial}/report` | Subscribe | All printer status pushes |
| `device/{serial}/request` | Publish | All commands |

The serial number is the device serial visible in Bambu Studio and on the
printer's Settings → Network page.

### Status Messages (report topic)

The printer publishes JSON to `device/{serial}/report`. Every message has a
top-level key indicating the message type.

**Print status** (`print` key) — published periodically and after any state change:

```json
{
  "print": {
    "gcode_state": "RUNNING",
    "mc_percent": 47,
    "mc_remaining_time": 83,
    "subtask_name": "benchy.3mf",
    "nozzle_temper": 219.5,
    "nozzle_target_temper": 220,
    "bed_temper": 60.1,
    "bed_target_temper": 60,
    "chamber_temper": 32,
    "spd_lvl": 2,
    "wifi_signal": "-55dBm",
    "layer_num": 124,
    "ams": {
      "ams": [
        {
          "id": "0",
          "tray": [
            {
              "id": "0",
              "tray_type": "PLA",
              "tray_color": "FF4444FF"
            }
          ]
        }
      ]
    },
    "hms": []
  }
}
```

**`gcode_state` values:**

| Value | Meaning |
|-------|---------|
| `IDLE` | No active job |
| `RUNNING` | Actively printing |
| `PAUSE` | Job paused |
| `FINISH` | Job completed successfully |
| `FAILED` | Job failed |
| `SLICING` | Slicing in progress (cloud print) |
| `PREPARE` | Pre-print preparation |

**`spd_lvl` values** (speed level):

| Value | Speed |
|-------|-------|
| 1 | Silent |
| 2 | Standard |
| 3 | Sport |
| 4 | Ludicrous |

**HMS codes** (`hms` array) — hardware/motion/system alerts:

```json
{
  "hms": [
    {
      "attr": 50528769,
      "code": 65537
    }
  ]
}
```

HMS codes are Bambu Lab proprietary. Common codes:
- `0x05000001` — filament runout
- `0x07000001` — nozzle clog
- `0x0C000001` — AMS filament jam
- Full decode table: https://wiki.bambulab.com/en/x1/troubleshooting/hmscode

**AMS status** — nested inside `print.ams.ams[]`. Each unit has `tray[]` entries:

| Field | Description |
|-------|-------------|
| `id` | Tray slot number (string, 0-indexed) |
| `tray_type` | Filament type: `PLA`, `PETG`, `ABS`, `TPU`, etc. |
| `tray_color` | RGBA hex string e.g. `"FF4444FF"` |
| `tray_sub_brands` | Brand sub-type if Bambu filament |

Empty tray: `tray_type` will be absent or empty string.

### Commands (request topic)

All commands are JSON published to `device/{serial}/request`.

**Request full status push:**
```json
{
  "pushing": {
    "sequence_id": "0",
    "command": "pushall"
  }
}
```
Call this after connecting to get an immediate full status snapshot. The printer
will respond with a complete `print` message on the report topic.

**Pause print:**
```json
{
  "print": {
    "sequence_id": "0",
    "command": "pause"
  }
}
```

**Resume print:**
```json
{
  "print": {
    "sequence_id": "0",
    "command": "resume"
  }
}
```

**Stop/cancel print:**
```json
{
  "print": {
    "sequence_id": "0",
    "command": "stop"
  }
}
```

**Set speed level:**
```json
{
  "print": {
    "sequence_id": "0",
    "command": "print_speed",
    "param": "2"
  }
}
```
`param` is the speed level string: `"1"` through `"4"`.

**Set fan speed:**
```json
{
  "print": {
    "sequence_id": "0",
    "command": "gcode_line",
    "param": "M106 P1 S200\n"
  }
}
```
Uses raw G-code. Fan indices: P1=part cooling, P2=auxiliary, P3=chamber.
Speed range 0-255.

**Send arbitrary G-code:**
```json
{
  "print": {
    "sequence_id": "0",
    "command": "gcode_line",
    "param": "G28\n"
  }
}
```

**Start a print from local file** (advanced — requires full task setup via
Bambu Connect API, not available on local MQTT alone):
Starting a new print from a file programmatically requires the Bambu cloud API
or Bambu Studio. The local MQTT API only supports control of already-running
jobs.

### Camera Stream

The X1C has an RTSP camera stream accessible on the local network:

```
rtsps://bblp:{ACCESS_CODE}@{PRINTER_HOST}:322/streaming/live/1?BackChannel=0
```

- Protocol: RTSPS (RTSP over TLS)
- Port: 322
- Credentials: same as MQTT (`bblp` / access code)
- Resolution: 1920×1080 at ~15fps
- Codec: H.264
- TLS: self-signed cert — connect with `rejectUnauthorized: false`

go2rtc config:
```yaml
streams:
  bambu_printer:
    - rtsps://bblp:{ACCESS_CODE}@{HOST}:322/streaming/live/1?BackChannel=0
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `BAMBU_HOST` | Printer LAN IP |
| `BAMBU_SERIAL` | Device serial number |
| `BAMBU_ACCESS_CODE` | 8-character access code |

---

## Calibre {#calibre}

Calibre provides two interfaces: the Content Server HTTP API and the `calibredb`
CLI. Maisie uses both — Content Server for read-heavy search/browse operations,
`calibredb` via Docker exec for write operations (add, metadata updates).

### Content Server HTTP API

The Calibre Content Server runs on port 8081 (configurable). All endpoints are
unauthenticated when running locally without a password.

Base URL: `http://{host}:8081`

#### Library Info

**`GET /ajax/library-info`**

```json
{
  "library_map": {
    "Calibre_Library": "Calibre Library",
    "SciFi": "Sci-Fi Collection"
  },
  "default_library": "Calibre_Library",
  "total_num": 1
}
```

`library_map` keys are library IDs (used in subsequent calls), values are display names.

#### Search

**`GET /ajax/search`** — Search books in a library

Query parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `query` | `""` | Calibre search expression |
| `num` | 50 | Results per page |
| `offset` | 0 | Pagination offset |
| `sort` | `"timestamp"` | Sort field |
| `sort_order` | `"desc"` | `"asc"` or `"desc"` |
| `library_id` | default | Library ID from library-info |

```json
{
  "total_num": 1423,
  "num_books_without_search": 1423,
  "offset": 0,
  "num": 50,
  "sort": "timestamp",
  "sort_order": "desc",
  "sort_key": null,
  "library_id": "Calibre_Library",
  "book_ids": [559, 558, 557, ...]
}
```

Calibre search syntax examples:
- `authors:"Name"` — exact author search
- `title:"Word"` — title contains word
- `tags:"Science Fiction"` — tag search
- `series:"Dune"` — series search
- `rating:>3` — rating comparison
- `#custom_col:value` — custom column search
- `not tags:"Read"` — negation
- `authors:"Tolkien" and tags:"Fantasy"` — boolean AND

#### Book Metadata

**`GET /ajax/book/{id}/{library_id}`** — Single book

**`GET /ajax/books/{library_id}?ids={id1,id2,...}`** — Batch book fetch

Returns a map of `{ "{id}": BookObject }`:

```json
{
  "559": {
    "application_id": 559,
    "title": "The Left Hand of Darkness",
    "title_sort": "Left Hand of Darkness, The",
    "authors": ["Ursula K. Le Guin"],
    "author_sort": "Le Guin, Ursula K.",
    "publisher": "Ace",
    "series": null,
    "series_index": null,
    "tags": ["Science Fiction", "Hugo Award"],
    "rating": 8,
    "languages": ["eng"],
    "formats": ["EPUB", "MOBI"],
    "identifiers": {
      "isbn": "9780441478125",
      "goodreads": "18423"
    },
    "pubdate": "1969-03-01",
    "timestamp": "2024-01-15T10:22:00+00:00",
    "last_modified": "2024-01-15T10:22:00+00:00",
    "comments": "Hugo and Nebula award winning novel...",
    "cover": "/get/cover/559/Calibre_Library",
    "uuid": "a1b2c3d4-..."
  }
}
```

`rating` is 0–10 (Calibre stores half-star ratings as integers 0–10).
`formats` contains uppercase format names: `EPUB`, `MOBI`, `PDF`, `AZW3`, `CBZ`, etc.

#### Cover Images

**`GET /get/cover/{id}/{library_id}`** — Full cover image (JPEG)

**`GET /get/thumb/{id}/{library_id}`** — Thumbnail (resized JPEG, default 60×80)

Optional size: `GET /get/thumb/{id}/{library_id}?sz=300x400`

#### File Download

**`GET /get/{format}/{id}/{library_id}`** — Download book file

```
GET /get/EPUB/559/Calibre_Library
GET /get/MOBI/559/Calibre_Library
```

Returns the file with appropriate Content-Type.

#### Categories (Browse API)

**`GET /ajax/categories/{library_id}`** — List all tag browser categories

```json
[
  {
    "name": "Authors",
    "url": "/ajax/category/617574686f7273/Calibre_Library",
    "icon": "user.png",
    "is_category": true
  }
]
```

The URL path segment is the hex-encoded category name.

**`GET /ajax/category/{hex}/{library_id}`** — List items in a category

Query params: `num` (max items, default 100), `offset`

```json
{
  "total_num": 342,
  "offset": 0,
  "num": 100,
  "sort": "name",
  "sort_order": "asc",
  "items": [
    {
      "name": "Adams, Douglas",
      "count": 5,
      "url": "/ajax/category/617574686f7273/Adams%2C+Douglas/Calibre_Library",
      "average_rating": 9.0,
      "sort": "Adams, Douglas"
    }
  ]
}
```

Known category hex codes:

| Category | Hex |
|----------|-----|
| authors | `617574686f7273` |
| tags | `74616773` |
| series | `736572696573` |
| publisher | `7075626c6973686572` |
| languages | `6c616e677561676573` |
| rating | `726174696e67` |

#### Browse Interface

**`GET /browse`** — HTML browse interface (not API — for human use)

**`GET /browse/search`** — HTML search results

### calibredb CLI

`calibredb` is the command-line database tool. Maisie invokes it via
`docker exec {container_name} calibredb ... --library-path {path}`.

#### Common Commands

**List books:**
```bash
calibredb list \
  --fields title,authors,tags,series,identifiers,formats \
  --for-machine \
  --library-path "/config/Calibre Library"
```
`--for-machine` outputs JSON. Without it, outputs a table.

Available fields: `title`, `authors`, `author_sort`, `tags`, `series`,
`series_index`, `rating`, `publisher`, `pubdate`, `languages`, `formats`,
`identifiers`, `comments`, `uuid`, `id`, `timestamp`, `last_modified`

**Search:**
```bash
calibredb search "authors:LeGuin and tags:Fantasy" \
  --library-path "/config/Calibre Library"
```
Returns a comma-separated list of matching book IDs.

**Add a book:**
```bash
calibredb add /path/to/book.epub \
  --library-path "/config/Calibre Library"
```
Output includes `Added book ids: 560`. Supports `.epub`, `.mobi`, `.pdf`,
`.azw3`, `.cbz`, `.cbr`, and other formats.

**Remove a book:**
```bash
calibredb remove 559 \
  --library-path "/config/Calibre Library"
```

**Set metadata:**
```bash
calibredb set_metadata 559 \
  --field title:"New Title" \
  --field authors:"Author One & Author Two" \
  --field tags:"Science Fiction,Hugo Award" \
  --field series:"Hainish Cycle" \
  --field series_index:6 \
  --field rating:9 \
  --library-path "/config/Calibre Library"
```

Field format for multi-value fields (authors, tags): use `&` for authors,
comma-separated for tags.

**Export a book:**
```bash
calibredb export 559 \
  --to-dir /output \
  --formats EPUB \
  --library-path "/config/Calibre Library"
```

**Check library:**
```bash
calibredb check_library \
  --library-path "/config/Calibre Library"
```

**Restore database** (from embedded metadata in files):
```bash
calibredb restore_database \
  --library-path "/config/Calibre Library"
```

**Catalog generation:**
```bash
calibredb catalog /output/catalog.epub \
  --library-path "/config/Calibre Library"
```
Formats: `epub`, `csv`, `xml`, `opds`

**Save to disk** (export in Calibre folder format):
```bash
calibredb save_to_disk 559 /output \
  --library-path "/config/Calibre Library"
```

#### Custom Column Operations

```bash
# Add a custom column
calibredb add_custom_column read_date "Date Read" datetime

# Set a custom column value
calibredb set_metadata 559 \
  --field "#read_date:2024-01-15" \
  --library-path "/config/Calibre Library"
```

### calibre-smtp

Send books to Kindle or email via calibre's SMTP tool:
```bash
calibre-smtp \
  --relay smtp.gmail.com \
  --port 587 \
  --username user@gmail.com \
  --password "..." \
  --encryption TLS \
  from@email.com \
  to@kindle.com \
  "Book Title" \
  /path/to/book.mobi
```

### Direct SQLite Access

Calibre's database is `metadata.db` in the library root. Read-only access is
safe; writes should go through `calibredb` to maintain cache integrity.

Key tables:

| Table | Purpose |
|-------|---------|
| `books` | Core book records (id, title, sort, pubdate, etc.) |
| `authors` | Author name and sort |
| `books_authors_link` | Many-to-many books↔authors |
| `tags` | Tag names |
| `books_tags_link` | Many-to-many books↔tags |
| `series` | Series names |
| `comments` | Book descriptions |
| `identifiers` | ISBN, Goodreads IDs, etc. (type/val per row) |
| `data` | Book file records (book_id, format, uncompressed_size, name) |
| `custom_column_{n}` | Custom column values |

The `data` table `name` field is the filename without extension. Files live at
`{library_root}/{Author}/{Title}/{name}.{format}`.

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `CALIBRE_HOST` | Content Server host |
| `CALIBRE_PORT` | Content Server port (default: 8081) |
| `CALIBRE_CONTAINER_NAME` | Docker container for CLI exec (default: `calibre`) |
| `CALIBRE_LIBRARY_PATH` | Path inside container (default: `/config/Calibre Library`) |

---

## DAKboard {#dakboard}

DAKboard is a digital display platform for wall-mounted screens. Maisie uses
its REST API to push custom metrics and manage screen assignments.

### Authentication

All API calls include `?api_key={DAKBOARD_API_KEY}` as a query parameter.
No Bearer token or header auth — the key goes in the query string for every request.

Base URL: `https://dakboard.com/api/2`

### Screens

**`GET /api/2/screens?api_key={key}`** — List all screens

```json
[
  {
    "id": 12345,
    "name": "Kitchen Display",
    "width": 1920,
    "height": 1080,
    "orientation": "landscape",
    "status": "active",
    "version": 3,
    "is_default": true
  }
]
```

### Devices

**`GET /api/2/devices?api_key={key}`** — List all registered devices

```json
[
  {
    "id": 67890,
    "name": "Kitchen Pi",
    "serial_num": "XXXXXXXXXX",
    "model": "Raspberry Pi 4",
    "ip_addr": "192.168.1.x",
    "last_connect": "2024-04-03T12:00:00Z",
    "screen_id": 12345,
    "screen_type": "standard"
  }
]
```

**`PUT /api/2/devices/{id}?api_key={key}`** — Update a device (e.g., assign screen)

Request body is `application/x-www-form-urlencoded`:
```
screen_id=12345
```

### Custom Metrics

DAKboard allows pushing arbitrary name/value pairs that can be displayed as
widgets on a board.

**`POST /api/2/metrics?api_key={key}`** — Push a metric value

Request body (form-encoded):
```
name=printer_state&value=Printing+47%25
```

```
name=temperature&value=72.5
```

Metric names can be any string; they appear as display variables in the
DAKboard web app. Create a Custom Variable widget on the board and reference
`%printer_state%` to display it.

The API does not return metric history — values are display-only, overwritten
on each push.

**`GET /api/2/metrics?api_key={key}`** — List all metrics (name, last value)

```json
[
  {
    "id": 1,
    "name": "printer_state",
    "value": "Printing 47%",
    "timestamp": "2024-04-03T12:00:00Z"
  }
]
```

### Playlists / Blocks (Advanced API)

DAKboard's advanced playlist management endpoints (for rotating content blocks)
are available on paid plans. The structure is:

```
GET /api/2/screens/{id}/playlists        # list playlists on a screen
POST /api/2/screens/{id}/playlists       # create playlist
PUT /api/2/playlists/{id}                # update playlist
DELETE /api/2/playlists/{id}             # remove playlist
```

Playlist object:
```json
{
  "id": 1,
  "name": "Main",
  "duration": 30,
  "active": true,
  "blocks": []
}
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `DAKBOARD_API_KEY` | API key from DAKboard account settings |

---

## go2rtc {#go2rtc}

go2rtc is a lightweight media server for camera streams. In Maisie it bridges
UniFi Protect RTSPS streams to WebRTC, HLS, RTSP, and MPEG-TS outputs for the
dashboard and synthetic-hdhr.

**Important**: go2rtc crashes when fed MPEG-TS input. Only configure it for
WebRTC/RTSP/RTSPS camera sources.

### Configuration File

`config/go2rtc.yaml` (gitignored — contains RTSP credentials):

```yaml
streams:
  front_door:
    - rtsps://{UNIFI_HOST}:7441/{RTSP_SESSION_ID}
  back_yard:
    - rtsps://{UNIFI_HOST}:7441/{RTSP_SESSION_ID}
  bambu_printer:
    - rtsps://bblp:{ACCESS_CODE}@{BAMBU_HOST}:322/streaming/live/1?BackChannel=0

api:
  listen: ":1984"

rtsp:
  listen: ":8554"

webrtc:
  listen: ":8555/tcp"
  candidates:
    - {LAN_IP}:8555
```

`go2rtc.tokyo.yaml` is the production config (not gitignored, restored by
deploy script since `go2rtc.yaml` is gitignored).

### HTTP API

Base URL: `http://{host}:1984`

#### Stream Management

**`GET /api/streams`** — List all configured streams

```json
{
  "front_door": {
    "producers": [
      {
        "url": "rtsps://...",
        "state": "connected"
      }
    ],
    "consumers": []
  }
}
```

**`GET /api/streams?src={name}`** — Get info for a specific stream

**`PUT /api/streams?src={name}&dst={url}`** — Add a stream dynamically

**`DELETE /api/streams?src={name}`** — Remove a stream

#### Video Output Endpoints

These are the primary consumer endpoints used by the dashboard and downstream clients:

**`GET /api/ws?src={name}`** — WebSocket for MSE (Media Source Extensions)

Used for low-latency in-browser playback via `<video>` with MSE. The WebSocket
delivers fMP4 segments. This is the preferred method for dashboard camera views.

**`GET /api/webrtc?src={name}`** — WebRTC signaling endpoint

POST with SDP offer, receive SDP answer. Used for ultra-low-latency WebRTC
playback (sub-second).

```
POST /api/webrtc?src=front_door
Content-Type: application/sdp

v=0
o=- ...
(SDP offer body)
```

Response: SDP answer.

**`GET /api/hls/index.m3u8?src={name}`** — HLS playlist

Generates HLS segments on demand. Higher latency (~10s) but compatible with
any player. Not suitable for real-time monitoring.

Also: `GET /api/hls/{name}/index.m3u8` (alternate path format)

**`GET /api/mp4?src={name}`** — Progressive MP4 stream (fMP4)

Useful for recording or for players that prefer fragmented MP4.

**`GET /api/mjpeg?src={name}`** — MJPEG stream

Low-fps JPEG stream. Useful for thumbnails or simple HTTP consumers.

**`GET /api/frame.jpeg?src={name}`** — Single JPEG snapshot

Returns the current frame as a JPEG. Used by the EPG for camera programme icons:
```
http://{go2rtc_host}:1984/api/frame.jpeg?src=front_door
```

#### RTSP Re-stream

go2rtc re-exposes all configured streams as RTSP on port 8554:

```
rtsp://{host}:8554/{stream_name}
```

This is how synthetic-hdhr pulls camera streams:
```
rtsp://go2rtc:8554/front_door
```

The ffmpeg in synthetic-hdhr connects via RTSP and transcodes to MPEG-TS for Plex.

#### Source Discovery

**`GET /api/sources`** — List available input source types

**`GET /api/links`** — WebRTC ICE server configuration

#### Health / Info

**`GET /`** — HTML dashboard (human-facing, shows stream status)

**`GET /api/streams`** with Accept: `application/json` — same as above

### Ports Summary

| Port | Protocol | Purpose |
|------|----------|---------|
| 1984 | HTTP | API and web dashboard |
| 8554 | RTSP | RTSP re-stream output |
| 8555/TCP | WebRTC/DTLS | WebRTC data channel |

### Client Usage Pattern (Dashboard)

```typescript
// MSE via WebSocket — preferred for dashboard
const ws = new WebSocket(`ws://192.168.1.10:1984/api/ws?src=front_door`)
// Feed frames to MediaSource via SourceBuffer

// Snapshot
const img = new Image()
img.src = `http://192.168.1.10:1984/api/frame.jpeg?src=front_door&t=${Date.now()}`
```

---

## Tokyo Server (SSH/Shell) {#tokyo-server}

Tokyo is the production host — HP Z620, Ubuntu 24.04, at 192.168.1.10.

### SSH Access

```bash
ssh hammer@192.168.1.10
# or via alias if configured in ~/.ssh/config:
ssh tokyo
```

All Maisie services run as Docker containers via `docker compose`. The compose
file and source are in `~/maisie/` (rsync'd by deploy script).

### Docker CLI

**Container management:**
```bash
docker compose ps                          # status of all services
docker compose up -d                       # start all
docker compose up -d maisie               # start specific service
docker compose down                        # stop all
docker compose restart maisie             # restart service

docker compose logs -f maisie             # follow logs
docker compose logs --tail=100 maisie     # last 100 lines
docker compose logs --since="1h" maisie  # last hour

docker stats                              # live resource usage all containers
docker stats maisie synthetic-hdhr        # specific containers
```

**Container exec:**
```bash
docker exec -it maisie sh                 # interactive shell
docker exec maisie bun run typecheck      # one-off command
docker exec calibre calibredb list ...    # calibredb via container
```

**Image management:**
```bash
docker images                             # list images
docker image prune -f                     # remove dangling images
docker compose build maisie               # rebuild specific service
```

### System Information

**Disk:**
```bash
df -h                                     # filesystem usage
df -h /                                   # root only
du -sh /var/lib/docker                    # Docker storage usage
ncdu /                                    # interactive disk usage (if installed)
```

**Memory:**
```bash
free -h                                   # memory overview
cat /proc/meminfo                         # detailed memory info
```

**CPU / Processes:**
```bash
top                                       # process monitor
htop                                      # improved process monitor
ps aux --sort=-%cpu | head -20            # top CPU processes
ps aux --sort=-%mem | head -20            # top memory processes
```

**System logs:**
```bash
journalctl -f                             # follow system log
journalctl -u docker                      # docker service logs
journalctl --since="1 hour ago"           # recent entries
journalctl -p err                         # errors only
```

**Services:**
```bash
systemctl status docker                   # docker daemon status
systemctl status mosquitto                # MQTT broker (if system-managed)
systemctl list-units --state=failed       # failed services
```

### GPU — GTX 1050 Ti

The GTX 1050 Ti is used for NVENC hardware H.264 transcoding in tokyo-streamer.

```bash
nvidia-smi                                # GPU status overview
nvidia-smi -l 1                           # live update every second
nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.free \
  --format=csv,noheader                   # structured output
nvidia-smi pmon -s u                      # per-process GPU usage
```

Key constraints:
- **Max 2 concurrent NVENC sessions** — consumer driver limit. Third session
  fails silently (ffmpeg exits 0 but produces no output).
- **No 10-bit NVENC** — HEVC 10-bit sources require `-pix_fmt yuv420p` flag.
- NVENC sessions: `nvidia-smi` shows encoder utilization; sessions visible under
  Processes section.

```bash
# Check NVENC session count
nvidia-smi | grep -c MEncM
```

### Network

```bash
ss -tlnp                                  # listening TCP sockets + process
ss -ulnp                                  # listening UDP sockets
ip addr                                   # network interfaces + IPs
ip route                                  # routing table
netstat -an | grep ESTABLISHED | wc -l   # active connections
```

**Checking which process uses a port:**
```bash
ss -tlnp | grep :3001
lsof -i :3001
```

### Useful One-liners

```bash
# Watch Docker container resource usage
watch -n 2 docker stats --no-stream

# Tail all compose service logs simultaneously
docker compose logs -f

# Find large files
find /var/lib/docker -size +500M -type f 2>/dev/null

# Check NVENC encoder sessions
nvidia-smi --query-compute-apps=pid,process_name,used_gpu_memory \
  --format=csv,noheader

# Docker disk usage summary
docker system df

# Quick health check of all Maisie services
curl -s http://localhost:3001/api/health | jq .
curl -s http://localhost:5004/api/health | jq .

# Check if a stream is active in go2rtc
curl -s http://localhost:1984/api/streams | jq 'keys'
```

### Deploy Script

```bash
# From local dev machine — not run on Tokyo itself
./scripts/deploy-tokyo.sh              # deploy all changed services
./scripts/deploy-tokyo.sh maisie       # deploy one service
./scripts/deploy-tokyo.sh --sync       # rsync only, no rebuild
```

The script: rsync source → restore `go2rtc.tokyo.yaml` (overwritten by rsync)
→ `docker compose build` → `docker compose up -d` → lineup rebuild.

After synthetic-hdhr restarts, it auto-rebuilds the lineup by calling
`/api/rebuild` internally.

---

*Last updated: 2026-04-03*
