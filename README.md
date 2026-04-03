# Maisie

[![CI](https://github.com/thehammer/maisie/actions/workflows/ci.yml/badge.svg)](https://github.com/thehammer/maisie/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Your home has a network, a NAS, a media server, cameras, a printer, a book library, and a dozen services that each live in their own silo. You check the NAS dashboard, then the Plex dashboard, then the UniFi dashboard — and none of them know the others exist. Maisie changes that. Named after *maison* — the French word for house — Maisie is not software you run in your house. Maisie *is* the house, made intelligent. It connects everything you have, surfaces what matters, and gives you a team of AI specialists who know your home the way you know it: as a single living place, not a collection of apps.

---

## The Three Surfaces

This is the most important concept in Maisie. Every capability is simultaneously available in three forms:

**1. Dashboard** — A live UI panel for humans who prefer to see and click. Network devices show up as a grid with vendor icons, online/offline state, and a button to block. The NAS shows temperature, disk health, and Docker containers. The TV guide shows what's on now.

**2. REST API** — A typed, documented endpoint for developers who want to automate. Every dashboard panel has a corresponding `GET` or `POST` endpoint. `GET /api/unifi/get_devices` returns the same device array the dashboard renders — full schema, no scraping required.

**3. AI Tool** — The same operation, available to agent specialists who act on behalf of your household. When Natalie calls `get_devices`, she cross-references vendors and VLANs, compares against known good state, and tells you if something looks wrong — or just handles it.

This is not three separate implementations. It is one definition — a `PluginAction` — that the framework surfaces in all three places. Write it once. Get all three.

```
New device appears on network
  → MQTT event fires
  → Natalie is subscribed to home/network/devices/new
  → Natalie calls get_devices (the AI tool)
  → Cross-references vendor, VLAN, time-of-day
  → No match in known devices → sends you a Slack message
  → You see the alert in the dashboard network panel too
  → GET /api/unifi/get_devices reflects it immediately
```

Same data. Same underlying operation. Three surfaces.

---

## The Household

Maisie has a team of AI specialists. Each one knows their domain deeply — its services, its data, its failure modes. Each one has the right tools for their work.

**Maisie** — The coordinator. Knows the whole house. Routes to the right specialist. When you ask a general question — "is everything okay?" — Maisie assembles the picture.

**Natalie** — Network and infrastructure. Knows every device by MAC, vendor, and VLAN. Notices when something new appears, when something disappears, when WAN health degrades. Watches the NAS.

**Channing** — TV and streaming. Manages the unified channel lineup: cable, cameras, and library channels. Knows the EPG. Enthusiastic about good television.

**Alexandria** — Books and library. Manages the Calibre library. Enriches metadata, identifies series gaps, proposes corrections. Meticulous about completeness and accuracy.

These aren't bots. They're specialists with domain expertise, memory of *your* home, and the right tools for their domain. When a new device appears on the network, Natalie notices. When the print job fails, the printer specialist diagnoses. When you ask about a book series, Alexandria answers.

Community plugins can bring their own specialists. Install a plugin, meet a new member of the household.

---

## Principles

**1. Three surfaces, one definition.** Any capability is simultaneously UX, API, and AI tool. This is enforced by construction, not convention. A `PluginAction` either declares all three (or explicitly opts one out) — there is no partial definition.

**2. The AI is structural, not decorative.** Agents are the coordination layer, not a chatbot bolted on. Events flow in, specialists reason, actions are taken or surfaced for human review. The AI is how the house thinks, not a feature you toggle on.

**3. Plugins over configuration.** Install what you have. Skip what you don't. The plugin contract is clear; the framework handles the plumbing. A home with UniFi and Plex looks different from one with Eero and Jellyfin — Maisie works for both.

**4. Opinionated stack, unopinionated about your home.** TypeScript, Bun, Hono, SQLite, MQTT, Docker Compose — these are not negotiable. Plex or Jellyfin, UniFi or Eero — your choice. The stack is fixed so the integrations can be deep.

**5. Behavioral correctness.** Every capability is tested against what the system does from the outside, not how it does it internally. Tests describe behavior. Implementations change. Contracts don't.

---

## Getting Started

**Requirements:** Docker + Docker Compose, a home server (Linux recommended), at least one supported service.

```bash
git clone https://github.com/maisie-os/maisie
cd maisie
cp .env.example .env
# Edit .env — add credentials for what you have.
# Every integration is optional except the core services.
docker compose up
# Dashboard at http://your-server-ip:3001
```

On first boot, Maisie connects to whatever services you've configured, builds the initial device inventory, and starts listening for events. The specialists wake up and begin their work.

---

## Official Plugins

| Plugin | Connects to | Capabilities | Specialist |
|--------|-------------|--------------|------------|
| @maisie/plugin-unifi | UniFi controller | network, camera | Natalie |
| @maisie/plugin-synology | Synology DSM | storage | Natalie |
| @maisie/plugin-plex | Plex Media Server | media-server | — |
| @maisie/plugin-calibre | Calibre library | book-library | Alexandria |
| @maisie/plugin-synthetic-hdhr | HDHomeRun emulator | tv-tuner | Channing |
| @maisie/plugin-home-assistant | Home Assistant | smart-home | — |
| @maisie/plugin-bambu | Bambu Lab printers | printer | — |
| @maisie/plugin-google | Google Workspace | — | — |
| @maisie/plugin-radarr | Radarr | — | — |
| @maisie/plugin-sonarr | Sonarr | — | — |

---

## Building a Plugin

A Maisie plugin is a `PluginAction` collection wrapped in a `MaisiePlugin` manifest. Define your actions — each one is a single TypeScript object with an `execute` function, HTTP config, AI tier, and UI declaration — and the framework does the rest. Your action becomes a route, a tool, and a dashboard hook simultaneously.

If your plugin has a domain specialist (a persona who knows this integration deeply), add a `persona` to your plugin manifest. Give them a system prompt, event subscriptions, and tool scopes. They'll wake up when events arrive and have exactly the tools they need for their domain.

Once your plugin is ready, publish it to the community registry. Anyone who installs it gets the full three-surface experience and, if you've included a persona, a new member of their household team.

See [docs/building-a-plugin.md](docs/building-a-plugin.md) for the full authoring guide.

---

## Stack

TypeScript, Bun, Hono, SQLite + Drizzle ORM, MQTT (Mosquitto), React + Vite, Docker Compose.

---

## License

MIT
