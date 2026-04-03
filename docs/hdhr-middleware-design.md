# HDHR Middleware Design

## Overview

A unified HDHomeRun emulator that proxies the real HDHomeRun PRIME alongside
Maisie's virtual camera channels, presenting everything to Plex as a single
device with a single XMLTV guide.

## Current Architecture

```
Plex ──→ HDHomeRun PRIME ({HDHR_HOST}) ──→ Cable TV (Gracenote EPG)
Plex ──→ hdhr-protect ({LAN_IP}:5004) ──→ go2rtc ──→ Cameras (wrong EPG)
```

**Problem**: Plex won't allow XMLTV alongside Gracenote. Camera channels get
wrong guide data.

## Target Architecture

```
Plex ──→ hdhr-protect (unified middleware)
            ├── Channels 1-999:   proxy to PRIME (cable)
            └── Channels 10001+:  go2rtc → ffmpeg (cameras)

XMLTV Guide:
  ├── Cable channels: zap2xml (free Zap2it scraper)
  └── Camera channels: self-generated from Protect API
```

Plex sees one device, one XMLTV source. No Gracenote dependency.

## Components

### 1. hdhr-protect (extended)

The existing `packages/hdhr-protect` service gains:

**PRIME proxy**:
- On startup, fetch PRIME lineup from `http://{PRIME_IP}/lineup.json`
- Merge with camera channels
- For cable tune requests, proxy to `http://{PRIME_IP}/auto/v{channel}`
- Track PRIME tuner availability (3 tuners max)

**Unified lineup**:
```json
[
  {"GuideNumber": "183", "GuideName": "WCIUDT", "URL": "http://hdhr-protect:5004/stream/cable/183"},
  {"GuideNumber": "10001", "GuideName": "Back Yard", "URL": "http://hdhr-protect:5004/stream/camera/back_yard"},
  ...
]
```

**Stream routing**:
- `/stream/cable/:channel` → proxy to PRIME `/auto/v{channel}` (pass-through, no ffmpeg)
- `/stream/camera/:name` → go2rtc RTSP → ffmpeg remux (existing pipeline)
- `/auto/v:channel` → route to cable or camera based on channel range

**Tuner management**:
- Report combined tuner count: PRIME tuners (3) + virtual camera tuners (4) = 7
- PRIME tuners are shared/limited; camera tuners are unlimited (go2rtc handles concurrency)
- Track active PRIME streams to avoid over-subscribing

### 2. XMLTV Guide Generator

New component: `packages/hdhr-protect/src/epg.ts`

**Cable EPG** (via zap2xml):
- Run zap2xml on a schedule (daily at 3 AM)
- Produces XMLTV for the PRIME's channel lineup
- Requires Zap2it account (free registration)
- Store output in a volume mount
- Fallback: if zap2xml fails, serve stale data with a warning

**Camera EPG** (self-generated):
- Already implemented in `/xmltv.xml`
- 24/7 "Live Camera" entries per channel

**Merged output**:
- `/xmltv.xml` serves combined cable + camera guide
- Updated when either source changes

### 3. zap2xml Container

Lightweight container that runs zap2xml periodically:
- Image: Node.js or Python with zap2xml
- Writes XMLTV to shared volume
- Runs daily via cron or setInterval
- hdhr-protect reads the output file

Alternative: run zap2xml inside hdhr-protect container directly.

### 4. Maisie Agent Integration

**Channel management API** (already exists, extended):
- `GET /api/hdhr-protect/channels` — all channels (cable + camera)
- `POST /api/hdhr-protect/channels` — add/modify channel
- `DELETE /api/hdhr-protect/channels/:number` — remove channel
- `POST /api/hdhr-protect/sync` — re-push lineup to middleware

**PRIME status**:
- `GET /api/hdhr-protect/prime/status` — PRIME device info, tuner status
- `GET /api/hdhr-protect/prime/lineup` — raw PRIME lineup

**EPG status**:
- `GET /api/hdhr-protect/epg/status` — last update time, source health
- `POST /api/hdhr-protect/epg/refresh` — trigger zap2xml re-run

## Docker Compose Changes

```yaml
hdhr-protect:
  build:
    context: ./packages/hdhr-protect
  ports:
    - "5004:5004"
  environment:
    - PRIME_HOST={HDHR_HOST}       # Real HDHomeRun PRIME
    - PRIME_TUNERS=3
    - GO2RTC_RTSP=rtsp://go2rtc:8554
    - GO2RTC_URL=http://{LAN_IP}:1984  # LAN IP for Plex
    - MAISIE_URL=http://maisie:3001
    - ZAP2IT_USERNAME=...           # For zap2xml
    - ZAP2IT_PASSWORD=...
    - DEVICE_ID=MAISIE01
    - DEVICE_NAME=The Estate TV
    - TUNER_COUNT=7                 # 3 PRIME + 4 virtual
  volumes:
    - epg-data:/app/epg             # Shared EPG data
  depends_on:
    - go2rtc
    - maisie

# Remove: the real PRIME is no longer directly registered in Plex
```

## Migration Plan

### Pre-migration
1. Build and test the middleware without deploying
2. Register for Zap2it account (free)
3. Run zap2xml once to verify cable EPG generation
4. Verify the merged XMLTV contains both cable and camera data

### Migration (requires Plex downtime)
1. Stop Plex
2. Remove PRIME from Plex DVR config (database surgery or UI)
3. Remove hdhr-protect from Plex DVR config
4. Start Plex
5. Deploy updated middleware (docker compose up)
6. In Plex: add new tuner at http://{LAN_IP}:5004
7. Select XMLTV guide → point to http://{LAN_IP}:5004/xmltv.xml
8. Map channels (should auto-match since XMLTV channel IDs match lineup)

### Rollback
1. Stop middleware
2. In Plex: remove middleware device
3. Re-add PRIME directly (http://{HDHR_HOST})
4. Select Gracenote guide, remap channels

## Channel Numbering

| Range       | Source          | Count |
|-------------|-----------------|-------|
| 1-999       | PRIME (cable)   | ~8    |
| 10001-10010 | Cameras         | 10    |
| 10100+      | Future sources  | TBD   |

## File Structure

```
packages/hdhr-protect/
  src/
    index.ts          # Main server (extended)
    prime-proxy.ts    # PRIME lineup fetch + stream proxy
    camera-streams.ts # Existing ffmpeg pipeline (extracted)
    epg.ts            # XMLTV generator (merged cable + camera)
    zap2xml.ts        # zap2xml runner
  Dockerfile          # + zap2xml dependencies
```

## Implementation Status

### Built (not deployed)
- `packages/hdhr-protect/src/index.ts` — unified main server with cable+camera routing
- `packages/hdhr-protect/src/prime-proxy.ts` — PRIME lineup fetch + stream proxy
- `packages/hdhr-protect/src/camera-streams.ts` — ffmpeg RTSP→MPEG-TS pipeline
- `packages/hdhr-protect/src/epg.ts` — merged XMLTV (zap2xml + camera guide, with basic OTA fallback)
- `docker-compose.yml` — updated with PRIME_HOST, EPG_DIR, tuner count
- `scripts/plex-dvr-surgery.sh` — database backup/restore for Plex migration

### PRIME Lineup (9 OTA channels)
| Ch  | Call Sign | Network      |
|-----|-----------|--------------|
| 183 | WCIUDT    | The U        |
| 184 | WPWRDT    | MyNetworkTV  |
| 185 | PARSHOH   | Paramount+   |
| 187 | WLSDT     | ABC          |
| 188 | WMAQDT    | NBC          |
| 189 | WBBMDT    | CBS          |
| 190 | WFLDDT    | FOX          |
| 191 | WTTWDT    | PBS          |
| 192 | WGNDT     | WGN          |

### EPG Sources
- **OTA channels**: Basic fallback (network name 24/7) built in. Real program data
  available via zap2xml (free, scrapes Zap2it). Drop a zap2xml output file at
  `/app/epg/zap2xml.xml` and the middleware will merge it automatically.
- **Camera channels**: Self-generated 24/7 "Live Camera" entries.
- **Pluggable**: Replace the zap2xml file with any XMLTV-format file for other sources.
  Future: Schedules Direct, custom scrapers, etc.

## Open Questions

- **zap2xml reliability**: Zap2it may change their site. Need monitoring.
- **PRIME tuner tracking**: How to know when a PRIME tuner is released?
  The proxy stream closes → decrement counter. But edge cases (client crash,
  timeout) need cleanup.
- **Plex DVR recordings**: When Plex records from a cable channel, it tunes
  for the full duration. Must ensure the PRIME proxy doesn't time out.
- **Channel scan**: When Plex rescans, it fetches `/lineup.json`. If the PRIME
  is off, cable channels disappear. Should we cache the last known lineup?
- **Plex DB surgery**: Tested inserting a second DVR harvester directly in the
  database — Plex ignores it and merges devices back into the existing DVR on
  startup. The only viable path is to delete all existing DVR config and start
  fresh with the middleware as the sole device using XMLTV.
