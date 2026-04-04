# Synology DSM API Catalog

Complete reference for the Synology DiskStation Manager (DSM) API surface. Covers the full SYNO.* Web API namespace, SSH CLI tools, SNMP monitoring, notifications/webhooks, and authentication details.

**Target hardware**: Synology NAS running DSM 7.x (Sapporo at 192.168.1.224, HTTPS port 5001).

---

## Contents

1. [API Fundamentals](#api-fundamentals)
2. [Authentication — SYNO.API.Auth](#authentication--synoauthapi)
3. [API Discovery — SYNO.API.Info](#api-discovery--synoapiinfo)
4. [System & Health](#system--health)
5. [Storage Manager](#storage-manager)
6. [File Station](#file-station)
7. [Download Station](#download-station)
8. [Video Station](#video-station)
9. [Audio Station](#audio-station)
10. [Photos (Synology Photos)](#photos-synology-photos)
11. [Surveillance Station](#surveillance-station)
12. [Docker / Container Manager](#docker--container-manager)
13. [Backup & Active Backup](#backup--active-backup)
14. [Shared Folders](#shared-folders)
15. [Package Center](#package-center)
16. [Network](#network)
17. [Users & Groups](#users--groups)
18. [Security & Certificates](#security--certificates)
19. [Logs & Monitoring](#logs--monitoring)
20. [Task Scheduler](#task-scheduler)
21. [VPN Server](#vpn-server)
22. [Cloud Sync](#cloud-sync)
23. [Snapshots](#snapshots)
24. [Reverse Proxy](#reverse-proxy)
25. [SSH CLI Tools](#ssh-cli-tools)
26. [SNMP Monitoring](#snmp-monitoring)
27. [Webhooks & Notifications](#webhooks--notifications)
28. [MQTT Support](#mqtt-support)
29. [What Maisie Implements vs. What's Available](#what-maisie-implements-vs-whats-available)

---

## API Fundamentals

### Base URL

```
https://<host>:5001/webapi/
```

Always use HTTPS port 5001. HTTP port 5000 hangs indefinitely on some models (confirmed issue with Sapporo).

### Request Pattern

All modern DSM 7.x APIs route through a single CGI:

```
POST/GET https://<host>:5001/webapi/entry.cgi
```

Required query parameters for every call:

| Parameter | Description |
|-----------|-------------|
| `api` | SYNO.* namespace (e.g. `SYNO.FileStation.List`) |
| `method` | Method name (e.g. `list`) |
| `version` | API version integer (use maxVersion for the namespace) |
| `_sid` | Session ID from login (or use cookie) |

**Older CGI paths** (still work but deprecated in DSM 7):
- `auth.cgi` — authentication only
- `query.cgi` — API discovery
- Per-package paths like `AudioStation/info.cgi`, `VideoStation/info.cgi`

### Response Envelope

Every response is JSON:

```json
{
  "success": true,
  "data": { ... }
}
```

On error:

```json
{
  "success": false,
  "error": { "code": 105 }
}
```

### HTTP Method Notes

- **GET**: Safe for read operations. All parameters go in the query string.
- **POST** (`application/x-www-form-urlencoded`): Required for writes and anything with complex JSON parameters.
- **POST** (`multipart/form-data`): Required for file uploads (`SYNO.FileStation.Upload`).

---

## Authentication — SYNO.API.Auth

**CGI**: `auth.cgi` (legacy) or `entry.cgi`
**Versions**: 1–7 (use v6+ for DSM 7)

### Login

```
GET /webapi/auth.cgi
  ?api=SYNO.API.Auth
  &method=login
  &version=6
  &account=<username>
  &passwd=<password>
  &format=sid           # "sid" | "cookie"
  &session=<name>       # optional session label, e.g. "FileStation"
  &enable_syno_token=yes  # include for CSRF token
  &enable_device_token=yes  # include to get a persistent device token (skip 2FA on next login)
```

**Login response** (`success: true`):
```json
{
  "data": {
    "sid": "...",          // session ID — pass as _sid on all subsequent requests
    "synotoken": "...",    // CSRF token — pass as SynoToken header on POST requests
    "did": "...",          // device ID for trusted device flow
    "device_token": "..."  // persistent token (only when enable_device_token=yes)
  }
}
```

**2FA / OTP flow** (when 2FA is enabled on the account):

The initial login with only `account`/`passwd` returns error code `403` (OTP needed). Re-submit with the additional parameter:

```
&otp_code=<6-digit TOTP>
```

To register the device as trusted so future logins skip OTP:
```
&enable_device_token=yes  # request persistent token
```

On subsequent logins, pass `device_token=<token>` instead of OTP. Device tokens do not expire automatically — they persist until revoked in DSM (Personal > Security > Sign-in Activity).

### Logout

```
GET /webapi/auth.cgi?api=SYNO.API.Auth&method=logout&version=6&session=<name>
```

### Authentication Error Codes

| Code | Meaning |
|------|---------|
| 400 | No such account or incorrect password |
| 401 | Guest disabled |
| 402 | Account disabled |
| 403 | OTP code required |
| 404 | Failed to authenticate with wrong OTP code |
| 405 | OTP code expired |
| 406 | OTP not supported |
| 407 | Re-authentication with 2FA required |
| 408 | Blocked by auto-block |
| 409 | Account locked (too many failures) |
| 100 | Unknown error |
| 101 | Invalid parameter |
| 102 | API not found |
| 103 | Method not found |
| 104 | Version not supported |
| 105 | Session lacks permission |
| 106 | Session timeout |
| 107 | Session interrupted by duplicate login |
| 119 | Invalid session |
| 150 | Request source IP differs from login IP |

### Session Lifetime

- Default expiry: **7 days** (configurable in DSM Control Panel > Security)
- Error 105 returned when session is invalid — re-authenticate and retry
- The Maisie DSM client already handles this: on error 105, clears `sid`, re-calls `login()`, then retries the original request

### CSRF Token (SynoToken)

If DSM has "improve protection against CSRF" enabled:
- Include `SynoToken: <token>` header on all `POST` requests
- Token is obtained from the login response (`synotoken` field)
- Without it, POST requests return error 119

### API Key Authentication (DSM 7.2+)

DSM 7.2 introduced API keys as an alternative to username/password. Configure in DSM Control Panel > API Portal. API keys can have scoped permissions. Pass as `Authorization: Bearer <api_key>` header.

---

## API Discovery — SYNO.API.Info

**CGI**: `query.cgi` or `entry.cgi`
**Version**: 1

Enumerate all available APIs on the device:

```
GET /webapi/query.cgi
  ?api=SYNO.API.Info
  &method=query
  &version=1
  &query=all            # "all" returns every registered API
```

Response example:
```json
{
  "data": {
    "SYNO.FileStation.List": {
      "path": "entry.cgi",
      "minVersion": 1,
      "maxVersion": 2,
      "requestFormat": "JSON"
    },
    "SYNO.AudioStation.Info": {
      "path": "AudioStation/info.cgi",
      "minVersion": 1,
      "maxVersion": 6
    }
  }
}
```

Use this at startup to discover what versions are available before calling any other API.

---

## System & Health

### SYNO.DSM.Info — Basic NAS Info

**Version**: 2 | **CGI**: `entry.cgi` | **Auth**: required

```
GET /webapi/entry.cgi?api=SYNO.DSM.Info&method=getinfo&version=2&_sid=<sid>
```

Response fields:
- `model` — model name (e.g. `DS920+`)
- `ram_size` — total RAM in MB
- `temperature` — CPU/system temperature (°C)
- `uptime` — seconds since last boot
- `version_string` — full DSM version (e.g. `DSM 7.2.1-69057`)
- `serial` — serial number
- `codepage` — locale code page

### SYNO.Core.System — System Info (DSM 6+)

**Version**: 1–3 | **CGI**: `entry.cgi`

```
GET /webapi/entry.cgi?api=SYNO.Core.System&method=info&version=1&_sid=<sid>
```

Returns: model, RAM, serial, temperature, uptime, firmware version.

### SYNO.Core.System.Utilization — CPU & Memory

**Version**: 1 | **CGI**: `entry.cgi`

```
GET /webapi/entry.cgi?api=SYNO.Core.System.Utilization&method=get&version=1&_sid=<sid>
```

Response:
```json
{
  "cpu": {
    "system_load": 5,    // %
    "user_load": 12,     // %
    "other_load": 3      // %
  },
  "memory": {
    "total_real": "8148436",   // KB
    "avail_real": "4521908",   // KB
    "total_swap": "2097148",   // KB
    "avail_swap": "2095108"    // KB
  },
  "network": [
    { "device": "eth0", "rx": 1234, "tx": 5678 }  // bytes/sec
  ],
  "disk": [...]
}
```

### SYNO.Core.System.Status

**Version**: 1 | **CGI**: `entry.cgi`

Returns overall system health status including fan status, power supply status, and any alerts.

### SYNO.Core.Hardware.FanSpeed

**Version**: 1 | **CGI**: `entry.cgi`

```
GET .../entry.cgi?api=SYNO.Core.Hardware.FanSpeed&method=get&version=1
```

Response: `cpu_fan_speed`, `system_fan_speed` (RPM). Write with `method=set&dual_fan_speed=<mode>`.

### SYNO.Core.Hardware.BeepControl

**Version**: 1 — manage the beeper on the NAS.

### SYNO.Core.Upgrade

**Version**: 1 | Methods: `status`, `check` (via `SYNO.Core.Upgrade.Server`)

Check for and initiate DSM firmware upgrades.

---

## Storage Manager

### SYNO.Storage.CGI.Storage — Volume & Disk Overview

**Version**: 1 | **CGI**: `entry.cgi`

```
GET /webapi/entry.cgi?api=SYNO.Storage.CGI.Storage&method=load_info&version=1&_sid=<sid>
```

Response:
```json
{
  "volumes": [
    {
      "id": "volume1",
      "status": "normal",          // "normal" | "degraded" | "crashed"
      "size": {
        "total": "19997499293696", // bytes as string
        "used": "12450176163840"
      }
    }
  ],
  "disks": [
    {
      "id": "disk1",
      "name": "Disk 1",
      "vendor": "TOSHIBA",
      "model": "MG08ADA800N",
      "temp": 38,                  // °C
      "smart_status": "normal",    // "normal" | "abnormal" | "failing"
      "size_total": "8001563222016"
    }
  ]
}
```

### SYNO.Storage.CGI.HddMan — Disk Detail

**Version**: 1 | **CGI**: `entry.cgi` | Method: `get`

Returns extended per-disk information including S.M.A.R.T. attributes.

### SYNO.Core.Storage.Volume

**Version**: 1 | **CGI**: `entry.cgi`

Manage individual volumes: list, get, expand, repair. Returns RAID level, file system, mount path.

### SYNO.Core.Storage.Pool

**Version**: 1 | **CGI**: `entry.cgi`

Manage storage pools (RAID arrays). Methods: `list`, `get`, `repair`, `expand`.

### SYNO.Core.Storage.Disk

**Version**: 1 | **CGI**: `entry.cgi`

Detailed per-disk management. Methods: `list`, `get`. Returns power status, health, SMART raw attributes.

### SYNO.Core.Storage.iSCSILUN / iSCSITargets / iSCSIUtils

**Version**: 1 | **CGI**: `entry.cgi`

iSCSI LUN management, target configuration, and utilities (clone, move).

### SYNO.Core.Polling.Data — Real-time Polling

**Version**: 1 | **CGI**: `entry.cgi` | Method: `get`

Returns live disk throughput, IOPS, and latency data.

---

## File Station

All File Station APIs use `entry.cgi`. Authentication required.

### SYNO.FileStation.Info

**Version**: 2 | Method: `get`

Returns FileStation configuration: hostname, supported operations, is_manager, items_per_page, max_concurrent_tasks.

### SYNO.FileStation.List — Browse

**Version**: 2

**List shares** (top-level shared folders):
```
GET .../entry.cgi
  ?api=SYNO.FileStation.List
  &method=list_share
  &version=2
  &additional=["real_path","size","owner"]
  &_sid=<sid>
```

**List folder contents**:
```
GET .../entry.cgi
  ?api=SYNO.FileStation.List
  &method=list
  &version=2
  &folder_path=/volume1/media
  &additional=["size","time","perm","type"]
  &sort_by=name
  &sort_direction=ASC
  &limit=100
  &offset=0
```

**Get file info**:
```
GET .../entry.cgi?api=SYNO.FileStation.List&method=getinfo&version=2
  &path=["/volume1/media/file.mkv"]
  &additional=["size","time","perm","owner","mount_point_type"]
```

### SYNO.FileStation.Search

**Version**: 2 | Async (start → poll → stop pattern)

```
POST .../entry.cgi?api=SYNO.FileStation.Search&method=start&version=2
  &folder_path=/volume1
  &pattern=*.mkv
  &search_recur=true
```

Returns `taskid`. Poll with `method=list&taskid=<id>` until `finished=true`.

### SYNO.FileStation.Upload

**Version**: 2 | **POST multipart/form-data** only

```
POST /webapi/entry.cgi/upload    # note the /upload path suffix
Content-Type: multipart/form-data

Fields:
  api=SYNO.FileStation.Upload
  method=upload
  version=2
  path=/volume1/target-folder
  create_parents=true
  overwrite=true
  _sid=<sid>
  file=<binary blob with filename>   # must be last field
```

### SYNO.FileStation.Download

**Version**: 2 | Method: `download`

```
GET .../entry.cgi
  ?api=SYNO.FileStation.Download
  &method=download
  &version=2
  &path=/volume1/media/file.mkv
  &mode=download    # "download" | "open"
  &_sid=<sid>
```

Returns the file content directly (binary stream). No JSON wrapper.

### SYNO.FileStation.Delete

**Version**: 2

Synchronous: `method=delete&path=<json-array-of-paths>`
Async: `method=start` → `method=status&taskid=<id>` → `method=stop`

### SYNO.FileStation.CopyMove

**Version**: 3 | Async

```
POST .../entry.cgi?api=SYNO.FileStation.CopyMove&method=start&version=3
  &path=["/src1","/src2"]
  &dest_folder_path=/dest
  &overwrite=false
  &remove_src=false    # true = move
```

### SYNO.FileStation.CreateFolder

**Version**: 2 | Method: `create`

```
POST .../entry.cgi?api=SYNO.FileStation.CreateFolder&method=create&version=2
  &folder_path=["/volume1/photos"]
  &name=["New Album"]
  &force_parent=true
```

### SYNO.FileStation.Rename

**Version**: 2 | Method: `rename`

### SYNO.FileStation.Compress / Extract

**Version**: 2 | Async

Compress: `method=start&path=<array>&dest_file_path=/dest.zip&level=moderate&format=zip`
Extract: `method=start&file_path=/archive.zip&dest_folder_path=/dest&overwrite=true`

### SYNO.FileStation.Sharing — Share Links

**Version**: 3

```
POST .../entry.cgi?api=SYNO.FileStation.Sharing&method=create&version=3
  &path=["/volume1/media/video.mp4"]
  &date_expired=2026-12-31
  &password=optional
```

Response: `{ "links": [{ "id": "...", "url": "https://nas.host:5001/..." }] }`

Methods: `list`, `getinfo`, `edit`, `delete`, `clear_invalid`

### SYNO.FileStation.Favorite

**Version**: 2 | Methods: `list`, `add`, `delete`, `edit`, `replaceall`

### SYNO.FileStation.VirtualFolder

**Version**: 2 | Method: `list`

Lists all mounted virtual folders (NFS, SMB, ISO mounts).

### SYNO.FileStation.DirSize / MD5

Async tasks for calculating directory sizes and computing MD5 checksums.

### SYNO.FileStation.BackgroundTask

**Version**: 1 | Method: `list` — list all running async tasks.

---

## Download Station

**Session label**: `session=DownloadStation` recommended on login.
All APIs use `entry.cgi`.

### SYNO.DownloadStation.Info

**Version**: 2

- `getinfo` — version, is_manager
- `getconfig` — global settings: default destination, speed limits
- `setserverconfig` — set `bt_max_download`, `bt_max_upload`, `http_max_download`, etc.

### SYNO.DownloadStation.Schedule

**Version**: 2 | Methods: `getconfig`, `setconfig`

Enable/disable download scheduling and eMule scheduling.

### SYNO.DownloadStation2.Task (preferred in DSM 7)

**Version**: 2

**List tasks**:
```
GET .../entry.cgi?api=SYNO.DownloadStation2.Task&method=list&version=2
  &additional=["detail","transfer","file"]
  &limit=100&offset=0
```

Task object: `id`, `type` (bt/http/ftp/nzb/emule), `username`, `title`, `status`, `size`, `additional.transfer.downloaded_pieces`

**Create task** (URL or torrent file):
```
POST .../entry.cgi?api=SYNO.DownloadStation2.Task&method=create&version=2
  &url=["magnet:?xt=..."]
  &destination=/downloads
  &create_list=false
```

**Control tasks**:
- `method=pause&id=["task_id"]`
- `method=resume&id=["task_id"]`
- `method=delete&id=["task_id"]&force_complete=false`
- `method=edit&id=["task_id"]&destination=/new-path`

### SYNO.DownloadStation.Statistic

**Version**: 1 | Method: `getinfo` — speed_download, speed_upload (bytes/sec)

### SYNO.DownloadStation2.RSS.Site / RSS.Feed / RSS.Filter

RSS feed management: `list`, `refresh`, `add`, `set`, `delete` filters.

### SYNO.DownloadStation2.BTSearch

**Version**: 2

```
POST .../entry.cgi?api=SYNO.DownloadStation2.BTSearch&method=start&version=2
  &keyword=ubuntu&module=enabled
```

Methods: `start`, `list` (results), `get` (categories), `clean`, `getModule`

---

## Video Station

**CGI**: `entry.cgi` (DSM 7) or `VideoStation/*.cgi` (legacy)

### SYNO.VideoStation.Info

**Version**: 1 | Method: `get` — version info, library paths

### SYNO.VideoStation.Movie

**Version**: 3

- `list` — params: `library_id`, `limit`, `offset`, `sort_by` (title/year/rating/added), `sort_direction`
- `search` — `keyword`, `library_id`, `limit`, `offset`
- `getinfo` — `id` (array of movie IDs)
- `edit` — update metadata fields

Response: `id`, `title`, `original_available`, `summary`, `certificate`, `genre`, `file` (path, size, codec)

### SYNO.VideoStation.TVShow / TVShowEpisode

**Version**: 3

- `SYNO.VideoStation.TVShow`: `list`, `search`, `getinfo`, `edit`
- `SYNO.VideoStation.TVShowEpisode`: `list` (with `tvshow_id`), `search`, `getinfo`, `edit`

Episode response: `ep_no`, `season_no`, `tvshow_id`, `summary`, `file`

### SYNO.VideoStation.HomeVideo

**Version**: 3 | Methods: `list`, `search`, `getinfo`, `edit`

### SYNO.VideoStation.TVRecording

**Version**: 1 | Methods: `list`, `search`, `getinfo`

### SYNO.VideoStation.Collection

**Version**: 3 | Methods: `list`, `search`, `getinfo`, `create`, `delete`, `set`

### SYNO.VideoStation.Library

**Version**: 1 | Method: `list` — returns all configured video libraries

### SYNO.VideoStation.Folder

**Version**: 1 | Method: `list` — browse the video folder tree

### SYNO.VideoStation.Metadata

**Version**: 1 | Method: `list` — retrieve full metadata including poster, backdrop info (requires `id`)

### SYNO.VideoStation.Subtitle / AudioTrack

**Version**: 1 | Method: `list` — list subtitles/audio tracks for a video file

### SYNO.VideoStation.WatchStatus

**Version**: 1 | Methods: `getinfo`, `set` — read/write watch position

### SYNO.VideoStation.Streaming

**Version**: 1 | Methods: `open`, `close`, `stream` — initiate and stream video

### SYNO.VideoStation.Poster / Rating

Metadata enrichment; partially documented.

---

## Audio Station

**CGI**: `entry.cgi` (preferred) or `AudioStation/*.cgi`

### SYNO.AudioStation.Info

**Version**: 6 | Method: `getinfo` — version, enabled features

### SYNO.AudioStation.Song

**Version**: 3

- `list` — params: `library_id`, `limit`, `offset`, `additional` (song_tag, song_audio, song_rating)
- `search` — `keyword`
- `getinfo` — `id`

### SYNO.AudioStation.Album

**Version**: 3 | Methods: `list`, `search`, `getinfo`

### SYNO.AudioStation.Artist

**Version**: 3 | Methods: `list`, `search`, `getinfo`

### SYNO.AudioStation.Playlist

**Version**: 3 | Methods: `list`, `getinfo`, `create`, `delete`, `set`, `clearsongs`, `addsong`, `removesong`, `updatesong`

### SYNO.AudioStation.RemotePlayer

**Version**: 3

- `list` — `type=all`, `additional=subplayer_list`
- `getplaylist` — `id=<device>`
- `control` — `id=<device>`, `action=play|stop|next|prev|pause`
- `updateplaylist` — set queue for a remote player

### SYNO.AudioStation.Pin

**Version**: 1 | Method: `list` — pinned/favorite songs

### SYNO.AudioStation.Stream

**Version**: 2 | Method: `stream` — stream audio content directly

---

## Photos (Synology Photos)

Synology Photos replaced Photo Station in DSM 7. Uses `SYNO.Foto.*` for personal space and `SYNO.FotoTeam.*` for team/shared space.

### SYNO.Foto.UserInfo

**Version**: 1 | Method: `me` — current user info

### SYNO.Foto.Browse.Folder / SYNO.FotoTeam.Browse.Folder

**Version**: 2 | Methods: `list`, `get`, `count`

- `list` — `folder_id`, `limit`, `offset`, `additional`
- `get` — `folder_id`

### SYNO.Foto.Browse.Album / SYNO.Foto.Browse.ConditionAlbum

**Version**: 2

- `list` — list all albums
- `get` — `album_id`
- `create` — `name`, `condition` (smart album conditions)
- `delete` — `album_id`
- `suggest` — suggest conditions for smart album

### SYNO.Foto.Browse.Item / SYNO.FotoTeam.Browse.Item

**Version**: 3

- `list` — `folder_id`, `limit`, `offset`, `sort_by`, `type`, `additional`
- `get` — `id`

### SYNO.Foto.Search.Filter

**Version**: 1 | Method: `list` — list available search facets

### SYNO.Foto.Sharing.Passphrase / SYNO.FotoTeam.Sharing.Passphrase

**Version**: 2 | Methods: `set_shared`, `update` — create/update shared album links

### SYNO.Foto.Setting.Guest

**Version**: 1 | Method: `get` — guest access settings

### SYNO.Foto.Sharing.Misc

**Version**: 1 | Method: `list_user_group` — shareable users and groups

---

## Surveillance Station

Synology's IP camera DVR/NVR package. Requires Surveillance Station to be installed.

### SYNO.SurveillanceStation.Info

**Version**: 8 | Method: `GetInfo` — version, license counts

### SYNO.SurveillanceStation.Camera

**Version**: 9

- `List` — `idList`, `offset`, `limit`, `basic=true`, `streamInfo=true`
- `GetInfo` — `cameraIds`, `privCamType`, `ptz=true`
- `Save` — create/update camera: `name`, `ip`, `port`, `vendor`, `model`, `userName`, `password`
- `Enable` / `Disable` — `idList`
- `GetSnapshot` — `id`, `profileType` (1=main, 2=sub)
- `GetLiveViewPath` — `idList` — returns RTSP/HLS stream URLs
- `GetCapabilityByCamId` — PTZ and feature capabilities
- `GetOccupiedSize` — disk usage per camera
- `CheckCamValid` — validate shortcut

### SYNO.SurveillanceStation.Camera.Event

Motion detection and alarm management:
- `MotionEnum` — enumerate motion zones
- `ADParamSave` — save motion detection params: `camId`, `source`, `mode`, `level`
- `AudioEnum` — list audio events
- `AlarmEnum` / `AlarmStsPolling` — alarm events and live polling
- `TDParamSave` — tamper detection params
- `DIParamSave` — digital input params

### SYNO.SurveillanceStation.Camera.Group

**Version**: 4 | Methods: `Enum`, `Save`, `Delete`

### SYNO.SurveillanceStation.PTZ

**Version**: 5

- `Move` — `cameraId`, `direction` (up/down/left/right/home), `speed`
- `Zoom` — `cameraId`, `control` (in/out/stop)
- `Focus` / `Iris` / `AutoFocus`
- `Home` — move to home position
- `List` — list presets; `GoPreset` — go to preset position
- `ListPatrol` / `RunPatrol` — automated patrol routes
- `AutoPan` / `ObjTracking`
- `AbsPtz` — absolute position: `posX`, `posY`

### SYNO.SurveillanceStation.Recording

**Version**: 5

- `List` — `cameraIds`, `fromTime`, `toTime`, `limit`, `offset`
- `Delete` / `DeleteFilter` / `DeleteAll`
- `Lock` / `LockFilter` / `Unlock` / `UnlockFilter`
- `Download` — `id`, `mountId`
- `Stream` — live stream a recording
- `RangeExport` — `camId`, `fromTime`, `toTime` (async export)
- `CountByCategory`

### SYNO.SurveillanceStation.ExternalRecording

**Version**: 3 | Method: `Record` — `cameraId`, `action=start|stop`

### SYNO.SurveillanceStation.Recording.Export

Export recordings to shares: `Load`, `CheckName`, `CamEnum`, `CheckAvailableExport`

---

## Docker / Container Manager

Requires Docker (Container Manager) package installed. All use `entry.cgi`.

### SYNO.Docker.Container

**Version**: 1

- `list` — `limit=100`, `offset=0`, `type=all|running|stopped`
  - Returns: `name`, `image`, `status`, `state`, `up_time`
- `get` — `name` — detailed config including ports, volumes, environment, network
- `start` — `name`
- `stop` — `name`
- `export` — `name`, `path` — export container to tarball
- `stats` — resource usage for all containers (CPU, memory, network I/O)

### SYNO.Docker.Container.Resource

**Version**: 1 | Method: `get` — resource constraints (CPU limit, memory limit)

### SYNO.Docker.Container.Log

**Version**: 1 | Method: `get`

```
GET .../entry.cgi?api=SYNO.Docker.Container.Log&method=get&version=1
  &name=<container>
  &from=<timestamp>
  &to=<timestamp>
  &level=info
  &keyword=<search>
  &offset=0
  &limit=100
```

### SYNO.Docker.Container.Profile

**Version**: 1 | Method: `export` — export container config as JSON profile

### SYNO.Docker.Image

**Version**: 1

- `list` — `limit`, `offset`, `show_dsm=false` — list pulled images
- `delete` — `name` — remove an image

### SYNO.Docker.Registry

**Version**: 1

- `get` — registry configuration
- `search` — `q=<term>`, `offset`, `limit`, `page_size` — search Docker Hub

### SYNO.Docker.Network

**Version**: 1 | Method: `list` — list Docker networks (bridge, host, none, custom)

### SYNO.Docker.Project

**Version**: 1 | Methods: `list`, `get` — Docker Compose project management

---

## Backup & Active Backup

### Hyper Backup — SYNO.Backup

#### SYNO.Backup.Repository

**Version**: 1 | Methods: `list`, `get` (with `task_id`)

#### SYNO.Backup.Task

**Version**: 1

- `list` — all backup tasks
- `get` / `status` — `task_id`
- `backup` — run now: `task_id`
- `cancel`, `suspend`, `resume`, `discard`, `delete`

#### SYNO.Backup.Target

**Version**: 1

- `error_detect` — start integrity check: `task_id`, `detect_data`
- `error_detect_cancel`

#### SYNO.SDS.Backup.Client.Common.Log

**Version**: 1 | Method: `list` — backup logs with filter: `keyword`, `date_from/to`, `offset`, `limit`

#### SYNO.Backup.Service.VersionBackup.Target / Config

Vault (server) management: list targets, get/set concurrency settings.

### Active Backup for Business — SYNO.ActiveBackup

#### SYNO.ActiveBackup.Setting

**Version**: 1 | Methods: `list`, `set`

Set: `concurrent_backup_task_count`, `retention_policy_exec_time`, `traffic_throttle`

#### SYNO.ActiveBackup.Task

**Version**: 1

- `list` — `filter`, `load_status`, `load_result`, `load_devices`, `load_versions`
- `backup` — `task_ids`, `trigger_type`
- `cancel`, `remove`

#### SYNO.ActiveBackup.Version

**Version**: 1 | Method: `delete` — `task_id`, `version_ids`

#### SYNO.ActiveBackup.Log / Overview / Inventory

Logs, transfer statistics, VM hypervisor inventory.

---

## Shared Folders

### SYNO.Core.Share

**Version**: 1

- `list` — `share_type=local|usb|nas`, `additional=["real_path","quota","encryption","is_aclmode","owner","mount_point_type"]`
- `get` — `name`
- `create` — `name`, `vol_path`, `hidden`, `enable_recycle_bin`
- `delete` — `name`
- `set` (validate_set equivalent) — `name`, `vol_path`, `desc`, `encryption`, `enc_passwd`
- `clone` — `name`, `name_org`, `vol_path`, `share_quota`

### SYNO.Core.Share.Crypto

**Version**: 1

- `encrypt` — `name`
- `decrypt` — `name`, `password`

### SYNO.Core.Share.Permission

**Version**: 1

- `get` / `list` — by share name and user/group type
- `set` — update permissions for users/groups on a share

### SYNO.Core.Share.KeyManager.Store / AutoKey

**Version**: 1 — manage encryption key storage and auto-key mount configuration.

### SYNO.Core.Share.Snapshot

**Version**: 2 | Methods: `list`, `create`, `delete`, `set`

Create and manage Btrfs filesystem snapshots on a share.

---

## Package Center

### SYNO.Core.Package

**Version**: 1 | Methods: `list` (installed packages), `get` (single package)

List response fields: `id`, `name`, `version`, `status` (running/stopped), `description`, `package_icon`

### SYNO.Core.Package.Server

**Version**: 1 | Method: `list` — list packages available to install from configured sources

### SYNO.Core.Package.Setting

**Version**: 1

- `get` — current settings
- `set` — `enable_email`, `enable_dsm`, `enable_autoupdate`, `autoupdateall`, `update_channel`
- `feasibility_check` — check dependencies before install

### SYNO.Core.Package.Installation

**Version**: 1

- `install` — `url`, `name`, `checksum`, `filesize`, `operation`, `type`
- `upload` — multipart upload of .spk file
- `check` — pre-install check: `id`, `install_type`
- `upgrade` — `task_id`, `check_codesign`, `force`
- `status` — `task_id` — installation progress

### SYNO.Core.Package.Uninstallation

**Version**: 1 | Method: `uninstall` — `id`, `dsm_apps`

---

## Network

### SYNO.Core.Network

**Version**: 1–3 | Method: `get` — overall network configuration

Returns: hostname, gateway, DNS servers, interfaces summary. Also supports `set` and `test_internet`.

### SYNO.Core.Network.Ethernet

**Version**: 1 | Method: `list`

Returns per-interface info: `id` (eth0/eth1), `ip`, `mask`, `mac`, `speed`, `duplex`, `status`

### SYNO.Core.Network.Bond

**Version**: 1 | Methods: `list`, `get`, `set`, `create`, `delete`, `set_mode`

### SYNO.Core.Network.Bridge / LocalBridge

Bridge network management.

### SYNO.Core.Network.Wifi.Client

**Version**: 1 | Method: `list` — WiFi adapter status (if applicable)

### SYNO.Core.Network.Router.Topology

**Version**: 1 | Method: `get` — network topology map

### SYNO.Core.Network.Interface

**Version**: 1 | Method: `list` — all interfaces including virtual

### SYNO.Core.Network.DHCPServer (also SYNO.Network.DHCPServer)

**Version**: 4

- `get` — `ifname` — DHCP server config for interface
- `SYNO.Network.DHCPServer.ClientList.list` — `ifname` — active DHCP leases
- `SYNO.Network.DHCPServer.Reservation.get` — static reservations
- `SYNO.Network.DHCPServer.Vendor.get` — vendor options
- `SYNO.Network.DHCPServer.PXE.get` — PXE boot settings

### SYNO.Core.Network.NSM.Device

**Version**: 1 — Network Switch Manager device information (for managed switches connected to NAS).

### SYNO.Core.TFTP

**Version**: 1 | Method: `get` — TFTP server configuration

### SYNO.Core.FileServ.SMB / AFP / NFS / FTP / FTP.SFTP

**Version**: 1 | Method: `get`

Returns configuration for each file-sharing protocol (enabled status, settings).

### SYNO.VPNServer.Settings.Config

**Version**: 1 | Methods: `status_load`, `load`

- `load` with `serv_type=pptp|openvpn|l2tp` — get VPN server settings
- `status_load` — overall VPN server status

### SYNO.VPNServer.Management.Connection

**Version**: 1 | Method: `enum` — active VPN connections: `sort`, `dir`, `start`, `limit`

### SYNO.VPNServer.Management.Log

**Version**: 1 | Method: `load` — VPN connection logs

### SYNO.VPNServer.Management.Account

**Version**: 1 | Method: `load` — VPN user permissions

### SYNO.VPNServer.Settings.Certificate

**Version**: 1 | Method: `export` — export OpenVPN certificate/config

---

## Users & Groups

### SYNO.Core.User

**Version**: 1

- `list` — `offset`, `limit`, `sort_by`, `sort_direction`, `additional` (email, expired, cannot_chg_passwd, passwd_never_expire)
- `get` — `name`
- `create` — `name`, `password`, `description`, `email`, `expired`, `cannot_chg_passwd`, `passwd_never_expire`
- `set` — modify user
- `delete` — `name`

### SYNO.Core.User.Group

**Version**: 1 | Methods: `join`, `join_status` — add/remove user from groups

### SYNO.Core.User.PasswordPolicy

**Version**: 1 | Methods: `get`, `set`

Settings: `enable_reset_passwd_by_email`, `password_must_change`, strong password rules

### SYNO.Core.User.PasswordExpiry

**Version**: 1 | Methods: `get`, `set` — password expiry policy

### SYNO.Core.User.PasswordConfirm

**Version**: 1 | Method: `auth` — confirm current user's password (required before sensitive operations)

### SYNO.Core.User.UsernamePolicy

**Version**: 1 | Method: `list` — username restrictions

### SYNO.Core.Group

**Version**: 1 | Methods: `list`, `get`

### SYNO.Core.Group.Member

**Version**: 1 — group membership management

### SYNO.Core.Share.Permission (group perspective)

**Version**: 1 | Methods: `get_local_group_permissions`, `set_local_group_permissions`

---

## Security & Certificates

### SYNO.Core.Certificate.CRT

**Version**: 1

- `list` — all certificates: `id`, `desc`, `issuer`, `subject`, `valid_from`, `valid_till`, `is_default`
- `set` — `id`, `as_default=true` — set default certificate
- `delete` — `ids` (JSON array)

### SYNO.Core.Certificate

**Version**: 1

- `upload` (POST multipart) — `key`, `cert`, `inter_cert` files
- `export` — `file=archive`, `id` — download certificate as ZIP

### SYNO.Core.Certificate.Service

**Version**: 1 | Method: `set` — assign a certificate to a specific service

### SYNO.Core.Security.DSM

**Version**: 4 — DSM security settings: login policy, HTTPS enforcement, Secure SignIn

### SYNO.Core.Security.Firewall

**Version**: 1 — firewall rule management

### SYNO.Core.Security.AutoBlock

**Version**: 1 | Methods: `get`, `set` — auto-block configuration (block IPs after N failed logins)

### SYNO.SecurityAdvisor.Conf / LoginActivity / Checklist

**Version**: 1

- `get` — overall security advisor config
- `list` (LoginActivity) — `offset`, `limit` — recent login events
- `list` (Checklist) — `group=home` — security checklist items

### SYNO.Core.SecurityScan.Conf

**Version**: 1 | Methods: `get`, `group_enum` — security scan configuration

---

## Logs & Monitoring

### SYNO.Core.SyslogClient.Log

**Version**: 1 | Method: `list` — system logs with filters

### SYNO.Core.SyslogClient.Status

**Version**: 1

- `cnt_get` — log entry counts
- `eps_get` — events per second

### SYNO.LogCenter.RecvRule

**Version**: 1 | Method: `list` — log receiving rules

### SYNO.LogCenter.Log

**Version**: 1 | Method: `get_remotearch_subfolder` — remote log archives

### SYNO.LogCenter.Setting.Storage

**Version**: 1 | Method: `get` — log storage configuration

### SYNO.LogCenter.Client

**Version**: 1 | Method: `get` — syslog client configuration

### SYNO.LogCenter.History

**Version**: 1 | Method: `list` — log history

---

## Task Scheduler

### SYNO.Core.TaskScheduler

**Versions**: 1–4

- `list` (v3) — `sort_by`, `sort_direction`, `offset`, `limit` — all scheduled tasks
- `get` (v4) — `id`, `real_owner`, `type`
- `results` (v1) — `id` — task run history
- `set_enable` (v2) — `id`, `real_owner`, `enable`
- `run` (v2) — `id`, `real_owner` — run task now
- `delete` (v2) — `id`, `real_owner`
- `create` (v4, root-privileged) — `name`, `owner`, `script`, `schedule`, `extra`
  - Requires `SynoConfirmPWToken` for root tasks
- `modify` (v4) — update existing task

**Schedule format**: cron-like object with `date_type`, `hour`, `minute`, `week_day`, `month_week_day` fields.

**Task types**: `script`, `beep_control`, `service_control`, `recycle_bin`

### SYNO.Core.EventScheduler

**Version**: 1

- `get`/`set` — `type=esynoscheduler` — configure output logging for task scheduler

---

## VPN Server

All under `entry.cgi`. Methods covered in [Network section](#network) above.

Additional API:

### SYNO.Core.Security.AutoBlock

Shared with security — auto-block settings for VPN login attempts.

---

## Cloud Sync

Requires Cloud Sync package.

### SYNO.CloudSync

**Version**: 2 | All methods on single namespace

**Read operations**:
- `get_config` — global config
- `list_conn` — all sync connections (supports `group_by`)
- `get_connection_setting` — `connection_id`
- `get_property` — connection info
- `get_conn_auth_info` — auth credentials (masked)
- `get_log` — `connection_id`, `offset`, `keyword`, `date_from/to`, `log_level`, `action`, `limit`
- `list_sess` — tasks for a connection
- `get_selective_sync_config` — `session_id`
- `get_selective_folder_list` — `session_id`, `path`, `file_id`
- `get_recently_change` — recently synced files

**Write operations**:
- `set_global_config` — `repo_vol_path`, `log_count`, `worker_count`
- `set_connection_setting` — speed limits, storage class
- `set_schedule_setting` — schedule for a connection
- `set_session_setting` — sync direction, conflict handling, deletion behavior
- `set_selective_sync_config` — path/name/extension filters

**Actions**:
- `pause` / `resume` — `connection_id` (optional, omit to affect all)
- `unlink_connection` / `unlink_session`
- `create_session` — create new sync task

---

## Snapshots

Requires Btrfs filesystem on the volume.

### SYNO.Core.Share.Snapshot

**Version**: 2

- `list` — `share_name`, `filter`, `additional`, `offset`, `limit`
- `create` — `share_name`, `snapinfo` (description, is_locked)
- `delete` — `share_name`, `snapshots` (array of snapshot names)
- `set` — update snapshot attributes (lock/description)

### SYNO.Core.ISCSI.LUN

**Version**: 1

- `list` — `types`, `additional`
- `list_snapshot` — `src_lun_uuid`
- `take_snapshot` — `src_lun_uuid`, `description`, `is_locked`, `is_app_consistent`
- `delete_snapshot` — `snapshot_uuids`

### SYNO.DR.Plan

Disaster recovery replication:
- `list` — `additional`
- `sync` — `plan_id`, `lock_snapshot`, `description`

---

## Reverse Proxy

### SYNO.Core.AppPortal.ReverseProxy

**Version**: 1

**List rules**:
```
GET .../entry.cgi?api=SYNO.Core.AppPortal.ReverseProxy&method=list&version=1&_sid=<sid>
```
Response: array of `{ uuid, description, frontend: { fqdn, port, protocol }, backend: { fqdn, port, protocol } }`

Protocol values: `0` = HTTP, `1` = HTTPS

**Create rule**:
```
POST .../entry.cgi
Content-Type: application/x-www-form-urlencoded

api=SYNO.Core.AppPortal.ReverseProxy
method=create
version=1
entry=<JSON string>  # full entry object
_sid=<sid>
```

Entry object:
```json
{
  "description": "My Service",
  "frontend": { "fqdn": "app.example.com", "port": 443, "protocol": 1, "https": { "hsts": false } },
  "backend": { "fqdn": "192.168.1.100", "port": 8080, "protocol": 0 },
  "proxy_connect_timeout": 60,
  "proxy_read_timeout": 60,
  "proxy_send_timeout": 60,
  "proxy_http_version": 1,
  "proxy_intercept_errors": false,
  "customize_headers": []
}
```

**Update rule**: `method=set` with `UUID` field in entry object.

**Delete rule**: `method=delete&uuid=<uuid>`

**Note**: The update (`set`) method may return error 103 (unknown error) but still apply the changes. This is a known Synology bug.

---

## SSH CLI Tools

SSH as `admin` (or root via `sudo`) enables a Linux shell on DSM. The OS is a custom Linux with a set of `syno*` utilities.

### Package Management

```bash
synopkg list                          # list installed packages (id, version, status)
synopkg start <package-id>            # start a package service
synopkg stop <package-id>             # stop a package service
synopkg restart <package-id>          # restart
synopkg status <package-id>           # running/stopped/broken
synopkg install /path/to/file.spk     # install from local file
synopkg uninstall <package-id>
```

### Service Management

```bash
synoservice --status <service>         # check service status
synoservice --restart <service>        # restart
synoservicecfg --list                  # list all configurable services
synoservicecfg --stop <service>        # graceful stop
synoservicecfg --hard-stop <service>   # force stop
synoservicecfg --start <service>       # start
synoservicecfg --hard-start <service>
synoservicectl --restart <service>     # restart (newer tool)
synosystemctl restart sshd.service     # systemd-like control
```

### System Information

```bash
synoinfo                               # NAS model info (reads /etc/synoinfo.conf)
synogetkeyvalue /etc/synoinfo.conf <key>   # read a key from synoinfo.conf
synosetkeyvalue /etc/synoinfo.conf <key> <value>  # write a key
syno_system_dump                       # generate full diagnostic bundle
```

Common synoinfo keys: `upnpmodelname`, `synofirmware_version`, `productversion`, `buildphase`

### Disk & Storage

```bash
synodiskinfo                           # disk information and health
syno_disk_ctl                          # low-level disk control
syno_disk_information_daily_record     # scheduled disk health logging
syno_disk_health_record                # read disk health data
synopartition --list                   # partition layout
synopartition --check                  # verify partition integrity
synostorage --mail                     # send storage status report
```

### Network

```bash
synonet --show                         # network interface summary
synonet --get_hostname                 # current hostname
synonet --set_hostname <name>          # set hostname
synonet --set_gateway <ip>             # set gateway
synonet --wake <mac>                   # send WoL packet
```

### Shared Folders

```bash
synoshare --get <name>                 # share details
synoshare --enc_mount <name> <key>     # mount encrypted share
synoshare --enc_unmount <name>         # unmount encrypted share
synoshare --rename <old> <new>         # rename share
synoshare --setuser <share> <rw|ro|no> <username>  # set user access
synoshare --del <share>                # delete share
synospace                              # disk quota and usage
```

### User Management

```bash
synouser --get <username>              # user details
synouser --setpw <username> <password> # change password
synouser --rename <old> <new>          # rename user
synouser --add <user> <fullname> <desc> <passwd> <email>  # create user
```

### System Upgrade

```bash
synoupgrade --check                    # check for available update
synoupgrade --download                 # download latest firmware
synoupgrade --start                    # begin upgrade
synoupgrade --auto                     # enable auto-upgrade
```

### Performance Tuning

```bash
synotune --get                         # current performance profile
synotune --set throughput|latency      # switch performance profile
synobandwidth                          # bandwidth management
```

### Misc

```bash
synodsdefault --reset                  # reset to defaults (keeps data)
synodsdefault --factory-default        # full factory reset (destroys data)
synopoweroff                           # power off
syno_poweroff_task                     # schedule shutdown
synogear                               # install additional debugging tools
synofstop                              # monitor NFS activity
synowin -getWorkgroup                  # Windows workgroup name
```

---

## SNMP Monitoring

DSM supports SNMP v1, v2c, and v3. Configure in: Control Panel > Terminal & SNMP > SNMP.

**Important**: Synology DSM does **not** support SNMP traps. Pull-only monitoring.

### Synology Enterprise OID

Base OID: `1.3.6.1.4.1.6574`

### MIB Files

Synology provides these custom MIB files (download from Control Panel > SNMP or Synology developer site):

| MIB File | Description |
|----------|-------------|
| `SYNOLOGY-SYSTEM-MIB` | System info: temperature, fans, power |
| `SYNOLOGY-DISK-MIB` | Per-disk info: name, model, status, temp, SMART |
| `SYNOLOGY-RAID-MIB` | RAID/volume status |
| `SYNOLOGY-SMART-MIB` | Full SMART attribute table |
| `SYNOLOGY-UPS-MIB` | UPS status (if connected) |
| `SYNOLOGY-FLASHCACHE-MIB` | SSD cache status |
| `SYNOLOGY-EBOX-MIB` | Expansion unit status |
| `SYNOLOGY-GPUINFO-MIB` | GPU information |

Standard MIBs also active: `HOST-RESOURCES-MIB` (storage, processes), `IF-MIB` (network interfaces), `UCD-SNMP-MIB` (CPU, memory, load).

### Key OIDs

#### System (SYNOLOGY-SYSTEM-MIB)
| OID | Description |
|-----|-------------|
| `1.3.6.1.4.1.6574.1.1.0` | Model name |
| `1.3.6.1.4.1.6574.1.2.0` | System temperature (°C) |
| `1.3.6.1.4.1.6574.1.3.0` | System fan speed (RPM) |
| `1.3.6.1.4.1.6574.1.4.1.0` | CPU fan 1 speed (RPM) |
| `1.3.6.1.4.1.6574.1.4.2.0` | CPU fan 2 speed (RPM) |
| `1.3.6.1.4.1.6574.1.5.1.0` | DSM upgrade available (0=no, 1=yes) |
| `1.3.6.1.4.1.6574.1.5.3.0` | DSM version string |
| `1.3.6.1.4.1.6574.1.5.4.0` | Update status |

#### Disk (SYNOLOGY-DISK-MIB) — table indexed by disk number
| OID | Description |
|-----|-------------|
| `1.3.6.1.4.1.6574.2.1.1.2.X` | Disk name (e.g. "Disk 1") |
| `1.3.6.1.4.1.6574.2.1.1.3.X` | Disk model |
| `1.3.6.1.4.1.6574.2.1.1.4.X` | Disk vendor |
| `1.3.6.1.4.1.6574.2.1.1.5.X` | Disk status (1=Normal, 2=Initialized, 3=NotInitialized, 4=SystemPartitionFailed, 5=Crashed) |
| `1.3.6.1.4.1.6574.2.1.1.6.X` | Disk temperature (°C) |

#### RAID/Volume (SYNOLOGY-RAID-MIB) — table indexed by RAID index
| OID | Description |
|-----|-------------|
| `1.3.6.1.4.1.6574.3.1.1.2.X` | RAID name |
| `1.3.6.1.4.1.6574.3.1.1.3.X` | RAID status (1=Normal, 2=Repairing, 3=Migrating, 4=Expanding, 5=Deleting, 6=Creating, 7=RaidSyncing, 8=RaidParityChecking, 9=RaidAssembling, 10=Canceling, 11=Degrade, 12=Crashed) |
| `1.3.6.1.4.1.6574.3.1.1.4.X` | RAID free size (KB) |
| `1.3.6.1.4.1.6574.3.1.1.5.X` | RAID total size (KB) |

#### Standard Host Resources (via HOST-RESOURCES-MIB)
| OID | Description |
|-----|-------------|
| `1.3.6.1.2.1.25.1.1.0` | System uptime (hundredths of seconds) |
| `1.3.6.1.2.1.25.2.3.1.3.X` | Storage area description |
| `1.3.6.1.2.1.25.2.3.1.4.X` | Allocation unit size (bytes) |
| `1.3.6.1.2.1.25.2.3.1.5.X` | Total storage size (in allocation units) |
| `1.3.6.1.2.1.25.2.3.1.6.X` | Used storage (in allocation units) |

#### CPU/Memory (UCD-SNMP-MIB)
| OID | Description |
|-----|-------------|
| `1.3.6.1.4.1.2021.10.1.3.1` | 1-minute load average |
| `1.3.6.1.4.1.2021.10.1.3.2` | 5-minute load average |
| `1.3.6.1.4.1.2021.10.1.3.3` | 15-minute load average |
| `1.3.6.1.4.1.2021.4.5.0` | Total RAM (KB) |
| `1.3.6.1.4.1.2021.4.6.0` | Available RAM (KB) |

### SNMP Configuration Notes

- SNMPv2c: configure community string (default often `public`)
- SNMPv3: supports auth (MD5/SHA) and privacy (DES/AES) — preferred for security
- Must use SNMPv2c or v3 to get full Synology OID tree; v1 has limitations
- All MIBs must be imported together in your NMS due to interdependencies
- OID indices (X) for disks and volumes may vary — use `snmpwalk` to discover

---

## Webhooks & Notifications

DSM 7 supports outbound webhooks for system notifications. Configure in: Control Panel > Notification > Push Service > Manage Webhooks.

### How It Works

DSM fires outbound HTTP POST requests to configured webhook URLs when system events occur. This is **outbound only** — DSM pushes to your endpoint; it does not poll or expose an inbound event subscription API.

### Built-in Providers

| Provider | Notes |
|----------|-------|
| Slack | Slack Incoming Webhook format |
| Discord | Discord webhook format |
| Microsoft Teams | Teams webhook format |
| Mattermost | Available from DSM 7.2 |
| Rocket.Chat | Available from DSM 7.1 |
| Custom | Arbitrary HTTP POST endpoint |

### Custom Webhook Configuration

- **HTTP Method**: POST
- **Headers**: Set `Content-Type: application/json` (required for most targets)
- **Body**: Configure a template with the `%MSG%` placeholder for the notification text

Example custom body:
```json
{ "text": "%MSG%" }
```

### Event Categories (Rules Tab)

DSM lets you selectively enable/disable notification categories:
- Storage events (disk failure, volume degraded, RAID rebuilding)
- Backup completion/failure
- DSM update available
- Security alerts (login failure, auto-block)
- UPS events
- Service start/stop
- Temperature warnings
- USB connect/disconnect

### Notification APIs (Managing via Web API)

#### SYNO.Core.Notification.Mail

**Version**: 2 — configure email notification settings (SMTP server, recipients)

#### SYNO.Core.Notification.SMS

**Version**: 2 — SMS notification configuration

#### SYNO.Core.PersonalNotification.Device / Event / Filter

**Version**: 1 — per-user notification preferences and device push tokens

### DSM Mobile Push

DSM Synology Assistant app receives native push notifications via Synology's cloud push relay. No webhook configuration needed for mobile alerts.

---

## MQTT Support

**Synology DSM has no built-in MQTT support.** There is no native MQTT broker or MQTT-based event publishing in DSM.

Options for MQTT integration:

1. **Install Mosquitto via Package Center** (community package via SynoCommunity): runs a full MQTT broker on the NAS
2. **Use DSM webhooks** (above) to bridge events to an external MQTT broker via a small relay service
3. **Poll the Web API** on a schedule and publish results to your own MQTT broker

There is no official Synology MQTT API or event stream.

---

## What Maisie Implements vs. What's Available

### Currently Implemented (`packages/agent/src/skills/synology/dsm-client.ts`)

| Method | API Used | Notes |
|--------|----------|-------|
| `login()` | `SYNO.API.Auth v6` | sid-based, session re-auth on 105 |
| `getSystemInfo()` | `SYNO.DSM.Info v2 getinfo` | model, RAM, temp, uptime, version |
| `getSystemUtilization()` | `SYNO.Core.System.Utilization v1 get` | CPU load, memory |
| `getStorageInfo()` | `SYNO.Storage.CGI.Storage v1 load_info` | volumes + disks |
| `listFiles()` | `SYNO.FileStation.List v2 list` | with size/time additional |
| `uploadFile()` | `SYNO.FileStation.Upload v2` | multipart form |
| `downloadFile()` | `SYNO.FileStation.Download v2` | returns raw Response |
| `deleteFiles()` | `SYNO.FileStation.Delete v2` | synchronous delete |
| `getReverseProxyRules()` | `SYNO.Core.AppPortal.ReverseProxy v1 list` | |
| `createReverseProxyRule()` | `SYNO.Core.AppPortal.ReverseProxy v1 create` | JSON body via POST |
| `updateReverseProxyRule()` | `SYNO.Core.AppPortal.ReverseProxy v1 set` | returns 103 but works |
| `getDockerContainers()` | `SYNO.Docker.Container v1 list` | |
| `getDockerContainerDetails()` | `SYNO.Docker.Container v1 get` | |
| `startContainer()` | `SYNO.Docker.Container v1 start` | |
| `stopContainer()` | `SYNO.Docker.Container v1 stop` | |

### High-Value Gaps for Maisie to Consider

| Capability | API | Priority |
|------------|-----|----------|
| Fan speeds | `SYNO.Core.Hardware.FanSpeed` | High — health monitoring |
| System status/alerts | `SYNO.Core.System.Status` | High — health monitoring |
| SNMP polling | OID `1.3.6.1.4.1.6574.*` | Medium — alternative monitoring path |
| Network interface info | `SYNO.Core.Network.Ethernet` | Medium — Natalie persona |
| Package management | `SYNO.Core.Package` | Medium — operational |
| Backup task status | `SYNO.Backup.Task` | Medium — observability |
| Share folder management | `SYNO.Core.Share` | Medium — storage ops |
| System log access | `SYNO.Core.SyslogClient.Log` | Medium — observability |
| Download Station | `SYNO.DownloadStation2.Task` | Low — existing Sonarr/Radarr path |
| Scheduled tasks | `SYNO.Core.TaskScheduler` | Low |
| Docker container logs | `SYNO.Docker.Container.Log` | Low |
| Certificate management | `SYNO.Core.Certificate.CRT` | Low |
| Webhook configuration | `SYNO.Core.PersonalNotification.*` | Low |
| Snapshot management | `SYNO.Core.Share.Snapshot` | Low |

### Missing from Maisie (Not Applicable for This Install)

- **Surveillance Station** — cameras are on UniFi Protect, not Synology
- **Audio/Video Station** — Plex is the media server; these are unused
- **VPN Server** — handled by UDM Pro
- **Virtual Machine Manager** — not installed
- **Active Backup** — may be relevant if backup tasks should be monitored

---

## Sources

- [DSM Login Web API Guide (Synology Developer Center)](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Os/DSM/All/enu/DSM_Login_Web_API_Guide_enu.pdf)
- [FileStation API Guide (Synology Developer Center)](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf)
- [Download Station API Guide (Synology Developer Center)](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/DownloadStation/All/enu/Synology_Download_Station_Web_API.pdf)
- [SNMP MIB Guide (Synology Developer Center)](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Firmware/DSM/All/enu/Synology_DiskStation_MIB_Guide.pdf)
- [N4S4/synology-api — Python library with 300+ APIs](https://github.com/N4S4/synology-api)
- [kwent/syno — Node.js wrapper with DSM API definitions](https://github.com/kwent/syno)
- [DSM 6.2 API Namespace Gist (Rhilip)](https://gist.github.com/Rhilip/fed6b4f69e3cc19b79c4ab17b9a17e93)
- [DSM 6 API Query Gist (ivaniskandar)](https://gist.github.com/ivaniskandar/5c9d00d7577b49c43ce960a18971ab81)
- [N4S4 Supported APIs docs](https://n4s4.github.io/synology-api/docs/apis)
- [kwent/syno Video Station API wiki](https://github.com/kwent/syno/wiki/Video-Station-API)
- [Home Assistant Synology DSM integration](https://www.home-assistant.io/integrations/synology_dsm/)
- [Synology DSM webhook notifications (blackvoid.club)](https://www.blackvoid.club/dsm-push-notifications-with-webhooks/)
- [DSM Login Web API Guide — Knowledge Center](https://kb.synology.com/en-global/DG/DSM_Login_Web_API_Guide/2)
- [SNMP MIB Guide — Knowledge Center](https://kb.synology.com/en-global/DG/Synology_DiskStation_MIB_Guide/1)
- [Webhooks — DSM Knowledge Center](https://kb.synology.com/en-id/DSM/help/DSM/AdminCenter/system_notification_webhook?version=7)
- [darknebular/Synology_Commands cheatsheet](https://github.com/darknebular/Synology_Commands)
