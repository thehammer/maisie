# Maisie — Home AI Platform Design & Implementation Plan

**Author:** Hammer + Claude  
**Status:** Draft — targeting Phase 1 build this weekend  
**Last Updated:** 2026-03-04

---

## 1. Vision

A personal AI-powered home operations platform — **Maisie** (from *maison*, French for house) — that unifies network security, media management, smart home control, personal productivity, and monitoring into a cohesive system — controllable via natural language (Claude Code / Slack / voice) and a visual dashboard.

---

## 2. Design Principles

- **Local-first:** Prefer local APIs and self-hosted services. Minimize cloud dependencies.
- **Event-driven:** Systems react to events (game scores, new devices, availability changes) rather than relying solely on polling.
- **Agent-oriented:** Each domain is a skill/agent that can operate autonomously but is orchestrable from a central control plane.
- **Observable:** Everything surfaces status to a unified dashboard and alerting layer.
- **Incremental:** Each domain is independently useful. No big-bang deployment.

---

## 3. Infrastructure & Control Plane

### 3.1 Central Agent / Orchestrator

**Architecture: Standalone home agent reusing Carebot patterns.**

Clean separation from work. The agent is a LangGraph-based system with domain-specific skill nodes, a shared state store, and multiple interface bindings.

```
┌─────────────────────────────────────────────────────────────┐
│                     MAISIE (LangGraph)                      │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Network  │ │  Media   │ │  Smart   │ │ Personal │ ...   │
│  │  Skill   │ │  Skill   │ │  Home    │ │  Prod.   │      │
│  │          │ │          │ │  Skill   │ │  Skill   │      │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘      │
│       │             │            │             │             │
│  ┌────┴─────────────┴────────────┴─────────────┴──────┐     │
│  │              Tool Registry / Router                │     │
│  └────────────────────┬───────────────────────────────┘     │
│                       │                                      │
│  ┌────────────────────┴───────────────────────────────┐     │
│  │                  Shared Services                    │     │
│  │  Event Bus (MQTT) │ State Store │ Scheduler │ Secrets│    │
│  └─────────────────────────────────────────────────────┘     │
└──────────┬──────────────┬──────────────┬────────────────────┘
           │              │              │
    ┌──────┴───┐   ┌──────┴───┐   ┌─────┴──────┐
    │  Slack   │   │ Dashboard│   │ Claude Code│
    │ (NL cmd) │   │  (Web)   │   │ (Sidecar)  │
    └──────────┘   └──────────┘   └────────────┘
```

### 3.2 Tech Stack Decisions

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Language** | TypeScript | Matches Carebot patterns. LangGraph.js is mature. Good ecosystem for all integrations. |
| **Agent framework** | LangGraph.js | Proven with Carebot. Supports tool calling, branching, human-in-the-loop. |
| **LLM** | Claude (Anthropic API) | Already on enterprise plan. Sonnet for routine tasks, Opus for complex reasoning. |
| **Event bus** | MQTT (Mosquitto) | Bambu X1C already speaks MQTT. Lightweight, fits IoT domain perfectly. Simple pub/sub. |
| **State store** | SQLite (via better-sqlite3 or Drizzle ORM) | Zero infrastructure. Single file. Good enough for personal scale. Upgrade path to Postgres if needed. |
| **Scheduler** | node-cron or Agenda.js | In-process scheduling. Agenda.js if we want persistent job state (uses MongoDB, heavier). node-cron is simpler. |
| **Secrets** | dotenv + encrypted .env file, or 1Password CLI | Keep it simple. No Vault needed at personal scale. |
| **Web framework** | Hono or Fastify | Dashboard backend + webhook receiver. Hono is lightweight and modern. |
| **Dashboard frontend** | React (Vite) or plain HTML/JS | Depends on complexity. Start simple, upgrade if needed. |
| **Container runtime** | Docker Compose | All services defined in one compose file. Easy to manage, backup, redeploy. |
| **Host** | TBD — dedicated box, NAS, or mini PC on the rack | Needs to be always-on, reachable on all VLANs. See open question. |

### 3.3 Control Interfaces

| Interface | Purpose | Implementation |
|-----------|---------|----------------|
| Slack (NL) | Primary command interface | Slack Bot (Socket Mode or Events API to a personal workspace) |
| Claude Code sidecar | Complex multi-step tasks | Spawned by agent for heavy operations |
| Web dashboard | Visual monitoring | Self-hosted React/HTML app, served on LAN |
| Control panel | Configuration, overrides, system health | Part of the dashboard app, behind a simple auth layer |
| Push notifications | Time-sensitive alerts | Ntfy (self-hosted) or Pushover. Both have simple HTTP APIs. |

### 3.4 Event Bus: MQTT Topic Design

The MQTT broker (Mosquitto) is the nervous system. Suggested topic hierarchy:

```
home/                               # root namespace
  network/
    devices/                        # device inventory events
      new                           # new device detected
      changed                       # device fingerprint changed
      missing                       # known device went offline
    health/                         # network health
      wan                           # WAN status changes
      ap/{ap_name}                  # per-AP status
    alerts/                         # security alerts
      rogue_device
      anomalous_traffic
      open_port
  media/
    radarr/upcoming                 # new movie on calendar
    sonarr/upcoming                 # new episode on calendar
    plex/recently_added             # new media added
    plex/now_playing                # active streams
  smarthome/
    lights/{zone}                   # light state changes
    scenes/triggered                # scene activations
    sports/game_result              # game outcome events
  packages/
    shipped                         # new tracking number detected
    status_changed                  # delivery status update
    delivered                       # package arrived
  printer/
    bambu/status                    # print job status (from X1C MQTT)
    bambu/filament                  # filament levels
    inventory/low_stock             # filament inventory alert
  productivity/
    email/important                 # flagged email notification
    calendar/upcoming               # upcoming event reminder
  system/
    agent/{skill}/health            # per-skill health status
    agent/heartbeat                 # agent alive signal
    scanner/results                 # discovery scan completed
  weather/
    current                         # current conditions
    alerts                          # severe weather
```

### 3.5 State Store: Core Tables

```sql
-- Known device inventory
CREATE TABLE devices (
  mac TEXT PRIMARY KEY,
  ip TEXT,
  hostname TEXT,
  oui_manufacturer TEXT,
  device_type TEXT,          -- ap, switch, camera, plug, tv, phone, computer, unknown
  device_description TEXT,   -- human or LLM-provided: "Living room Roomba"
  open_ports TEXT,           -- JSON array: [80, 443, 1883]
  services TEXT,             -- JSON: mDNS, SSDP, banner info
  network_segment TEXT,      -- VLAN name or subnet
  status TEXT DEFAULT 'new', -- trusted, known, new, suspicious, blocked
  first_seen TEXT,
  last_seen TEXT,
  dns_patterns TEXT,         -- JSON: top domains contacted
  notes TEXT
);

-- Package tracking
CREATE TABLE packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_number TEXT,
  carrier TEXT,
  description TEXT,          -- parsed from email: "Hatchbox PLA 1kg Black"
  order_source TEXT,         -- Amazon, vendor name, etc.
  status TEXT,               -- ordered, shipped, in_transit, out_for_delivery, delivered
  eta TEXT,
  delivered_at TEXT,
  email_id TEXT,             -- reference to source email
  category TEXT,             -- filament, general, electronics, etc.
  created_at TEXT,
  updated_at TEXT
);

-- 3D printer filament inventory
CREATE TABLE filament_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT,
  material TEXT,             -- PLA, PETG, ASA, TPU, etc.
  color TEXT,
  color_hex TEXT,            -- for dashboard rendering
  weight_total_g REAL,
  weight_remaining_g REAL,
  ams_slot INTEGER,          -- NULL if not loaded, 0-3 for AMS slots
  spool_id TEXT,             -- Bambu RFID tag if available
  purchase_date TEXT,
  purchase_price REAL,
  vendor TEXT,
  package_id INTEGER,        -- FK to packages table
  status TEXT,               -- in_use, stored, empty, on_order
  notes TEXT
);

-- Web monitoring targets
CREATE TABLE web_monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  url TEXT,
  check_type TEXT,           -- http_status, content_match, css_selector, json_path
  check_config TEXT,         -- JSON: selector, expected value, etc.
  interval_minutes INTEGER DEFAULT 60,
  last_checked TEXT,
  last_result TEXT,          -- JSON: status, matched, content snapshot
  alert_on TEXT,             -- change, match, no_match
  enabled INTEGER DEFAULT 1
);

-- Scheduled jobs
CREATE TABLE schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  cron_expression TEXT,
  skill TEXT,                -- which skill owns this job
  action TEXT,               -- what to execute
  config TEXT,               -- JSON parameters
  last_run TEXT,
  next_run TEXT,
  enabled INTEGER DEFAULT 1
);

-- Event log (for debugging and history)
CREATE TABLE event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT,
  topic TEXT,                -- MQTT topic
  payload TEXT,              -- JSON payload
  source TEXT                -- which skill generated it
);
```

### 3.6 Project Structure

```
home-agent/          # or just "maisie/"
├── docker-compose.yml           # All services
├── .env                         # Secrets
├── packages/
│   ├── agent/                   # Core LangGraph agent
│   │   ├── src/
│   │   │   ├── index.ts         # Entry point
│   │   │   ├── graph.ts         # LangGraph definition
│   │   │   ├── router.ts        # Intent routing
│   │   │   ├── skills/
│   │   │   │   ├── network/     # Network monitoring skill
│   │   │   │   │   ├── tools.ts         # UniFi API tools, nmap wrapper
│   │   │   │   │   ├── discovery.ts     # Device discovery & fingerprinting
│   │   │   │   │   ├── inventory.ts     # Device inventory management
│   │   │   │   │   └── alerts.ts        # Security alert logic
│   │   │   │   ├── media/       # Radarr/Sonarr/Plex skill
│   │   │   │   ├── smarthome/   # Home Assistant / lights skill
│   │   │   │   ├── packages/    # Package tracking skill
│   │   │   │   ├── printer/     # Bambu X1C / filament skill
│   │   │   │   ├── productivity/# Email / calendar skill
│   │   │   │   ├── webmonitor/  # Website monitoring skill
│   │   │   │   └── console/     # Game console FTP skill
│   │   │   ├── services/
│   │   │   │   ├── mqtt.ts      # MQTT client (publish/subscribe)
│   │   │   │   ├── db.ts        # SQLite connection + queries
│   │   │   │   ├── scheduler.ts # Cron job manager
│   │   │   │   ├── secrets.ts   # Env/secrets access
│   │   │   │   └── notifications.ts  # Push notification dispatch
│   │   │   └── interfaces/
│   │   │       ├── slack.ts     # Slack bot binding
│   │   │       └── api.ts       # HTTP API for dashboard
│   │   └── package.json
│   ├── dashboard/               # Web dashboard frontend
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── widgets/
│   │   │   │   ├── NetworkHealth.tsx
│   │   │   │   ├── PackageTracker.tsx
│   │   │   │   ├── MediaCalendar.tsx
│   │   │   │   ├── FilamentInventory.tsx
│   │   │   │   ├── PrinterStatus.tsx
│   │   │   │   ├── Calendar.tsx
│   │   │   │   └── SystemHealth.tsx
│   │   │   └── hooks/
│   │   │       └── useMqtt.ts   # WebSocket → MQTT bridge for live updates
│   │   └── package.json
│   └── shared/                  # Shared types, constants
│       ├── src/
│       │   ├── types.ts
│       │   └── topics.ts        # MQTT topic constants
│       └── package.json
├── config/
│   ├── mosquitto.conf           # MQTT broker config
│   └── known-devices.json       # Seed file for trusted device list
└── scripts/
    ├── setup.sh                 # Initial setup script
    ├── scan-network.sh          # Manual network scan trigger
    └── seed-devices.sh          # Import current UniFi clients as baseline
```

### 3.7 Docker Compose Services

```yaml
# docker-compose.yml (sketch)
version: "3.8"

services:
  mosquitto:
    image: eclipse-mosquitto:2
    ports:
      - "1883:1883"       # MQTT
      - "9001:9001"       # WebSocket (for dashboard)
    volumes:
      - ./config/mosquitto.conf:/mosquitto/config/mosquitto.conf
      - mosquitto-data:/mosquitto/data

  agent:
    build: ./packages/agent
    env_file: .env
    depends_on:
      - mosquitto
    volumes:
      - ./data/agent.db:/app/data/agent.db    # SQLite
      - ./config:/app/config
    network_mode: host    # Needed for nmap scanning + mDNS discovery on LAN
    # OR use macvlan network for LAN access without full host mode

  dashboard:
    build: ./packages/dashboard
    ports:
      - "3000:3000"
    depends_on:
      - agent
      - mosquitto

volumes:
  mosquitto-data:
```

Note: `network_mode: host` on the agent container is important — it needs raw network access for nmap scans, mDNS/SSDP listeners, and direct access to LAN subnets. An alternative is a macvlan network that puts the container directly on the LAN with its own IP.

---

## 4. Domain: Network Monitoring & Security

### 4.1 Capabilities
- Maintain a known-device inventory (MAC, OUI, hostname, first seen, last seen, expected/unexpected)
- Alert on new/unknown devices joining the network
- Monitor device traffic patterns for anomalies (unexpected external endpoints, unusual bandwidth)
- Surface UniFi device health (AP status, switch port utilization, uplink status)
- Manage client blocking/unblocking via NL commands
- Monitor WAN health (Xfinity primary + AT&T LTE failover status)
- Camera system status from Protect API
- **Active network discovery** — identify IoT devices, open ports, and exposed services

### 4.2 Network Discovery & Device Fingerprinting

#### 4.2.1 Discovery Methods
| Method | Purpose | Tools |
|--------|---------|-------|
| ARP scan | Fast sweep to find all live hosts on each VLAN/subnet | `arp-scan`, native ARP table from UDM |
| Port scanning | Identify open ports and services on discovered hosts | `nmap` (SYN scan, service detection) |
| mDNS/Bonjour | Discover devices advertising services (HomeKit, AirPlay, Chromecast, printers) | `avahi-browse`, mDNS listener |
| SSDP/UPnP | Discover UPnP devices (smart TVs, media renderers, IoT hubs) | SSDP M-SEARCH listener |
| MQTT discovery | Find devices publishing to local MQTT brokers | Subscribe to `$SYS/#` and `homeassistant/#` topics |
| DHCP lease monitoring | Catch new devices as they join, capture hostnames | Parse UDM DHCP leases or UniFi API |
| DNS query logging | See what domains IoT devices are calling home to | Pi-hole/AdGuard logs or DNS tap |
| Banner grabbing | Identify software/firmware from service banners | `nmap` NSE scripts, HTTP headers |

#### 4.2.2 Device Fingerprinting Pipeline
```
Discovery scan (scheduled + on-new-device trigger)
  → Collect: MAC, IP, hostname, open ports, service banners, mDNS records, UPnP descriptors
    → OUI lookup (IEEE database) → manufacturer
    → Service fingerprint → device type classification
    → LLM-assisted identification: "MAC from Espressif, port 80 open, mDNS _hap._tcp
        → likely a HomeKit accessory running on ESP32"
      → Update device inventory in state store
        → If unknown/unexpected → alert + quarantine recommendation
        → If known → update last-seen, check for new/changed services
```

#### 4.2.3 Device Inventory Model
- MAC address, IP (may be dynamic), OUI manufacturer
- Hostname (from DHCP, mDNS, or UPnP)
- Device type (classified: AP, switch, camera, smart plug, thermostat, TV, game console, phone, computer, unknown)
- Open ports and services
- mDNS/UPnP service advertisements
- Network segment / VLAN
- First seen, last seen, connection history
- Status: trusted / known / new / suspicious / blocked
- DNS query patterns (top domains contacted)
- Notes (user-provided context: "This is the Roomba", "Kids' iPad")

#### 4.2.4 Security Posture Checks
- Flag devices with unnecessary open ports (telnet, unencrypted HTTP admin panels)
- Detect IoT devices phoning home to known sketchy endpoints
- Identify devices that should be on an IoT VLAN but aren't (or vice versa)
- Watch for devices that change MAC (randomization) or IP unexpectedly
- Monitor for new services appearing on previously fingerprinted devices (possible compromise)

### 4.3 APIs & Integrations
| Service | API | Endpoint |
|---------|-----|----------|
| UniFi Network | REST (local) | `https://<UDM-IP>/proxy/network/api/...` |
| UniFi Protect | REST (local) | `https://<UDM-IP>/proxy/protect/api/...` |
| OUI Lookup | Local DB | IEEE OUI database for MAC identification |
| nmap | CLI / library | Network scanning and service detection |
| mDNS | Listener | Bonjour/Avahi service discovery |
| SSDP | Listener | UPnP device discovery |
| DNS logs | Pi-hole/AdGuard API | Query logging and analytics |

### 4.4 Key UniFi API Data
- `stat/sta` — active clients
- `stat/device` — network device status
- `rest/firewallrule` — firewall rules
- `stat/health` — dashboard health metrics
- `rest/networkconf` — network configuration

### 4.5 UniFi API Client Implementation

```typescript
// Sketch: packages/agent/src/skills/network/unifi-client.ts

interface UniFiConfig {
  host: string;          // UDM Pro IP
  username: string;      // local admin
  password: string;
  site?: string;         // default: "default"
}

class UniFiClient {
  private baseUrl: string;
  private cookie: string | null = null;

  constructor(private config: UniFiConfig) {
    this.baseUrl = `https://${config.host}`;
  }

  async login(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
      }),
      // Node 18+: need to handle self-signed cert
    });
    // Extract and store session cookie
    this.cookie = res.headers.get('set-cookie');
  }

  private async get(path: string): Promise<any> {
    if (!this.cookie) await this.login();
    const site = this.config.site || 'default';
    const res = await fetch(
      `${this.baseUrl}/proxy/network/api/s/${site}/${path}`,
      { headers: { Cookie: this.cookie! } }
    );
    return res.json();
  }

  async getActiveClients() { return this.get('stat/sta'); }
  async getDevices()       { return this.get('stat/device'); }
  async getHealth()        { return this.get('stat/health'); }
  async getNetworks()      { return this.get('rest/networkconf'); }
  async getFirewallRules() { return this.get('rest/firewallrule'); }
  async getSysinfo()       { return this.get('stat/sysinfo'); }

  async blockClient(mac: string) {
    return this.post('cmd/stamgr', { cmd: 'block-sta', mac });
  }

  async unblockClient(mac: string) {
    return this.post('cmd/stamgr', { cmd: 'unblock-sta', mac });
  }

  private async post(path: string, body: any): Promise<any> {
    if (!this.cookie) await this.login();
    const site = this.config.site || 'default';
    const res = await fetch(
      `${this.baseUrl}/proxy/network/api/s/${site}/${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: this.cookie!,
        },
        body: JSON.stringify(body),
      }
    );
    return res.json();
  }
}
```

### 4.6 Implementation Priority: **HIGH — Start here**
This is foundational. The device inventory becomes a shared resource for other domains, and the security monitoring provides immediate value. Start with UniFi API polling + OUI lookup, then layer on nmap scanning and mDNS/SSDP discovery. The LLM-assisted fingerprinting can refine classifications over time.

---

## 5. Domain: Smart Home & Lighting

### 5.1 Capabilities
- Control HomeKit devices via natural language
- Control non-HomeKit devices (gemstone lights) via their native protocols
- Event-triggered scenes (Duke wins → blue/white light show)
- Scheduled automations (seasonal themes, time-of-day lighting)
- Expose status of all controllable devices on dashboard

### 5.2 Architecture
**Home Assistant** as the device abstraction layer:
- Bridges HomeKit devices into a unified API
- Integrates non-HomeKit devices via plugins/custom components
- Exposes REST API + WebSocket API for agent control
- Has a UniFi integration for presence detection

### 5.3 APIs & Integrations
| Service | API | Notes |
|---------|-----|-------|
| Home Assistant | REST + WebSocket | Central smart home hub |
| Gemstone Lights | TBD | Investigate local protocol. Likely WiFi-based, may need HA integration or reverse engineering. |
| Sports Scores | ESPN API / SportsData | Poll during game windows, trigger events on outcomes. |

### 5.4 Event Pipeline: Sports → Lights
```
Scheduler (game day check)
  → Sports API poller (monitors live score)
    → Event bus: "duke_game_ended" { result: "win" }
      → Home agent: trigger "duke_celebration" scene
        → Home Assistant API: set gemstone lights to Duke blue/white pattern
```

### 5.5 Implementation Priority: **MEDIUM**
Depends on Home Assistant being set up. Gemstone light integration may require research.

---

## 6. Domain: Media Management

### 6.1 Capabilities
- View upcoming movie and TV releases from Radarr/Sonarr
- Surface new additions to media library
- Display release calendar on dashboard / Dakboard
- Monitor download status and health
- NL queries: "What movies are coming out this month?" "Is [show] downloading?"

### 6.2 APIs & Integrations
| Service | API | Notes |
|---------|-----|-------|
| Radarr | REST | Movie management, calendar, queue |
| Sonarr | REST | TV management, calendar, queue |
| Plex/Jellyfin | REST | Library stats, recently added, now playing (if applicable) |

### 6.3 Dashboard: Release Calendar
- Pull upcoming releases from Radarr (`/api/v3/calendar`) and Sonarr (`/api/v3/calendar`)
- Render as a calendar view for Dakboard (either via Google Calendar sync or a self-hosted HTML page)
- Highlight today's releases, color-code by type (movie vs TV)

### 6.4 Implementation Priority: **MEDIUM**
APIs are well-documented and stable. Good early win for dashboard content.

---

## 7. Domain: Personal Productivity

### 7.1 Capabilities
- Email triage and summarization
- Calendar management (view, create, reschedule via NL)
- Daily briefing: agenda, important emails, alerts from other domains
- Smart reminders based on context

### 7.2 APIs & Integrations
| Service | API | Notes |
|---------|-----|-------|
| Email (Gmail/IMAP) | Gmail API or IMAP | Read, summarize, draft responses |
| Calendar | Google Calendar API / CalDAV | CRUD operations, availability queries |

### 7.3 Daily Briefing
A morning summary command that aggregates across all domains:
```
"Good morning, Hammer. Here's your briefing:

📅 You have 3 meetings today. First one at 9:30 AM.
📧 12 new emails overnight. 2 flagged as important.
📦 Your Hatchbox PETG is out for delivery, ETA 2pm.
🖨️ X1C is idle. AMS slot 2 (white PLA) is at 15% — reorder suggested.
🏠 Network: 47 devices online, all known. WAN healthy.
📺 New episode of [show] airs tonight.
🏀 Duke plays UNC at 7pm.
"
```

### 7.4 Implementation Priority: **MEDIUM-HIGH**
High daily utility. Calendar is straightforward; email requires careful scoping to avoid overwhelm.

---

## 8. Domain: Web Monitoring & Availability

### 8.1 Capabilities
- Monitor product pages for availability changes (in-stock alerts)
- Track price changes on watched items
- Monitor arbitrary web pages for content changes
- Configurable check intervals and alert thresholds

### 8.2 Architecture
- Headless browser (Playwright/Puppeteer) for JS-rendered pages
- Simple HTTP fetch for static pages
- Diff engine to detect meaningful changes
- User-configurable watch list with CSS selectors or content patterns

### 8.3 Implementation Priority: **MEDIUM**
Useful but not urgent. Can start with simple HTTP polling and add headless browser later.

---

## 9. Domain: Package Tracking & Inventory

### 9.1 Capabilities
- Parse shipping confirmation and tracking emails automatically (Amazon, vendor emails, carrier notifications)
- Track active shipments with carrier APIs (UPS, USPS, FedEx, etc.) or via aggregators (17track, AfterShip, Parcels)
- Display active deliveries on dashboard / Dakboard with ETAs
- Cross-reference orders with known inventory categories:
  - **3D printer filament**: Track orders, maintain filament inventory (type, color, weight remaining), alert when stock is low, correlate with AMS slot usage via Bambu MQTT
  - **General household**: Package arrival notifications
- Historical order log: what was ordered, when it arrived, from where
- NL queries: "When is my filament arriving?" "What packages are out for delivery?" "How much PETG do I have left?"

### 9.2 Architecture
```
Email inbox (Gmail API / IMAP)
  → Email parser: identify shipping confirmations, extract tracking numbers + carrier + items
    → Tracking service: poll carrier APIs for status updates
      → Event bus: "package_status_changed" { tracking, status, eta }
        → Dashboard: update delivery widget
        → Inventory agent: if item is filament → update filament inventory on delivery
        → Notifications: "Your Hatchbox PLA is out for delivery"

Bambu X1C (MQTT)
  → Monitor filament usage per print job
    → Decrement filament inventory
      → Alert when spool drops below threshold
        → Optionally: suggest or auto-create reorder reminder
```

### 9.3 Filament Inventory Model
- Spool ID, brand, material (PLA, PETG, ASA, TPU, etc.), color, weight (g), remaining (g)
- AMS slot mapping (which spool is in which slot)
- Purchase history (date, vendor, price)
- Usage history (per-print consumption from MQTT data)

### 9.4 APIs & Integrations
| Service | API | Notes |
|---------|-----|-------|
| Email | Gmail API / IMAP | Parse shipping confirmations |
| Carrier tracking | AfterShip / 17track / direct carrier APIs | Shipment status + ETA |
| Bambu X1C | MQTT (local) | Filament usage, AMS slot status |

### 9.5 Implementation Priority: **MEDIUM**
Email parsing is the hard part (LLM-assisted extraction helps a lot here). Carrier tracking APIs are well-established. Filament inventory is a natural extension once the printer MQTT connection is live.

---

## 10. Domain: Account & Social Media Hygiene

### 10.1 Capabilities
- **YouTube cleanup**: Review and bulk unfollow channels, remove liked videos, clear watch history entries that don't match the account owner's interests. LLM-assisted classification: "Is this a channel Hammer would follow, or kid content?"
- **Facebook pruning**: Unfollow pages/groups, unfriend dormant or unknown accounts, review and clean up liked pages, audit app permissions, review privacy settings
- **Twitter/X cleanup**: Unfollow accounts, unlike old tweets, mute/block, prune lists
- **General account audit**: Review connected apps/OAuth permissions across services, identify unused accounts (via email search for signup confirmations), suggest accounts to delete
- **Subscription audit**: Find active subscriptions via email receipts or bank statement parsing, flag forgotten or unwanted recurring charges
- NL queries: "Clean up my YouTube subscriptions", "What pages am I following on Facebook that I probably don't care about?", "Show me all my connected app permissions"

### 10.2 Architecture
```
Agent receives cleanup request
  → Pull current state from platform API (subscriptions, follows, likes)
    → LLM classification: categorize each item
      - Owner-relevant (keep)
      - Likely kid/family member activity (flag for review)
      - Dormant / irrelevant (suggest removal)
      - Suspicious / spam (recommend removal)
    → Present review list to user (Slack or dashboard)
      → User approves batch actions
        → Agent executes via API (unfollow, unlike, revoke, etc.)
```

### 10.3 Platform Integration Notes

| Platform | API Status | Notes |
|----------|-----------|-------|
| YouTube | Data API v3 | Subscriptions, liked videos, playlists all manageable. Quota limits apply (10,000 units/day). OAuth2 required. |
| Facebook | Graph API | Increasingly locked down. May need to use browser automation (Playwright) for some operations. Review app permissions is doable. |
| Twitter/X | API v2 | Free tier is very limited. Paid tier needed for meaningful access. Browser automation may be more practical. |
| Google Account | Various | Connected apps audit via Google Security settings. May need Playwright. |
| General OAuth | Per-service | Many services don't have "list my connected apps" APIs. Browser automation or manual review. |

### 10.4 Browser Automation Fallback
For platforms with limited APIs (Facebook especially), a Playwright-based approach:
- Headless browser logs in with saved session
- Navigates to settings/following/likes pages
- Scrapes current state
- Executes unfollow/unlike actions
- Rate-limited to avoid triggering anti-bot measures

This shares infrastructure with the web monitoring skill (both need Playwright). Worth building as a shared service.

### 10.5 Safety Considerations
- **Always review before executing** — never auto-delete without user confirmation
- **Dry run mode** — show what would change before doing it
- **Undo log** — record every action taken so it can be reversed if needed
- **Rate limiting** — platforms will flag or ban accounts that make bulk changes too fast
- **Session management** — store auth sessions securely, handle 2FA challenges gracefully

### 10.6 Implementation Priority: **LOW-MEDIUM**
High value when you need it, but not urgent. YouTube is the easiest starting point (good API). Facebook and Twitter may require more creative solutions due to API restrictions. The Playwright infrastructure built here feeds into web monitoring too.

---

## 11. Domain: Game Console Management

### 10.1 Capabilities
- Browse and manage content on jailbroken consoles via FTP
- Transfer files (ROMs, homebrew, saves) via NL commands
- Inventory what's installed on each device

### 10.2 APIs & Integrations
| Service | Protocol | Notes |
|---------|----------|-------|
| Console(s) | FTP/SFTP | Standard FTP client libraries. Consoles must be on and connected. |

### 10.3 Implementation Priority: **LOW**
Niche utility but straightforward FTP operations. Good candidate for a simple skill added later.

---

## 11. Domain: Dashboard & Visualization

### 11.1 Capabilities
- Central "at a glance" view across all domains
- Configurable panels/widgets
- Display targets: Dakboard, wall-mounted tablet, browser
- Auto-rotate between views or context-aware display

### 11.2 Widgets / Views
| Widget | Source | Notes |
|--------|--------|-------|
| Network health | UniFi API | Device count, WAN status, alerts |
| Media calendar | Radarr/Sonarr | Upcoming releases |
| Today's agenda | Calendar API | Events and reminders |
| Weather | Weather API | Current + forecast |
| 3D printer status | Bambu MQTT | Current job, filament, temps |
| Package tracking | Email + carrier APIs | Active deliveries with ETAs |
| Filament inventory | MQTT + state store | Stock levels, what's in the AMS, what's on order |
| Security cameras | Protect API | Thumbnail snapshots or status |
| System health | Agent internals | All agents reporting green/yellow/red |
| Recently added media | Plex/Jellyfin | Latest additions |

### 11.3 Implementation
- Self-hosted web app (React or simple HTML/JS)
- Served on local network
- Dakboard pointed at the URL, or use a dedicated tablet
- WebSocket or SSE for real-time updates

### 11.4 Dashboard Architecture

```
┌─────────────────────────────────────────────┐
│            Dashboard (React / Vite)          │
│                                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ Network │ │ Packages│ │ Calendar│  ...   │
│  │ Widget  │ │ Widget  │ │ Widget  │       │
│  └────┬────┘ └────┬────┘ └────┬────┘       │
│       │            │           │              │
│  ┌────┴────────────┴───────────┴──────┐      │
│  │    Data Layer                       │      │
│  │  REST polling + MQTT via WebSocket  │      │
│  └────┬───────────────────┬───────────┘      │
└───────┼───────────────────┼──────────────────┘
        │                   │
   Agent HTTP API     Mosquitto:9001
   (Hono/Fastify)     (WebSocket)
```

- Widgets receive initial state from agent's REST API on load
- Live updates stream in via MQTT over WebSocket
- Dashboard is a static build served by agent or a simple nginx container
- Dakboard loads the dashboard URL; auto-refresh handles the rest

### 11.5 Implementation Priority: **MEDIUM — builds incrementally**
Start with a skeleton, add widgets as each domain comes online.

---

## 11A. Card Type System & Component Library

This section captures the design for the visual card builder and the type system that powers it. Written 2026-04-07 based on what was learned building the plugin action framework.

### 11A.1 Why a Type System

Every plugin action declares a Zod output schema. The framework already introspects those schemas to produce `CardField[]` for the catalog API. But the current system has a gap: it knows the *shape* of a field (string, number, boolean) but not its *meaning* — so the renderer can't decide whether a number is a byte count, a percentage, a temperature, or a channel number.

The type system closes that gap. It operates at two levels:

1. **Schema-level type** — what shape does the action output have overall?
2. **Field-level type** (already built) — what does each value *mean*, and how should it render?

Both levels are declared at schema-definition time, enforced by Zod, and fully knowable by the card builder before any data arrives.

### 11A.2 Schema-Level Types

Three types cover all action outputs. No dynamic/map type — static structure only.

| Type | Shape | Card affordances |
|------|-------|-----------------|
| `scalar` | A single typed value — string, number, timestamp, etc. | Display as a single-value widget with the appropriate field renderer |
| `record` | One object with fixed named fields, heterogeneous values | Key-value card; each field rendered by its field-level type |
| `collection` | Array of records sharing the same schema | Table with filter, sort, group, paginate, aggregate |

**`scalar`** — e.g. `getWanStatus()` returns a single status string. Render as a badge.

**`record`** — e.g. `getPrinterStatus()` returns `{ state, raw }`. Render as a typed key-value card. Fields can be heterogeneous: `state` is a `status` badge, `raw` is a `string`.

**`collection`** — e.g. `getSupplyLevels()` returns `Cartridge[]`. Every element has the same schema: `{ name: string, levelPercent: percentage, state: status }`. The card builder offers: filter where `levelPercent < 20`, sort by `name`, render each row as a gauge.

**What becomes `json`** — the escape hatch for `z.record()` (dynamic keys) and other untyped structures that don't fit the three shapes. These get a collapsed viewer, no type-driven affordances.

### 11A.3 Schema-Level Type Inference

The schema-level type is inferred from the Zod output schema automatically:

```typescript
z.string() | z.number() | z.boolean() | z.enum([...])  →  scalar
z.object({ ... })                                        →  record
z.array(z.object({ ... }))                               →  collection
z.record(...) | z.any() | z.unknown()                    →  json (untyped)
```

Plugin authors can override inference with an annotation when the Zod type is ambiguous — e.g. a `z.object()` that semantically represents a collection entry and should be flattened. But the default inference covers 95% of cases.

### 11A.4 Field-Level Types (existing — `MaisieFieldType`)

Already built in `packages/shared/src/field.ts`. Attached to individual Zod fields via `field(schema, type)`:

```typescript
field(z.number(), 'percentage')   // renders as progress bar
field(z.string(), 'status')       // renders as colored badge
field(z.number(), 'bytes')        // renders as "1.2 GB"
field(z.string(), 'timestamp')    // renders as "2h ago"
field(z.number(), 'temperature')  // renders as "72°C" with threshold color
```

Full vocabulary: `string`, `number`, `boolean`, `bytes`, `percentage`, `status`, `image`, `timestamp`, `duration`, `progress`, `temperature`, `signal`, `toggle`, `action`, `stream`, `url`, `json`.

### 11A.5 The Function Library (not yet built)

The renderer mapping (field type → React component) is currently hardcoded in `DynamicCard`. The function library formalizes this as a registry — and makes it extensible.

```typescript
// A renderer function for a field type
type FieldRenderer<T = unknown> = (value: T, field: CardField, config: FieldConfig) => ReactNode

// The registry
const renderers: Record<MaisieFieldType, FieldRenderer> = {
  percentage: (v) => <ProgressBar value={v} />,
  status:     (v) => <StatusBadge value={v} />,
  timestamp:  (v) => <RelativeTime value={v} />,
  bytes:      (v) => <ByteSize value={v} />,
  // ...
}
```

**Transformation functions** operate on typed values before rendering:

```typescript
// Applied in a pipeline: raw value → transformed value → renderer
type Transform<T, U> = (value: T) => U

const transforms = {
  clamp:      (min, max) => (v: number) => Math.max(min, Math.min(max, v)),
  threshold:  (warn, crit) => (v: number): MaisieStatus => v > crit ? 'error' : v > warn ? 'warning' : 'ok',
  formatDate: (fmt) => (v: string) => dayjs(v).format(fmt),
}
```

**Collection operations** are functions that take a `collection` and return a transformed collection:

```typescript
type CollectionOp<T> = (rows: T[]) => T[]

const ops = {
  filter:  (field, predicate) => (rows) => rows.filter(r => predicate(r[field])),
  sort:    (field, dir) => (rows) => [...rows].sort(...),
  group:   (field) => (rows) => groupBy(rows, r => r[field]),
  limit:   (n) => (rows) => rows.slice(0, n),
}
```

### 11A.6 Card Configurator UI (not yet built)

The visual card editor the user sees. Backed by the type system so it can offer only valid operations for each data shape.

**For a `record`:**
- Choose which fields to show/hide
- Override field label
- Override field renderer (if multiple renderers apply to the type)
- Configure renderer options (e.g. threshold values for `temperature`)

**For a `collection`:**
- All of the above per-column, plus:
- Add filter rules (field / operator / value — operators derived from field type)
- Add sort rules (field / direction)
- Set row limit
- Choose display mode: table, card-grid, list

**For a `scalar`:**
- Choose renderer
- Configure renderer options

The configurator produces a `CardConfig` object (serializable JSON) that is saved to the layout DB. At render time, the config is replayed: data flows through the operation pipeline → renderer functions → React output.

### 11A.7 Card Template Library (not yet built)

Named, reusable card configurations. A configured card can be saved as a template:

```
"Low Ink Alert" → hp-printer.get_supply_levels, filtered to levelPercent < 20, sorted by levelPercent asc
"Recent Episodes" → sonarr.list_missing_episodes, limited to 5, sorted by airDate desc
```

Templates are first-class entries in the Add Card panel alongside raw action cards. They compose multiple configurations into a single named thing the user can place in any layout.

### 11A.8 Build Sequence

1. ~~**Schema-level type inference**~~ ✅ Done (2026-04-08) — `introspectSchema` returns `IntrospectResult { schemaType, fields }`; catalog API includes `schemaType` and `maisieType` on every field
2. ~~**Function library**~~ ✅ Done (2026-04-08) — `ops.ts`: MaisieValue types, ExprNode DAG, primitives (reduce/sort/get/set/comparison/arithmetic/boolean/string), STD_LIB (filter/map/pluck/count/sum), `compileOp()`, `evalExpr()`; `renderers.ts`: 19 RendererConfig types + RENDERER_DEFAULTS; `FieldRenderer.tsx`: React dispatcher; `pipeline.ts`: applyPipeline()
3. ~~**Card configurator UI**~~ ✅ Done (2026-04-08) — CardConfigurator overlay: title override, field visibility/reorder, ops pipeline (filter/sort/limit), per-field renderer config; gear icon on every card; persists to layout DB immediately
4. **Card migration** — 🔄 In progress (2026-04-08)
   - ✅ Converted: HdhrCard, BambuCard, DakboardCard, PackagesCard → DynamicCard
   - ✅ Deleted: ResourceCard (dead code), plus the 4 converted components
   - ✅ Static descriptors for all 15 original cards — configurator has full field info everywhere
   - ⬜ Remaining 10 cards need compound cards or write path (see 11A.9, 11A.10)
5. **Compound cards** — multi-section rendering from a single API response (see 11A.9)
6. **Write path** — toggle/action renderers that POST mutations (see 11A.10)
7. **Card template library** — save/load named configurations, first-class Add Card panel entries

### 11A.9 Compound Cards (not yet built)

The main blocker for converting NasCard, PlexCard, MediaCard, and CalibreCard. These cards render 2–3 sections from a single API response (e.g. PlexCard shows libraries, now playing, and recently added — all from one `/api/plex/plex-status` call).

**Design:**

A compound card is a `DynamicCard` variant that splits one payload into sections, each with its own field set, ops pipeline, and renderer config.

```typescript
interface SectionConfig {
  /** Which field in the parent record provides this section's data. */
  sourceField: string
  /** Section title (e.g. "Now Playing", "Libraries"). */
  title: string
  /** Schema type of this section's data — typically 'collection'. */
  schemaType: MaisieSchemaType
  /** Fields to display within this section. */
  visibleFields?: string[]
  /** Ops pipeline applied to this section's data. */
  ops?: OpConfig[]
  /** Per-field renderer overrides. */
  rendererConfigs?: CardRendererConfig
}
```

CardConfig gains an optional `sections: SectionConfig[]`. When present, DynamicCard iterates sections, extracting each `sourceField` from the response and rendering it as an independent block within one card shell.

**Cards this unblocks:**

| Card | Sections |
|------|----------|
| NasCard | system (record), volumes (collection), disks (collection), containers (collection) |
| PlexCard | info (record), libraries (collection), nowPlaying (collection), recentlyAdded (collection) |
| MediaCard | queue (collection), upcoming (collection) |
| CalibreCard | summary (record), libraries (collection), recentBooks (collection) |

**Build steps:**
1. Add `SectionConfig` to shared types and `CardConfig`
2. Add `DynamicCompound` renderer in DynamicCard.tsx
3. Update CardConfigurator to show section management for record cards with collection fields
4. Convert NasCard, PlexCard, MediaCard, CalibreCard
5. Delete the hand-written components

### 11A.10 Write Path (not yet built)

Enables `ToggleRenderer` and `ActionRenderer` to actually mutate state. Currently they're read-only placeholders.

**Design:**

`ToggleRendererConfig` already has an `actionId` field. The write path:
1. When toggled, POST to the plugin action's HTTP endpoint with `{ value: boolean }`
2. Optimistic UI update — flip the toggle immediately, revert on error
3. On success, trigger a data refresh

`ActionRendererConfig` already has `confirm` and `confirmMessage`. The write path:
1. On click, show confirm dialog if `confirm: true`
2. POST to the action's endpoint
3. Show result inline (success/error badge)
4. Trigger a data refresh

**Cards this unblocks:**

| Card | Write actions |
|------|-------------|
| SmartHomeCard | Per-device toggle (POST to `/api/home-assistant/toggle`) |
| YouTubeCleanupCard | "Run Now" button (POST to `/api/youtube/cleanup/run`) |
| NightlyCard | Start/stop toggle |
| DakboardCard | Screen selector dropdown (already converted, could add write later) |

**Build steps:**
1. Wire `ToggleRenderer` to POST on change + optimistic update + refresh
2. Wire `ActionRenderer` to POST on click + confirm dialog + result display
3. Add `writeEndpoint` to `RendererConfig` so the configurator can specify which endpoint a toggle/action hits
4. Convert SmartHomeCard, YouTubeCleanupCard

---

## 12. Suggested Additional Domains

| Domain | Description | Priority |
|--------|-------------|----------|
| 3D Printer (Bambu X1C) | Print status, filament monitoring via local MQTT | LOW |
| DNS/Ad Blocking | Pi-hole or AdGuard query logs, block stats, feed into network security | LOW |
| Backup Monitoring | Verify backups are running across NAS, cloud, UniFi | LOW |
| Weather/Environmental | Dashboard data, automation triggers | LOW |
| Media Server Health | Plex/Jellyfin transcode status, library stats | LOW |

---

## 13. Implementation Roadmap

### Phase 1: Foundation (This Weekend)
**Goal: Agent boots, connects to MQTT, talks to UniFi, baseline device inventory exists, skeleton dashboard shows something.**

- [x] Initialize monorepo with packages: agent, dashboard, shared (Bun workspaces)
- [x] Docker Compose with Mosquitto (MQTT + WebSocket)
- [x] MQTT client service: connect, publish, subscribe
- [x] SQLite setup with Drizzle ORM, create core tables (devices, event_log, schedules)
- [x] Create local admin account on UDM Pro ("Maisie" user)
- [x] UniFi API client: login, get active clients, get devices, get health, get networks, get firewall rules
- [x] OUI database: download IEEE CSV, build MAC-to-manufacturer lookup (38,971 entries)
- [x] Seed device inventory: pull all current UniFi clients + OUI lookup → store in SQLite
- [x] Scheduled poll: check for new/disappeared clients every 5 minutes, publish events to MQTT
- [x] Hono HTTP API: /api/health, /api/devices, /api/devices/:mac, /api/events, /api/audit
- [x] Network audit skill: pulls all UniFi data, produces security/optimization report
- [x] Skeleton dashboard: React + Vite, shows agent status + device table (wired but not styled)
- [ ] nmap wrapper: scan a given IP for open ports and services (deferred to Linux host)
- [ ] Slack bot (Socket Mode): basic echo, then wire up "show devices" and "scan network" commands
- [ ] LLM-assisted device fingerprinting (classify device types from profile data)

### Phase 1 Weekend Schedule

**Saturday AM — Scaffolding**
1. Init monorepo, configure TypeScript, install deps
2. Docker Compose: Mosquitto + dev agent
3. MQTT service: connect, test pub/sub
4. SQLite + Drizzle: schema, migrations, seed script

**Saturday PM — UniFi Integration**
5. Create local admin on UDM Pro via UI
6. UniFi client: implement login + core endpoints
7. First pull: dump all active clients to console
8. OUI database: download IEEE CSV, build lookup
9. Seed script: pull clients → OUI lookup → insert into devices table
10. Scheduled poll: every 5 min, diff against known inventory, publish new device events

**Sunday AM — Discovery & Alerts**
11. nmap wrapper: `scanHost(ip)` → open ports + service banners
12. Enhance new-device flow: on new device → auto-scan with nmap → update record
13. LLM fingerprinting: send device profile to Claude → get device type classification
14. Slack bot: Socket Mode setup, register commands
15. Wire up: "show devices" → query DB → formatted response
16. Wire up: "scan network" → trigger full scan → report results

**Sunday PM — Dashboard Skeleton**
17. Vite + React project, Tailwind
18. Agent HTTP API (Hono): `/api/devices`, `/api/health`, `/api/events`
19. Dashboard: network health widget (device count, WAN status, recent alerts)
20. MQTT over WebSocket: live new-device alerts on dashboard
21. Docker build for dashboard, add to compose
22. Test end-to-end: new device joins → nmap scan → classified → appears on dashboard + Slack alert

### Phase 2: Productivity & Media (Week 2)
- [ ] Email integration (read, summarize, triage)
- [ ] Email → package tracking parser (LLM-assisted extraction of tracking numbers, carriers, items)
- [ ] Carrier tracking service (poll for status/ETA updates)
- [ ] Calendar integration (view, create events via NL)
- [ ] Radarr/Sonarr calendar integration
- [ ] Dashboard: add calendar + media + package tracking widgets
- [ ] Daily briefing command

### Phase 3: Smart Home & Monitoring (Week 3–4)
- [ ] Home Assistant setup (if not already running)
- [ ] HomeKit device bridge
- [ ] Gemstone lights research + integration
- [ ] Sports score → event pipeline
- [ ] Web monitoring service (product availability)
- [ ] Bambu X1C MQTT connection
- [ ] Filament inventory system (track stock, correlate with AMS, link to package tracking)
- [ ] Dashboard: smart home status + printer + filament widgets

### Phase 4: Extended Capabilities (Week 5+)
- [ ] Game console FTP management
- [ ] 3D printer monitoring
- [ ] Protect camera integration (snapshots on dashboard, motion alerts)
- [ ] DNS/ad blocking integration
- [ ] Backup monitoring
- [ ] Account hygiene: YouTube cleanup (subscriptions, likes, watch history)
- [ ] Account hygiene: Facebook/Twitter pruning (Playwright-based)
- [ ] Subscription audit (email receipt parsing)
- [ ] Control panel web UI for configuration
- [ ] mDNS / SSDP passive listeners (always-on discovery)
- [ ] Daily/weekly network security reports

---

## 14. Open Questions

1. **Gemstone lights protocol** — What brand/model? Need to determine local API or HA integration path.
2. **Home Assistant** — Already running, or greenfield setup?
3. **Email provider** — Gmail, Outlook, self-hosted? Determines API approach.
4. **Dashboard hardware** — Dakboard dedicated device (confirmed in inventory), or repurpose a tablet/Pi?
5. **Hosting** — Where does the agent run? Currently on Mac (dev). Need a Linux host for nmap/mDNS.
   - Dedicated mini PC (Intel NUC, Beelink) on the rack — best performance, full control
   - NAS — Synology confirmed in inventory, can run Docker
   - Raspberry Pi 5 — adequate for this workload, cheap, low power
   - NOT recommended: UDM Pro itself (limited resources, Ubiquiti locks down the OS)
6. **Which consoles** — Sony consoles confirmed in inventory (2x). Specific models TBD.
7. **Notification preferences** — Slack only, or also push notifications (Pushover/Ntfy), email, TTS?
8. **Duke sports scope** — Basketball only, or football/other sports too?
9. ~~**VLANs**~~ — **ANSWERED**: IoT and NoT VLANs exist but have 0 clients. All 66 devices on Default.
10. **Existing services** — What's already running? Plex/Jellyfin? Pi-hole? Any existing Docker host?

---

## 15. Network Audit Findings (2026-03-07)

First audit run from live UniFi data. Full report available via `GET /api/audit?format=markdown`.

### Infrastructure Inventory
- **5 APs**: First Floor (22 clients), Second Floor (10), Basement (1), AT&T Backup (0), U6 Long Range (0)
- **14 switches**: All online except Flex Room TV (offline)
- **66 devices** on network, all on Default VLAN
- **WAN**: Healthy (Xfinity primary, AT&T LTE failover available)

### Answered Questions
- **Slack workspace**: configured in .env
- **VLANs**: IoT and NoT VLANs exist but are empty — all devices on Default
- **Dakboard**: Confirmed on network
- **Synology NAS**: Confirmed on network
- **Sony consoles**: 2x detected
- **Package manager**: Bun (via asdf, v1.3.10)

### Security & Optimization Issues

#### HIGH — VLAN Segmentation (In Progress)
**SSID "Iaido"** created on IoT VLAN 20 (192.168.20.0/24). Firewall rules active:
- `IoT - Allow Established/Related` (LAN_IN, accept) — responses flow back to Main
- `IoT - Block to Main` (LAN_IN, drop new) — IoT can't initiate to Main
- mDNS enabled on both networks for HomeKit/Bonjour discovery

**Migrated:**
- [x] Shelly 1 - Front Exterior Lights (192.168.20.9)
- [x] Gathering Room TV / Sony (192.168.20.214)
- [x] Klipsch Cinema 1200 Soundbar (192.168.20.77)
- [x] Sony Bravia 75" 4K - Master Suite (192.168.20.213)
- [x] Sony Bravia 55" KD-55XD8005 - Flex Room (pending DHCP lease)
- [x] HP Color LaserJet (pending DHCP lease)

**WiFi devices — switch from Bushido/Kendo to Iaido:**
- [ ] Shelly 1 - Back Exterior Lights (98:f4:ab:b8:fe:45)
- [ ] Ecobee - Main (44:61:32:4f:60:9d)
- [ ] Ecobee - Basement (44:61:32:9d:ac:fe)
- [ ] SleepNumber c2 - The King (cc:04:b4:09:67:6c)
- [ ] SleepNumber i10 360 (64:db:a0:0c:80:0c)
- [ ] Garage Door - Double / Chamberlain (64:52:99:9e:a0:06)
- [ ] Meross Smart Garage (48:e1:e9:df:4f:37)
- [ ] Whirlpool Wall Oven (88:e7:12:0f:b6:90)
- [ ] Hydrawise irrigation controller (f8:f0:05:60:42:c6)
- [ ] Klipsch Gallery speaker (cc:90:93:00:6f:ad)
- [ ] DAKboard / Raspberry Pi (d8:3a:dd:63:b1:b5)
- [ ] Tonka's Halo Collar (04:0d:84:32:1e:9c)
- [ ] Hiro's Hatch / Espressif (48:e7:29:cb:97:80)
- [ ] espressif unknown (0c:ea:14:72:38:87)
- [ ] android-espressif unknown (18:fe:34:2c:87:36)
- [ ] RV30 Max Plus robot vacuum (78:20:51:69:bc:b4)
- [ ] BambuLab X1 Carbon (50:41:1c:e3:5f:bc) — currently on Kendo via dedicated U6 LR AP; try Iaido, then repurpose AP
- [ ] Nintendo Switch (5c:52:1e:98:82:ef)

**Wired devices — need switch port VLAN assignment:**
- [x] Gathering Room TV / Sony — Gathering Room TV switch port 2
- [x] Klipsch Cinema 1200 Soundbar — Gathering Room TV switch port 4
- [ ] TESmart HDMI Switch — Flex Room TV switch port 21 (blocked: Homebridge dependency)
- [x] HP Color LaserJet — Command Center switch port 2
- [x] Sony Bravia 55" KD-55XD8005 - Flex Room — Flex Room TV switch port 24
- [x] Sony Bravia 75" 4K VH22 - Master Suite — Master Suite switch port 3

**Stay on Default (trusted / infrastructure):**
- Apple TVs, Macs, iPhones, iPads — trusted personal devices
- Sapporo (NAS) — needs Main network access
- Tokyo (server) — needs Main network access
- HD HomeRun Prime — streams to Plex/NAS, needs to initiate connections to Main
- Kobe / Ce Link — Anker USB-C ethernet adapter for work laptop
- UniFi cameras & APs — managed infrastructure
- XBOX Series X, PlayStation 5 — gaming (low latency, stay on Main)
- Alienware Alpha — gaming PC

**Notes:**
- WiFi devices: change WiFi to Iaido in device settings or app
- Wired devices: assign switch port to IoT network in UniFi
- DAKboard needs internet for cloud rendering — IoT VLAN allows internet
- Printer on IoT means adding a firewall rule to allow Main → IoT port 9100/631 (already covered by blanket Main → IoT allow)

#### MEDIUM — Unidentified Devices
9 devices with no hostname and unknown manufacturer. Need investigation and labeling.

#### MEDIUM — AP Load Imbalance
First Floor AP has 22 clients, Basement and U6 Long Range have 0-1.
**Action**: Review radio power settings and band steering configuration.

#### LOW — Weak Signal
1 iPhone with RSSI 19 (marginal). May need coverage adjustment.

#### LOW — Offline Switch
Flex Room TV switch showing offline. May be intentional (powered off) or needs attention.

#### DONE — Stale Firewall Rules
~~4 disabled VPN routing rules deleted.~~

### Bugs to Fix
- **OUI parser truncation**: Some manufacturer names cut off ("Espressi", "Raspberr", "Silicond"). CSV parser regex needs fixing.
- **UDM Pro sensitivity**: Parallel API requests caused UDM to become unresponsive. Fixed by making audit calls sequential. May need rate limiting or request throttling for future features.

### Completed
- [x] IDS enabled (detect-only, DNS filtering, honeypot)
- [x] IoT VLAN segmentation — Iaido SSID, firewall rules, 6 wired + 1 WiFi migrated
- [x] Stale firewall rules deleted (4)
- [x] 802.11r fast roaming enabled (all SSIDs)
- [x] WPA3 transition mode enabled (Kendo; Bushido/Iaido need manual toggle)
- [x] LTE backup diagnosed — coverage issue, not hardware
- [x] Mystery devices identified (2 Sony Bravia TVs)
- [x] Bambu X1C MQTT integration (client, API, dashboard card)
- [x] Shelly Front Lights HomeKit fix (now via HA instead of Homebridge)
- [x] Agent auto-start via launchd (agent + dashboard)
- [x] Agent resilience — try/catch + timeouts on all service connections
- [x] Agent UniFi login resilience — single attempt at startup, 30-min cooldown deferred retry
- [x] TLS certs — Let's Encrypt wildcard for *.your-domain.example.com
  - UDM Pro: cert uploaded via UI, auto-deploy via SSH on renewal
  - Synology NAS: cert deployed via API, auto-deploy on renewal
  - Cert auto-renewal daily at 3 AM (certbot + Route 53 DNS challenge)
  - Deploy script: scripts/deploy-certs.sh
- [x] DNS — Route 53 records: udm, nas, maisie, vpn + root A record
- [x] DDNS — Route 53 auto-update every 5 min (replaces stale ddns.net CNAME)
- [x] DHCP search domain set to your-domain.example.com
- [x] AWS CLI configured (IAM user with Route 53 write access)
- [x] BambuLab X1C WiFi — tested U7 Pro APs, incompatible (WiFi 7 fw 8.4.6). Stays on Kendo via U6 LR.

### Network To-Do
- [ ] Gemstone Lights integration — hub is Tuya-based (Tuya IoT portal for local key).
  Need local key. Plan: factory reset hub (hold power button 3s), pair with Tuya Smart app,
  get local key from Tuya IoT portal (Access ID/Secret in .env), then use LocalTuya in HA.
  Hub is in garage ceiling box. Gemstone app uses cert pinning so mitmproxy won't work.
  Tuya IoT credentials: TUYA_ACCESS_ID and TUYA_ACCESS_SECRET in .env.
- [ ] Migrate remaining 17 WiFi IoT devices to Iaido
- [ ] TESmart HDMI switch to IoT (resolve Homebridge dependency first)
- [ ] WPA3 transition mode on Bushido and Iaido (manual via UniFi UI)
- [ ] Switch firmware alignment
- [ ] Investigate AP load imbalance (First Floor heavy, Basement/U6 LR light)
- [ ] Label unnamed devices in UniFi
- [ ] Remove NODE_TLS_REJECT_UNAUTHORIZED=0 from agent (switch to hostname-based connections)

### Maisie Roadmap
1. Slack bot setup (readwriteexecute.slack.com)
2. Style the dashboard
3. LLM-assisted device classification
4. nmap scanning
5. Email/calendar integration
6. Package tracking
7. Daily briefing
8. Sports → lights events
9. Web monitoring
