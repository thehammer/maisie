# UniFi API Catalog

Complete reverse-engineered and community-documented API surface for UniFi Network, UDM Pro system, and UniFi Protect. Intended as a reference for building the universal protocol layer in Maisie.

**Sources**: ubntwiki.com, Art-of-WiFi/UniFi-API-client, hjdhjd/unifi-protect, hjdhjd/homebridge-unifi-protect, itsablabla/unifi-protect-mcp, Ubiquiti developer portal (developer.ui.com), community forums, code archaeology.

**Status key**: `[impl]` = already implemented in Maisie · `[avail]` = available, not yet used · `[undoc]` = community-discovered, no official docs

---

## Table of Contents

1. [Authentication & Sessions](#1-authentication--sessions)
2. [UniFi Network Application API](#2-unifi-network-application-api)
   - [Controller-Level Endpoints](#21-controller-level-endpoints)
   - [Site-Level Statistics & Status](#22-site-level-statistics--status)
   - [Client Management](#23-client-management)
   - [Device Management](#24-device-management)
   - [Wireless (WLAN) Configuration](#25-wireless-wlan-configuration)
   - [Network Configuration](#26-network-configuration)
   - [Firewall & Security](#27-firewall--security)
   - [Routing & Port Forwarding](#28-routing--port-forwarding)
   - [Traffic Rules (v2 API)](#29-traffic-rules-v2-api)
   - [DPI & Statistics Reports](#210-dpi--statistics-reports)
   - [Events, Alarms & Notifications](#211-events-alarms--notifications)
   - [Site Management & Administration](#212-site-management--administration)
   - [Backup & System Commands](#213-backup--system-commands)
   - [Hotspot & Guest Portal](#214-hotspot--guest-portal)
   - [AP Groups, Tags & Profiles](#215-ap-groups-tags--profiles)
   - [RADIUS & VPN](#216-radius--vpn)
   - [WebSocket Events](#217-websocket-events)
3. [UDM Pro System API](#3-udm-pro-system-api)
4. [UniFi Protect API](#4-unifi-protect-api)
   - [HTTP Endpoints](#41-http-endpoints)
   - [Bootstrap Object](#42-bootstrap-object)
   - [Camera Operations](#43-camera-operations)
   - [Other Devices: Lights, Sensors, Chimes, Viewers](#44-other-devices-lights-sensors-chimes-viewers)
   - [Events & AI Detection](#45-events--ai-detection)
   - [Liveviews & Streaming](#46-liveviews--streaming)
   - [WebSocket: Updates Stream](#47-websocket-updates-stream)
   - [MQTT Bridge (homebridge-unifi-protect convention)](#48-mqtt-bridge-homebridge-unifi-protect-convention)
5. [SSH Access & Shell](#5-ssh-access--shell)
6. [Rate Limiting & Quirks](#6-rate-limiting--quirks)
7. [Maisie Implementation Gap Analysis](#7-maisie-implementation-gap-analysis)

---

## 1. Authentication & Sessions

### Session-Based Auth (all platforms)

UniFi OS (UDM Pro and all current consoles) uses a single login endpoint that returns both a session cookie and a CSRF token.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | `[impl]` Login, returns `TOKEN` cookie + `X-CSRF-Token` header |
| POST | `/api/auth/logout` | `[avail]` Destroy session |
| GET | `/api/users/self` | `[impl]` Current user info (also used as session probe) |
| GET | `/api/self` | `[impl]` Alias used on some older firmware |

**Login body**:
```json
{ "username": "admin", "password": "secret", "remember": true }
```

**Response**: Sets `TOKEN` cookie. All subsequent write requests must include `X-CSRF-Token` header extracted from `x-csrf-token` response header. The token refreshes on each response — always use the latest one.

**Legacy controller (non-OS) auth**:
- Login: `POST /api/login` (body same as above)
- Logout: `POST /api/logout`
- Session check: `GET /api/self`

### API Key Auth (UniFi OS 3.2+)

Available on: UDM, UDR, UCG, UX, UDW, UCG-Ultra, UniFi OS Server. Generate in Settings > API Keys.

```
Authorization: X-API-KEY {key}
```

No login/logout needed. API key is scoped to the owner account and grants full access to all applications (Network + Protect). **Quirk**: As of 2025, API keys grant owner-level access and cannot be scoped to read-only or per-application — known HA issue #149762.

### Endpoint Prefix Differences

| Platform | Prefix required |
|----------|----------------|
| Legacy UniFi Controller (CloudKey, software) | None — use bare `/api/...` |
| UDM Pro / UniFi OS | `/proxy/network` before all Network endpoints |
| Protect on UDM Pro | `/proxy/protect` before all Protect endpoints |

Example: `GET /proxy/network/api/s/default/stat/sta`

---

## 2. UniFi Network Application API

All site-level endpoints use the pattern: `/proxy/network/api/s/{site}/...` where `{site}` is typically `default`.

### 2.1 Controller-Level Endpoints

No site context required.

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/status` | Basic server info — only endpoint accessible without auth | `[avail]` |
| GET | `/proxy/network/api/self/sites` | All sites on controller (basic info) | `[avail]` |
| GET | `/proxy/network/api/stat/sites` | Sites with health data and alert counts | `[avail]` |
| GET | `/proxy/network/api/stat/admin` | All administrator accounts | `[avail]` |
| POST | `/proxy/network/api/system/poweroff` | Power down UDM — requires `X-CSRF-Token`, Super Admin | `[avail]` |
| POST | `/proxy/network/api/system/reboot` | Reboot UDM — requires `X-CSRF-Token`, Super Admin | `[avail]` |
| GET | `/dl/firmware/bundles.json` | Device name/model mappings (no auth required) | `[avail]` |
| GET | `/v2/api/fingerprint_devices/{source}` | Fingerprinted device types | `[avail]` |

### 2.2 Site-Level Statistics & Status

Base: `/proxy/network/api/s/{site}/`

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `stat/health` | `[impl]` Site health subsystems (wan, lan, wlan, vpn, www) | `[impl]` |
| GET | `stat/sysinfo` | `[impl]` Controller version, uptime, timezone, update availability | `[impl]` |
| GET | `self` | Logged-in user info for this site | `[avail]` |
| GET | `stat/ccode` | Available country codes | `[avail]` |
| GET | `stat/current-channel` | RF channels available for this site's country code | `[avail]` |
| GET | `stat/dashboard` | Dashboard tile metrics (tx/rx bytes, num clients, etc.) | `[avail]` |
| GET | `stat/sdn` | UniFi cloud / SSO connection status | `[avail]` |
| GET | `stat/session` | Login session history (`type=all`, `start`, `end` params) | `[avail]` |
| GET | `stat/stream` | EDU streaming status | `[avail]` |
| GET | `stat/guest` | Guest device list | `[avail]` |
| GET | `stat/alluser` | All ever-seen clients (including offline), with `start`/`end` time window | `[avail]` |
| GET | `stat/authorization` | Guest authorization codes/records | `[avail]` |

**Health subsystem keys**: `wan`, `lan`, `wlan`, `vpn`, `www`, `nas` (if NAS detected). Each has `status` (`ok`/`warning`/`error`) and subsystem-specific fields like `wan_ip`, `num_adopted`, `num_sta`.

### 2.3 Client Management

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `stat/sta` | `[impl]` Active/online clients | `[impl]` |
| GET | `stat/sta/{mac}` | Single active client by MAC | `[avail]` |
| GET | `stat/user/{mac}` | Client historical data | `[avail]` |
| GET | `rest/user` | `[impl]` All configured/known clients (including offline) | `[impl]` |
| POST | `rest/user` | Filter known clients by `{"macs": [...]}` | `[avail]` |
| PUT | `rest/user/{_id}` | Update client attributes (name, fixed IP, notes, user group) | `[avail]` |
| PUT | `upd/user/{_id}` | Quick update (name or note only) | `[avail]` |
| POST | `group/user` | Create new user/client record | `[avail]` |

**Client commands** — POST to `cmd/stamgr` with JSON body:

| `cmd` value | Additional fields | Description | Status |
|-------------|------------------|-------------|--------|
| `block-sta` | `mac` | `[impl]` Block client from network | `[impl]` |
| `unblock-sta` | `mac` | `[impl]` Unblock client | `[impl]` |
| `kick-sta` | `mac` | Force disconnect (WiFi), re-auth required | `[avail]` |
| `forget-sta` | `mac` | Remove from known clients (v5.9+) | `[avail]` |
| `unauthorize-guest` | `mac` | Revoke guest portal authorization | `[avail]` |

**Key client fields**: `mac`, `ip`, `hostname`, `name`, `oui`, `network`, `is_wired`, `last_seen`, `first_seen`, `ap_mac`, `essid`, `sw_mac`, `sw_port`, `blocked`, `_uptime_by_uap`, `use_fixedip`, `fixed_ip`, `usergroup_id`.

### 2.4 Device Management

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `stat/device-basic` | `[impl]` Device list — only `adopted`, `disabled`, `mac`, `state`, `type` | `[impl]` |
| GET | `stat/device` | `[impl]` Full device details (all fields) | `[impl]` |
| POST | `stat/device` | Filter devices by `{"macs": [...]}` | `[avail]` |
| GET | `stat/device/{mac}` | Single device by MAC (UDM only, use POST filter on others) | `[avail]` |
| PUT | `rest/device/{_id}` | Update device config (name, LED override, port overrides, etc.) | `[avail]` |

**Device commands** — POST to `cmd/devmgr`:

| `cmd` value | Additional fields | Description | Status |
|-------------|------------------|-------------|--------|
| `adopt` | `mac` | Adopt discovered device | `[avail]` |
| `restart` | `mac` | Restart/reboot device | `[avail]` |
| `force-provision` | `mac` | Force re-provision (push config) | `[avail]` |
| `power-cycle` | `mac`, `port_idx` | Power cycle PoE switch port | `[avail]` |
| `upgrade` | `mac` | Upgrade firmware to latest | `[avail]` |
| `upgrade-external` | `mac`, `url` | Upgrade from explicit URL | `[avail]` |
| `migrate` | `mac`, `inform_url` | Push new inform URL | `[avail]` |
| `cancel-migrate` | `mac` | Cancel pending migration | `[avail]` |
| `set-locate` | `mac` | Blink LED for physical location | `[avail]` |
| `unset-locate` | `mac` | Return LED to normal | `[avail]` |
| `spectrum-scan` | `mac` | Trigger RF spectrum scan (AP only) | `[avail]` |
| `speedtest` | — | Start WAN speed test | `[avail]` |
| `speedtest-status` | — | Poll speed test progress | `[avail]` |

**Device types** (`type` field): `ugw` (gateway/UDM), `usw` (switch), `uap` (access point), `udm` (UDM/UDM Pro), `uph` (phone/hub).

**Device state codes**: `0`=disconnected, `1`=connected/adopted, `2`=pending adoption, `4`=upgrading, `5`=provisioning, `6`=heartbeat missed, `7`=deleted.

**Move/delete device** — POST to `cmd/sitemgr`:

| `cmd` value | Fields | Description |
|-------------|--------|-------------|
| `move-device` | `mac`, `site_id` | Move device to different site |
| `delete-device` | `mac` | Remove device from controller |

### 2.5 Wireless (WLAN) Configuration

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `rest/wlanconf` | `[impl]` List all WLANs | `[impl]` |
| GET | `rest/wlanconf/{_id}` | Single WLAN config | `[avail]` |
| POST | `rest/wlanconf` | Create new WLAN | `[avail]` |
| PUT | `rest/wlanconf/{_id}` | Update WLAN (name, PSK, VLAN, band, security, etc.) | `[avail]` |
| DELETE | `rest/wlanconf/{_id}` | Delete WLAN | `[avail]` |
| GET | `list/wlangroup` | WLAN groups (for per-AP SSID assignment) | `[avail]` |
| GET | `v2/api/site/{site}/apgroups` | AP groups (v2) | `[avail]` |
| POST | `v2/api/site/{site}/apgroups` | Create AP group | `[avail]` |
| PUT | `v2/api/site/{site}/apgroups/{id}` | Update AP group | `[avail]` |
| DELETE | `v2/api/site/{site}/apgroups/{id}` | Delete AP group | `[avail]` |

**Key WLAN fields**: `name`, `x_passphrase` (PSK), `security` (`wpapsk`, `wpaeap`, `open`), `wpa_mode`, `vlan_enabled`, `vlanid`, `enabled`, `is_guest`, `hide_ssid`, `band`, `wlan_band`, `schedule_enabled`, `schedule`.

### 2.6 Network Configuration

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `rest/networkconf` | `[impl]` All network definitions (VLANs, WAN, VPN, etc.) | `[impl]` |
| GET | `rest/networkconf/{_id}` | Single network | `[avail]` |
| POST | `rest/networkconf` | Create network | `[avail]` |
| PUT | `rest/networkconf/{_id}` | Update network | `[avail]` |
| DELETE | `rest/networkconf/{_id}` | Delete network | `[avail]` |
| GET | `rest/portconf` | Switch port profiles | `[avail]` |
| PUT | `rest/portconf/{_id}` | Update port profile | `[avail]` |
| GET | `rest/setting` | `[impl]` All site settings (large blob) | `[impl]` |
| PUT | `rest/setting/{key}/{_id}` | `[impl]` Update a specific settings section | `[impl]` |

**Settings keys** (used in `rest/setting/{key}`): `country`, `locale`, `snmp`, `mgmt`, `guest_access`, `ntp`, `connectivity`, `ips`, `dpi`, `usg`, `super_identity`, `porta`, `radius`, `vpn`, `provider_capabilities`.

**Network `purpose` values**: `corporate` (LAN/VLAN), `guest`, `wan`, `vlan-only`, `vpn-client`, `vpn-server`.

### 2.7 Firewall & Security

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `rest/firewallrule` | `[impl]` User-defined firewall rules (not auto-generated) | `[impl]` |
| GET | `rest/firewallrule/{_id}` | Single rule | `[avail]` |
| POST | `rest/firewallrule` | Create firewall rule | `[avail]` |
| PUT | `rest/firewallrule/{_id}` | Update firewall rule | `[avail]` |
| DELETE | `rest/firewallrule/{_id}` | Delete firewall rule | `[avail]` |
| GET | `rest/firewallgroup` | Firewall groups (address/port groups) | `[avail]` |
| GET | `rest/firewallgroup/{_id}` | Single group | `[avail]` |
| POST | `rest/firewallgroup` | Create firewall group | `[avail]` |
| PUT | `rest/firewallgroup/{_id}` | Update group | `[avail]` |
| DELETE | `rest/firewallgroup/{_id}` | Delete group | `[avail]` |
| GET | `stat/ips/event` | IPS/IDS detected events | `[avail]` |

**Firewall rule fields**: `name`, `enabled`, `ruleset` (`WAN_IN`, `WAN_OUT`, `LAN_IN`, `LAN_OUT`, `GUEST_IN`, `GUEST_OUT`), `rule_index`, `action` (`accept`, `drop`, `reject`), `protocol`, `src_firewallgroup_ids`, `dst_firewallgroup_ids`, `src_address`, `dst_address`, `src_port`, `dst_port`, `logging`, `state_established`, `state_related`.

**Quirk**: `rest/firewallrule` only returns user-defined rules. Auto-generated rules (for port forwarding, Protect, etc.) are not accessible via this endpoint.

### 2.8 Routing & Port Forwarding

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `stat/routing` | `[impl]` Active routing table | `[impl]` |
| GET | `rest/routing` | `[impl]` User-defined static routes | `[impl]` |
| POST | `rest/routing` | Create static route | `[avail]` |
| PUT | `rest/routing/{_id}` | Update static route | `[avail]` |
| DELETE | `rest/routing/{_id}` | Delete static route | `[avail]` |
| GET | `rest/portforward` | `[impl]` Port forwarding rules | `[impl]` |
| GET | `stat/portforward` | Port forward stats (note: bytes fields not populated) | `[avail]` |
| POST | `rest/portforward` | Create port forward rule | `[avail]` |
| PUT | `rest/portforward/{_id}` | Update/toggle port forward rule | `[avail]` |
| DELETE | `rest/portforward/{_id}` | Delete port forward rule | `[avail]` |
| GET | `rest/dynamicdns` | DDNS config | `[avail]` |
| PUT | `rest/dynamicdns/{_id}` | Update DDNS config | `[avail]` |
| GET | `stat/dynamicdns` | DDNS status (current IP, last-changed, provider status) | `[avail]` |

**Port forward fields**: `name`, `enabled`, `fwd` (destination IP), `fwd_port`, `dst_port`, `proto` (`tcp`, `udp`, `tcp_udp`), `src` (source IP or `any`), `log`, `pfwd_interface` (WAN interface).

**Quirk**: `rest/routing` returns HTTP 500 on controller v7.1.66+; use `stat/routing` for read-only.

### 2.9 Traffic Rules (v2 API)

The v2 traffic rules API uses a different base path and returns `201` (not `200`) on successful PUT.

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/proxy/network/v2/api/site/{site}/trafficrules` | List all traffic rules | `[avail]` |
| POST | `/proxy/network/v2/api/site/{site}/trafficrules` | Create traffic rule | `[avail]` |
| PUT | `/proxy/network/v2/api/site/{site}/trafficrules/{id}/` | Update traffic rule (returns 201) | `[avail]` |
| DELETE | `/proxy/network/v2/api/site/{site}/trafficrules/{id}/` | Delete traffic rule | `[avail]` |

**Traffic rule fields**: `description`, `enabled`, `action` (`BLOCK`, `THROTTLE`, `ALLOW`), `matching_preference`, `target_devices`, `bandwidth_limit` (object with `upload_limit_kbps`, `download_limit_kbps`), `schedule`.

**Quirk**: Traffic rules do NOT apply to WireGuard VPN traffic. They apply to LAN/WLAN clients only.

### 2.10 DPI & Statistics Reports

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `stat/dpi` | `[impl]` Site-wide DPI (all apps/categories) | `[impl]` |
| POST | `stat/sitedpi` | DPI by `type=by_app` or `type=by_cat` | `[avail]` |
| POST | `stat/stadpi` | Per-client DPI (`type`, optional `macs` array) | `[avail]` |
| POST | `cmd/stat` `{"cmd":"clear-dpi"}` | Reset DPI counters | `[avail]` |
| POST | `stat/report/5minutes.site` | 5-min site traffic report | `[avail]` |
| POST | `stat/report/hourly.site` | Hourly site report | `[avail]` |
| POST | `stat/report/daily.site` | Daily site report | `[avail]` |
| POST | `stat/report/monthly.site` | Monthly site report | `[avail]` |
| POST | `stat/report/5minutes.ap` | 5-min per-AP report | `[avail]` |
| POST | `stat/report/hourly.ap` | Hourly per-AP report | `[avail]` |
| POST | `stat/report/daily.ap` | Daily per-AP report | `[avail]` |
| POST | `stat/report/monthly.ap` | Monthly per-AP report | `[avail]` |
| POST | `stat/report/5minutes.user` | 5-min per-client report | `[avail]` |
| POST | `stat/report/hourly.user` | Hourly per-client report | `[avail]` |
| POST | `stat/report/daily.user` | Daily per-client report | `[avail]` |
| POST | `stat/report/5minutes.gw` | 5-min gateway report | `[avail]` |
| POST | `stat/report/hourly.gw` | Hourly gateway report | `[avail]` |
| POST | `stat/report/daily.gw` | Daily gateway report | `[avail]` |
| GET | `stat/report/archive.speedtest` | Historical speed test results | `[avail]` |
| GET | `stat/rogueap` | Neighboring/rogue APs (`within` hours param) | `[avail]` |
| GET | `stat/spectrumscan` | RF scan results (`mac` filter optional) | `[avail]` |
| GET | `stat/gateway` | USG/UDM gateway performance stats | `[avail]` |

**Report body params**: `start` (unix ms), `end` (unix ms), `attrs` (array of metric names like `["bytes","tx_bytes","rx_bytes","num_sta"]`).

**DPI categories** (24 total): Instant messaging, P2P, File Transfer, Streaming Media, Mail, VoIP, Database, Games, Network Management, Remote Access, Proxies/Tunnels, Stock Market, Web, Security Updates, Social Networks, Unknown (255). App IDs = `(category << 16) + app_id`.

### 2.11 Events, Alarms & Notifications

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `stat/event` | Events, newest first, max 3000 results | `[avail]` |
| GET | `rest/event` | Events, oldest first, no limit (broken v7.1.66+) | `[avail]` |
| GET | `stat/alarm` | Alarms, newest first, max 3000 | `[avail]` |
| GET | `rest/alarm` | Alarms oldest first (`archived=false` param) | `[avail]` |
| POST | `cmd/evtmgt` `{"cmd":"archive-all-alarms"}` | Archive (dismiss) all alarms | `[avail]` |

**Event types** (from websocket): `EVT_AP_Connected`, `EVT_AP_Disconnected`, `EVT_AP_PossibleInterference`, `EVT_AP_Isolated`, `EVT_SW_Connected`, `EVT_SW_Disconnected`, `EVT_GW_WANTransition`, `EVT_GW_WANHigh`, `EVT_WU_Roam`, `EVT_WU_Connected`, `EVT_WU_Disconnected`, `EVT_LU_Connected`, `EVT_LU_Disconnected`.

### 2.12 Site Management & Administration

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| POST | `cmd/sitemgr` `{"cmd":"add-site","desc":"...","name":"..."}` | Create site | `[avail]` |
| POST | `cmd/sitemgr` `{"cmd":"delete-site","name":"..."}` | Delete site | `[avail]` |
| POST | `cmd/sitemgr` `{"cmd":"update-site","desc":"..."}` | Rename site | `[avail]` |
| POST | `cmd/sitemgr` `{"cmd":"get-admins"}` | List admins for this site | `[avail]` |
| POST | `cmd/sitemgr` `{"cmd":"invite-admin",...}` | Invite admin | `[avail]` |
| POST | `cmd/sitemgr` `{"cmd":"revoke-admin","admin_id":"..."}` | Revoke admin access | `[avail]` |
| GET | `rest/tag` | Device tags | `[avail]` |
| POST | `rest/tag` | Create tag | `[avail]` |
| PUT | `rest/tag/{_id}` | Update tag (assign devices) | `[avail]` |
| DELETE | `rest/tag/{_id}` | Delete tag | `[avail]` |
| GET | `rest/usergroup` | User groups (bandwidth limits) | `[avail]` |
| POST | `rest/usergroup` | Create user group | `[avail]` |
| PUT | `rest/usergroup/{_id}` | Update user group | `[avail]` |
| DELETE | `rest/usergroup/{_id}` | Delete user group | `[avail]` |

### 2.13 Backup & System Commands

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| POST | `cmd/backup` `{"cmd":"list-backups"}` | List autobackup files | `[avail]` |
| POST | `cmd/backup` `{"cmd":"delete-backup","filename":"..."}` | Delete backup file | `[avail]` |
| POST | `cmd/system` `{"cmd":"backup"}` | Create backup (saves to `/mnt/data/unifi-os/unifi/data/backup/`) | `[avail]` |
| GET | `dl/autobackup/{filename}` | Download a backup file | `[avail]` |

Backup filenames follow pattern: `autobackup_{version}_{date}.unf`

### 2.14 Hotspot & Guest Portal

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/guest/s/{site}/hotspotconfig` | Hotspot configuration | `[avail]` |
| GET | `/guest/s/{site}/hotspotpackages` | Available hotspot packages | `[avail]` |
| GET | `stat/voucher` | Hotspot vouchers | `[avail]` |
| GET | `stat/payment` | Hotspot payments | `[avail]` |

Note: these do not use the `/proxy/network` prefix — access directly at `/guest/...`.

### 2.15 AP Groups, Tags & Profiles

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/proxy/network/v2/api/site/{site}/apgroups` | List AP groups | `[avail]` |
| POST | `/proxy/network/v2/api/site/{site}/apgroups` | Create AP group | `[avail]` |
| PUT | `/proxy/network/v2/api/site/{site}/apgroups/{id}` | Update AP group | `[avail]` |
| DELETE | `/proxy/network/v2/api/site/{site}/apgroups/{id}` | Delete AP group | `[avail]` |
| GET | `rest/portconf` | Switch port profiles | `[avail]` |
| PUT | `rest/portconf/{_id}` | Update port profile | `[avail]` |

### 2.16 RADIUS & VPN

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `rest/radiusprofile` | RADIUS profiles | `[avail]` |
| POST | `rest/radiusprofile` | Create RADIUS profile | `[avail]` |
| PUT | `rest/radiusprofile/{_id}` | Update RADIUS profile | `[avail]` |
| DELETE | `rest/radiusprofile/{_id}` | Delete RADIUS profile | `[avail]` |
| GET | `rest/account` | RADIUS accounts | `[avail]` |
| POST | `rest/account` | Create RADIUS account | `[avail]` |
| PUT | `rest/account/{_id}` | Update RADIUS account | `[avail]` |
| DELETE | `rest/account/{_id}` | Delete RADIUS account | `[avail]` |

WireGuard and OpenVPN VPN server/client configuration is done through `rest/networkconf` (network entries with `purpose: "vpn-server"` or `"vpn-client"`). No dedicated VPN REST endpoint beyond settings.

### 2.17 WebSocket Events

**Endpoint**: `wss://{host}/proxy/network/wss/s/{site}/events`  
**Auth**: Session cookie required in WebSocket upgrade headers.

Messages are JSON with structure:
```json
{
  "meta": { "rc": "ok", "message": "event_type" },
  "data": [{ ... event payload ... }]
}
```

**`meta.message` event types**:

| Event | Description |
|-------|-------------|
| `sta:sync` | Client connected/disconnected/updated |
| `device:sync` | UniFi device state changed |
| `device:update` | Device config updated |
| `user:sync` | Known user record updated |
| `alarm` | New alarm triggered |
| `events` | General event (maps to `EVT_*` types) |
| `speed-test:update` | Speed test progress/result |
| `backup:done` | Backup completed |
| `notification` | System notification |

Also available: `wss://{host}/api/ws/system` for UniFi OS system-level events (independent of Network app).

---

## 3. UDM Pro System API

These endpoints are on the UniFi OS layer, not the Network application.

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/api/users/self` | `[impl]` Current logged-in user info | `[impl]` |
| GET | `/api/self` | `[impl]` Alias (older firmware) | `[impl]` |
| POST | `/api/auth/login` | `[impl]` Login (UniFi OS) | `[impl]` |
| POST | `/api/auth/logout` | Logout | `[avail]` |
| POST | `/api/system/reboot` | `[avail]` Reboot UDM (X-CSRF-Token required) | `[avail]` |
| POST | `/api/system/poweroff` | `[avail]` Power down UDM | `[avail]` |
| PUT | `/api/system/certificate` | `[impl]` Upload TLS certificate (cert + key JSON) | `[impl]` |
| PUT | `/proxy/protect/api/certificate` | `[impl]` Alternate cert upload path (tried as fallback) | `[impl]` |

**Certificate upload body**:
```json
{ "certificate": "-----BEGIN CERTIFICATE-----\n...", "privateKey": "-----BEGIN PRIVATE KEY-----\n..." }
```

**SSH/filesystem certificate path** (alternative to API):
- Cert: `/mnt/data/unifi-os/unifi-core/config/unifi-core.crt`
- Key: `/mnt/data/unifi-os/unifi-core/config/unifi-core.key`
- After replacing via SCP: `systemctl restart unifi-os`

**Note on data paths**: Path changed between firmware versions:
- Firmware 1.x: `/mnt/data/`
- Firmware 2.x, 3.x, 4.x+: `/data/` (symlink often exists at `/mnt/data` → `/data`)

---

## 4. UniFi Protect API

All endpoints under `/proxy/protect/`. The bootstrap is the primary data structure — most device info is retrieved from it rather than individual device endpoints.

### 4.1 HTTP Endpoints

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| GET | `/proxy/protect/api/bootstrap` | `[impl]` Complete NVR state — all devices, config, current status | `[impl]` |
| GET | `/proxy/protect/api/nvr` | `[impl]` NVR details (subset of bootstrap) | `[impl]` |
| PATCH | `/proxy/protect/api/nvr` | Update NVR settings | `[avail]` |
| GET | `/proxy/protect/api/cameras` | All cameras list | `[avail]` |
| GET | `/proxy/protect/api/cameras/{id}` | `[impl]` Single camera | `[impl]` |
| PATCH | `/proxy/protect/api/cameras/{id}` | Update camera settings | `[avail]` |
| GET | `/proxy/protect/api/cameras/{id}/snapshot` | `[avail]` On-demand JPEG snapshot | `[avail]` |
| POST | `/proxy/protect/api/cameras/{id}/snapshot` | Force generate snapshot | `[avail]` |
| GET | `/proxy/protect/api/cameras/{id}/package-snapshot` | Snapshot from package camera (dual-cam devices) | `[avail]` |
| POST | `/proxy/protect/api/cameras/{id}/rtsps-stream` | Create RTSPS stream token | `[avail]` |
| GET | `/proxy/protect/api/cameras/{id}/rtsps-stream` | List RTSPS streams for camera | `[avail]` |
| DELETE | `/proxy/protect/api/cameras/{id}/rtsps-stream` | Remove RTSPS stream | `[avail]` |
| POST | `/proxy/protect/api/cameras/{id}/talkback-session` | Initialize two-way audio session | `[avail]` |
| GET | `/proxy/protect/api/lights` | `[impl]` All lights (from bootstrap) | `[impl]` |
| GET | `/proxy/protect/api/lights/{id}` | Single light | `[avail]` |
| PATCH | `/proxy/protect/api/lights/{id}` | Update light settings | `[avail]` |
| GET | `/proxy/protect/api/sensors` | `[impl]` All sensors (from bootstrap) | `[impl]` |
| GET | `/proxy/protect/api/sensors/{id}` | Single sensor | `[avail]` |
| PATCH | `/proxy/protect/api/sensors/{id}` | Update sensor settings | `[avail]` |
| GET | `/proxy/protect/api/chimes` | All chimes | `[avail]` |
| GET | `/proxy/protect/api/chimes/{id}` | Single chime | `[avail]` |
| PATCH | `/proxy/protect/api/chimes/{id}` | Update chime (volume, tone) | `[avail]` |
| GET | `/proxy/protect/api/viewers` | All viewers (Viewport devices) | `[avail]` |
| GET | `/proxy/protect/api/viewers/{id}` | Single viewer | `[avail]` |
| PATCH | `/proxy/protect/api/viewers/{id}` | Update viewer (liveview assignment) | `[avail]` |
| GET | `/proxy/protect/api/liveviews` | `[impl]` All liveviews (from bootstrap) | `[impl]` |
| GET | `/proxy/protect/api/liveviews/{id}` | Single liveview | `[avail]` |
| POST | `/proxy/protect/api/liveviews` | Create liveview | `[avail]` |
| PATCH | `/proxy/protect/api/liveviews/{id}` | Update liveview | `[avail]` |
| DELETE | `/proxy/protect/api/liveviews/{id}` | Delete liveview | `[avail]` |
| GET | `/proxy/protect/api/events` | `[impl]` Query events with filters | `[impl]` |
| GET | `/proxy/protect/api/events/{id}` | Single event by ID | `[avail]` |

**Official v1 API** (developer.ui.com, newer firmware only):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/proxy/protect/integration/v1/meta/info` | Application version, features |
| GET | `/proxy/protect/integration/v1/cameras` | Camera list |
| GET | `/proxy/protect/integration/v1/cameras/{id}` | Camera details |
| PATCH | `/proxy/protect/integration/v1/cameras/{id}` | Update camera |
| GET | `/proxy/protect/integration/v1/cameras/{id}/snapshot` | Snapshot |
| POST | `/proxy/protect/integration/v1/cameras/{id}/rtsps-stream` | Create RTSPS stream |
| POST | `/proxy/protect/integration/v1/cameras/{id}/talkback-session` | Talkback session |
| GET | `/proxy/protect/integration/v1/viewers` | Viewer list |
| PATCH | `/proxy/protect/integration/v1/viewers/{id}` | Update viewer |
| GET | `/proxy/protect/integration/v1/liveviews` | Liveview list |
| POST | `/proxy/protect/integration/v1/liveviews` | Create liveview |
| PATCH | `/proxy/protect/integration/v1/liveviews/{id}` | Update liveview |
| GET | `/proxy/protect/integration/v1/sensors` | Sensor list |
| GET | `/proxy/protect/integration/v1/lights` | Light list |
| PATCH | `/proxy/protect/integration/v1/lights/{id}` | Control light |
| GET | `/proxy/protect/integration/v1/chimes` | Chime list |
| PATCH | `/proxy/protect/integration/v1/chimes/{id}` | Update chime |

### 4.2 Bootstrap Object

`GET /proxy/protect/api/bootstrap` returns a large JSON with:

| Field | Description |
|-------|-------------|
| `cameras` | Array of all camera configs and current state |
| `lights` | UniFi Floodlight and similar devices |
| `sensors` | Door/motion/temp/humidity/water sensors |
| `chimes` | Doorbell chimes |
| `viewers` | Viewport display devices |
| `liveviews` | Saved liveview layouts |
| `nvr` | NVR/controller info (version, mac, host, uptime, storage) |
| `users` | User accounts configured in Protect |
| `groups` | User permission groups |
| `lastUpdateId` | ID to use as `?lastUpdateId=` param when opening websocket |

**Maisie currently reads**: bootstrap for cameras, liveviews, sensors, lights, nvr.

### 4.3 Camera Operations

**Key camera fields** (from bootstrap/camera object):

| Field | Description |
|-------|-------------|
| `id` | Unique camera ID |
| `name` | Display name |
| `type` | Model identifier (e.g., `UVC-G4-PRO`, `UVC-AI-360`) |
| `mac` | MAC address |
| `host` | IP address |
| `state` | `CONNECTED`, `DISCONNECTED`, `UPDATING` |
| `isConnected` | Boolean |
| `isRecording` | Whether currently recording |
| `isMotionDetected` | Current motion state |
| `lastMotion` | Unix ms timestamp of last motion |
| `lastRing` | Unix ms timestamp of last doorbell ring |
| `featureFlags` | Object: `hasChime`, `hasSpeaker`, `hasLedIr`, `hasLcdScreen`, `hasMic`, `canOpticalZoom`, `canMechanicalPtzTilt`, `canMechanicalPtzPan`, `canMechanicalPtzZoom`, `hasPTZPresets`, `hasPackageCamera`, `hasSmartDetect`, `hasFlashlight` |
| `channels` | RTSP stream definitions (id, name, fps, bitrate, width, height, rtspAlias) |
| `smartDetectSettings` | `objectTypes`: array of enabled detection types |
| `motionZones` | Motion detection zones with coordinates |
| `smartDetectZones` | Smart detection zones |
| `lcdMessage` | Current doorbell LCD text (if applicable) |
| `ledSettings` | `isEnabled`, `blinkRate` |
| `micVolume` | Microphone sensitivity |
| `recordingSettings` | `mode`, `prePaddingSecs`, `postPaddingSecs` |
| `ispSettings` | Image settings: brightness, contrast, hue, saturation, sharpness, denoise, wdr |

**RTSP stream access**:
- RTSP (unencrypted): `rtsp://{nvr-ip}:7447/{rtspAlias}`
- RTSPS (TLS): `rtsps://{nvr-ip}:7441/{rtspAlias}`
- Stream tokens via `POST /proxy/protect/api/cameras/{id}/rtsps-stream`

**Smart detect object types**: `person`, `vehicle`, `animal`, `package`, `face`, `licensePlate`

**Audio detect types**: `alrmSmoke`, `alrmCarbonMonoxide`, `alrmBark`, `alrmGlassBreak`, `alrmBurglar`

**PTZ commands** (PATCH camera with `isPtzEnabled: true`):
```json
{ "ispSettings": { "focusMode": "auto" }, "ptzPresetId": "{preset-id}" }
```

### 4.4 Other Devices: Lights, Sensors, Chimes, Viewers

**Lights** (`/proxy/protect/api/lights/{id}`):

| Field | Description |
|-------|-------------|
| `isOn` | Current state |
| `lightDeviceSettings.isIndicatorEnabled` | Status LED |
| `lightDeviceSettings.ledLevel` | Brightness 1-6 |
| `lightDeviceSettings.pirDuration` | PIR sensitivity duration |
| `lightDeviceSettings.pirSensitivity` | PIR sensitivity level |
| `lightOnSettings.isLedForceOn` | Manual override on |

**Sensors** (`/proxy/protect/api/sensors/{id}`):

| Field | Description |
|-------|-------------|
| `isMotionDetected` | PIR motion |
| `isOpened` | Door/window contact |
| `alarmTriggered` | Alarm sound detected |
| `temperature.value` | Celsius |
| `humidity.value` | Percent |
| `light.value` | Lux |
| `leak.value` | Boolean (water detection) |
| `batteryStatus.percentage` | Battery level |
| `mountType` | `door`, `window`, `garage`, `none` |

**Chimes** (`/proxy/protect/api/chimes/{id}`):

| Field | Description |
|-------|-------------|
| `volume` | 0-100 |
| `ringtones` | Array of available ringtone objects |
| `userConfiguredRingtone` | Selected ringtone |

**Viewers** (`/proxy/protect/api/viewers/{id}`):

| Field | Description |
|-------|-------------|
| `liveviewId` | Currently displayed liveview |
| `streamLimit` | Max simultaneous streams |

### 4.5 Events & AI Detection

`GET /proxy/protect/api/events` query params:

| Param | Description |
|-------|-------------|
| `start` | Unix ms start time |
| `end` | Unix ms end time |
| `types` | Comma-separated: `motion`, `ring`, `smartDetectZone`, `smartAudioDetect`, `disconnect` |
| `cameras` | Comma-separated camera IDs |
| `limit` | Max results |
| `allCameras` | Boolean |

**Event object fields**:

| Field | Description |
|-------|-------------|
| `id` | Unique event ID |
| `type` | `motion`, `ring`, `smartDetectZone`, `smartAudioDetect` |
| `start` | Unix ms |
| `end` | Unix ms (null if ongoing) |
| `score` | 0-100 confidence |
| `camera` | Camera ID |
| `modelKey` | Always `event` |
| `smartDetectTypes` | Array: `person`, `vehicle`, `animal`, etc. |
| `smartDetectEvents` | Child event IDs for sub-detections |
| `thumbnail` | Path suffix for thumbnail image |
| `heatmap` | Path suffix for motion heatmap |
| `metadata` | Object with `licensePlate.name`, `vehicleType`, etc. |

**Doorbell LCD message update** (PATCH camera):
```json
{ "lcdMessage": { "type": "CUSTOM_MESSAGE", "text": "Back Soon", "resetAt": 1700000000000 } }
```
`type` options: `CUSTOM_MESSAGE`, `LEAVE_PACKAGE_AT_DOOR`, `DO_NOT_DISTURB`. `resetAt` is unix ms.

### 4.6 Liveviews & Streaming

**Liveview fields**:

| Field | Description |
|-------|-------------|
| `id` | Liveview ID |
| `name` | Display name |
| `isDefault` | Whether set as default view |
| `isGlobal` | Visible to all users |
| `slots` | Array of `{cameras: [...], cycleMode, cycleInterval}` |
| `owner` | User ID |

**H.264 fMP4 WebSocket stream** (for web playback, not RTSP):
```
wss://{host}/proxy/protect/api/ws/livestream?{params}
```
Returns binary H.264 fMP4 fragmented MP4 chunks directly. Used by the Protect web UI.

**Two-way audio (talkback)**:
```
wss://{host}/proxy/protect/api/ws/talkback?camera={id}&mic=true
```
Sends PCM audio to the camera speaker.

### 4.7 WebSocket: Updates Stream

**Endpoint**: `wss://{host}/proxy/protect/ws/updates?lastUpdateId={id}`

Use `lastUpdateId` from bootstrap to receive only events after the bootstrap was fetched.

**Binary protocol** — each message is a compound binary packet with 4 frames:

```
[8-byte header frame] [action JSON frame] [8-byte header frame] [data JSON/binary frame]
```

**Header frame structure** (8 bytes):
```
byte 0:    packet type (1=JSON, 2=binary)
byte 1:    payload format (1=JSON, 2=H264)
byte 2-3:  deflate compressed flag + reserved
bytes 4-7: payload length (uint32 big-endian)
```

Binary data frames are zlib/deflate compressed. Text frames are uncompressed JSON.

**Action packet** (`action` frame JSON):

```json
{
  "action": "add" | "update" | "remove",
  "newUpdateId": "uuid",
  "modelKey": "camera" | "nvr" | "event" | "light" | "sensor" | "viewer" | "chime" | "user" | "group" | "bridge" | "liveview",
  "id": "{device-id}"
}
```

**Data packet** (`data` frame): partial device object with only the changed fields.

**Key patterns**:
- Motion detected: `action=update`, `modelKey=camera`, data contains `lastMotion` updated
- Doorbell ring: `action=update`, `modelKey=camera`, data contains `lastRing` updated
- New event: `action=add`, `modelKey=event`, data is the new event object
- Smart detection: `action=update`, `modelKey=event`, data adds `smartDetectTypes`
- Device offline: `action=update`, `modelKey=camera`, data contains `state: "DISCONNECTED"`

### 4.8 MQTT Bridge (homebridge-unifi-protect convention)

UniFi Protect does NOT publish MQTT natively. Third-party bridges (homebridge-unifi-protect and others) translate the WebSocket stream to MQTT.

**Topic pattern**: `unifi/protect/{MAC_ADDRESS}/{subtopic}`

**Published by bridge** (incoming events → MQTT):

| Topic | Payload | Description |
|-------|---------|-------------|
| `motion` | `true`/`false` | Motion state |
| `motion/smart/person` | `true`/`false` | Smart detect: person |
| `motion/smart/vehicle` | `true`/`false` | Smart detect: vehicle |
| `motion/smart/animal` | `true`/`false` | Smart detect: animal |
| `motion/smart/package` | `true`/`false` | Smart detect: package |
| `motion/smart/face` | `true`/`false` | Smart detect: face |
| `motion/smart/licensePlate` | `true`/`false` | Smart detect: plate |
| `motion/smart/licensePlate/metadata` | JSON `{plate, confidence}` | Plate metadata |
| `motion/smart/alrmBark` | `true`/`false` | Audio: dog bark |
| `motion/smart/alrmSiren` | `true`/`false` | Audio: siren |
| `doorbell` | `true` | Doorbell ring event |
| `authenticate` | JSON `{type, id}` | Fingerprint/NFC auth |
| `occupancy` | `true`/`false` | Derived occupancy |
| `rtsp` | JSON (RTSP URLs) | Stream URLs |
| `snapshot` | Base64 JPEG data URL | On-demand image |
| `liveviews` | JSON array | Liveview states |
| `securitysystem` | `Alarm`/`Away`/`Home`/`Night`/`Off` | Security mode |
| `alarm` | `true`/`false` | Sensor alarm |
| `contact` | `true`/`false` | Door/window sensor |
| `humidity` | Number (%) | Humidity sensor |
| `temperature` | Number (°C) | Temperature sensor |
| `ambientlight` | Number (lux) | Light sensor |
| `leak` | `true`/`false` | Water leak sensor |
| `light` | `true`/`false` | Floodlight state |
| `light/brightness` | Number 0-100 | Floodlight brightness |
| `chime` | Number 0-100 | Chime volume |
| `tone` | `buzzer`/`chime` | Chime tone |
| `systeminfo` | JSON | Controller system info |
| `telemetry` | JSON | Raw realtime API feed |

**Subscribed by bridge** (MQTT commands → Protect):

| Topic | Payload | Effect |
|-------|---------|--------|
| `light/set` | Boolean | Turn light on/off |
| `light/brightness/set` | 0-100 | Set brightness |
| `message/set` | JSON `{message, duration}` | Set doorbell LCD message |
| `liveview/set` | String (name) | Switch Viewport to named liveview |
| `liveviews/set` | JSON array | Set multiple liveview states |
| `securitysystem/set` | `AlarmOff`/`AlarmOn`/`Away`/`Home`/`Night`/`Off` | Set security mode |
| `snapshot/set` | `true` | Request snapshot (publishes to `snapshot`) |
| `chime/set` | 0-100 | Set chime volume |
| `tone/set` | `buzzer`/`chime` | Set chime tone |
| `**/get` | `true` | Request current state for any topic |

---

## 5. SSH Access & Shell

SSH is enabled in UniFi OS settings (Settings > System > Advanced > SSH Authentication). Supports password and SSH key authentication.

### Shell Environment

The UDM Pro runs UniFi OS which is a hardened Linux environment. Direct shell access (`bash`/`sh`) is available as root.

**UniFi OS container shell** (for access to Network app internals):
```bash
unifi-os shell
```
Drops into the podman container running the UniFi Network application.

### System Diagnostic Commands

| Command | Description |
|---------|-------------|
| `info` | Firmware version, model, MAC, serial |
| `ubnt-device-info summary` | Hardware info + installed software |
| `ubnt-systool cputemp` | CPU temperature |
| `ubnt-fan-speed` | Fan RPM |
| `sensors` | All sensor readings (temp, voltage, fan) |
| `uptime` | System uptime |
| `whoami` | Current user |
| `ubnt-tools hwaddr` | Burned-in MAC address |
| `ubnt-tools ubnt-discover` | Find other Ubiquiti devices on LAN |
| `ubnt-make-support-file <file.tar.gz>` | Generate support diagnostic bundle |

### Network Commands

| Command | Description |
|---------|-------------|
| `ifconfig` | Network interfaces |
| `ifstat` | Interface summary stats |
| `netstat -plant` | All listening TCP/UDP ports |
| `netstat -rt -n` | Routing table |
| `ip neigh` | ARP table + IPv6 neighbors |
| `arp -a` | ARP table |
| `ip tunnel show` | Tunnel interfaces (VPN, etc.) |
| `ipsec statusall` | IPSec SAs (IKEv2 VPN) |
| `pppstats` | PPP stats (if using PPPoE WAN) |
| `tcpdump` | Packet capture |
| `tcpdump -w /tmp/capture.pcap` | Write capture to file (scp off) |

### Service Management

| Command | Description |
|---------|-------------|
| `/etc/init.d/S95unifios restart` | Restart UniFi OS web service |
| `systemctl restart unifi-os` | Restart UniFi OS (newer firmware) |
| `systemctl status unifi-os` | Service status |
| `reboot` | Reboot device |
| `poweroff` | Shut down |
| `factory-reset.sh` | Full factory reset (destructive) |

### Key File Paths

**Logs** (firmware 2.x+, use `/data/` not `/mnt/data/`):

| Path | Contents |
|------|----------|
| `/data/unifi-os/unifi/logs/server.log` | Network app server log |
| `/data/unifi-os/unifi-core/logs/system.log` | UniFi OS system log |
| `/data/unifi-os/unifi-core/logs/http.log` | HTTP access log |
| `/data/unifi-os/unifi-core/logs/errors.log` | HTTP error log |
| `/data/unifi-os/unifi-core/logs/discovery.log` | Device discovery log |
| `/var/log/messages` | Linux syslog |

**Configuration**:

| Path | Contents |
|------|----------|
| `/data/unifi-os/unifi-core/config/settings.yaml` | UniFi OS settings |
| `/data/unifi-os/unifi-core/config/unifi-core.crt` | TLS certificate |
| `/data/unifi-os/unifi-core/config/unifi-core.key` | TLS private key |
| `/data/udapi-config/unifi` | Wireless device config |
| `/data/udapi-config/dnsmasq.lease` | DHCP leases |
| `/sys/fs/pstore/*` | Kernel panic logs |

**Protect recordings** (UDM Pro with internal storage):
```
/data/protect/media/{camera-id}/{year}/{month}/{day}/
```

**Firmware path note**: On older firmware 1.x, paths are under `/mnt/data/`. Firmware 2.x+ uses `/data/`. A symlink `/mnt/data → /data` is often present but not guaranteed.

### SSH Persistence Note

SSH keys added to `/etc/dropbear/authorized_keys` are wiped on firmware updates. Use on-boot scripts (e.g., via `udm-utilities` on-boot package or `cron @reboot`) to restore persistent SSH keys.

---

## 6. Rate Limiting & Quirks

### Authentication Rate Limiting

**Critical for Maisie**: The UDM Pro has aggressive login rate limiting on `/api/auth/login`.

- **Error code**: `AUTHENTICATION_FAILED_LIMIT_REACHED` (HTTP 429)
- **Symptom**: Repeated failed login attempts lock out the IP for an extended window (~10-15 min rolling)
- **Each failed attempt resets the lockout window** — do not retry rapidly
- **Maisie strategy**: Single login attempt at startup, 30-minute cooldown on failure, session persistence via cookie file to avoid re-auth across restarts

### General API Limits

| Limit | Value | Notes |
|-------|-------|-------|
| `stat/event` results | 3000 max | Use `start`/`end` params to paginate |
| `stat/alarm` results | 3000 max | Same |
| UniFi API connections | Not documented | Avoid parallel requests to UDM (see below) |
| Protect WebSocket reconnect backoff | Exponential, ~5 min max | hjdhjd library behavior |

### Known Quirks

| Issue | Detail |
|-------|--------|
| **Never Promise.all UniFi Network calls** | Parallel requests to UDM Pro controller can cause it to become unresponsive. Always call Network API endpoints sequentially. |
| **CSRF token required for writes** | Every write operation (POST/PUT/DELETE) requires `X-CSRF-Token` header. Token is returned in response headers of any prior request. Use the latest token — it rotates. |
| **`rest/routing` broken in v7.1.66+** | Returns HTTP 500. Use `stat/routing` for read access. |
| **`rest/event` broken in v7.1.66+** | Returns `api.err.NotFound`. Use `stat/event` instead. |
| **`stat/portforward` bytes not populated** | Transfer bytes fields exist but are always 0. |
| **Traffic rules don't apply to VPN** | WireGuard and OpenVPN traffic bypasses traffic rules entirely. |
| **API keys = owner access** | No scoping or per-app granularity as of 2025. Require owner account. |
| **Protect WebSocket binary protocol** | The updates WebSocket uses a custom binary framing with zlib-compressed payloads. Must handle both TEXT and BINARY message types. |
| **Bootstrap vs device endpoints** | For Protect, always prefer the bootstrap for initial load. Individual device endpoints (`/cameras`, `/lights`, etc.) are for updates/patches only — they're less efficient than bootstrap for reading full state. |
| **UDM Protect port 7447** | RTSP streams are on port 7447 (unencrypted) and 7441 (RTSPS/TLS), not port 554. |
| **go2rtc incompatibility with MPEG-TS** | go2rtc crashes on MPEG-TS streams. Use for camera WebRTC/MSE only. |
| **Protect: no native MQTT** | UniFi Protect does not publish to MQTT. All MQTT integrations are third-party bridges over the WebSocket updates stream. |
| **UniFi Network: no native MQTT** | Same — no built-in MQTT. Community workaround is polling + bridge. |

---

## 7. Maisie Implementation Gap Analysis

### Currently Implemented

| Capability | File | Endpoints Used |
|------------|------|---------------|
| Login (cookie + CSRF) | `unifi-client.ts`, `protect-client.ts` | `POST /api/auth/login` |
| Session persistence | Both clients | File-based cookie cache |
| Session restoration | Both clients | `GET /api/self` / `GET /proxy/protect/api/nvr` |
| Auto-reauth on 401 | Both clients | Transparent retry |
| Active clients | `unifi-client.ts` | `GET stat/sta` |
| All known users | `unifi-client.ts` | `GET rest/user` |
| Devices (full) | `unifi-client.ts` | `GET stat/device` |
| Site health | `unifi-client.ts` | `GET stat/health` |
| Networks | `unifi-client.ts` | `GET rest/networkconf` |
| Firewall rules | `unifi-client.ts` | `GET rest/firewallrule` |
| Routing | `unifi-client.ts` | `GET rest/routing` |
| Port forwards | `unifi-client.ts` | `GET rest/portforward` |
| DPI stats | `unifi-client.ts` | `GET stat/dpi` |
| WLAN config | `unifi-client.ts` | `GET rest/wlanconf` |
| Site settings | `unifi-client.ts` | `GET rest/setting` |
| Sysinfo | `unifi-client.ts` | `GET stat/sysinfo` |
| Block/unblock client | `unifi-client.ts` | `POST cmd/stamgr` |
| TLS cert upload | `unifi-client.ts` | `PUT /api/system/certificate` |
| Protect bootstrap | `protect-client.ts` | `GET /proxy/protect/api/bootstrap` |
| Cameras (via bootstrap) | `protect-client.ts` | bootstrap |
| Single camera | `protect-client.ts` | `GET /proxy/protect/api/cameras/{id}` |
| NVR info | `protect-client.ts` | bootstrap |
| Liveviews | `protect-client.ts` | bootstrap |
| Sensors | `protect-client.ts` | bootstrap |
| Lights | `protect-client.ts` | bootstrap |
| Events | `protect-client.ts` | `GET /proxy/protect/api/events` |

### High-Value Gaps (not yet implemented)

| Capability | API | Priority |
|------------|-----|----------|
| **Protect WebSocket realtime events** | `wss://.../proxy/protect/ws/updates` | High — enables reactive motion/doorbell handling without polling |
| **Network WebSocket events** | `wss://.../proxy/network/wss/s/default/events` | High — eliminates polling for client connect/disconnect |
| **Camera RTSP stream URLs** | Camera `channels[].rtspAlias` from bootstrap | High — already have bootstrap, just need to expose |
| **Doorbell LCD message** | `PATCH /proxy/protect/api/cameras/{id}` | Medium — useful for notifications |
| **Floodlight control** | `PATCH /proxy/protect/api/lights/{id}` | Medium — control via AI |
| **Kick client (WiFi disconnect)** | `POST cmd/stamgr {"cmd":"kick-sta"}` | Medium |
| **WLAN enable/disable** | `PUT rest/wlanconf/{_id}` | Medium — useful for schedules |
| **Port forward toggle** | `PUT rest/portforward/{_id} {"enabled":false}` | Medium |
| **Traffic rules (v2)** | `GET/POST/PUT/DELETE v2/api/.../trafficrules` | Medium |
| **Events stream (Network)** | `GET stat/event` with time range | Medium |
| **Device restart** | `POST cmd/devmgr {"cmd":"restart"}` | Medium |
| **Speed test** | `POST cmd/devmgr {"cmd":"speedtest"}` | Low |
| **AP group management** | v2 apgroups API | Low |
| **Sensor real-time values** | `PATCH` sensors or WebSocket | High for smart home |
| **Chime control** | `PATCH /proxy/protect/api/chimes/{id}` | Low |
| **Talkback audio** | `POST .../talkback-session` + WebSocket | Low |
| **PTZ control** | PATCH camera with ptzPresetId | Low |
| **Snapshot on-demand** | `GET .../cameras/{id}/snapshot` | Medium |
| **RTSPS stream creation** | `POST .../cameras/{id}/rtsps-stream` | Low |
| **Backup management** | `cmd/backup` | Low |
| **Firmware upgrade** | `cmd/devmgr {"cmd":"upgrade"}` | Low |
| **Admin management** | `cmd/sitemgr` invite/revoke | Low |

### Recommended Next Steps for Plugin Development

1. **Add Protect WebSocket listener** to `protect-client.ts` — eliminates all Protect polling, enables motion event callbacks. Parse binary framing per §4.7.

2. **Add Network WebSocket listener** to `unifi-client.ts` — real-time client presence events instead of periodic `stat/sta` polling.

3. **Expose RTSP URLs** — already in bootstrap camera `channels` array, just needs mapping to a clean interface method.

4. **Add WLAN toggle** — `PUT rest/wlanconf/{_id}` with `{enabled: true/false}` — useful for AI-driven schedule or automation.

5. **Add Protect device control** — light on/off, doorbell message, sensor thresholds — enables full smart home control loop.
