// MQTT topic constants — single source of truth for all pub/sub

export const TOPICS = {
  network: {
    devices: {
      new: "home/network/devices/new",
      changed: "home/network/devices/changed",
      missing: "home/network/devices/missing",
    },
    health: {
      wan: "home/network/health/wan",
      ap: (name: string) => `home/network/health/ap/${name}` as const,
    },
    alerts: {
      rogueDevice: "home/network/alerts/rogue_device",
      anomalousTraffic: "home/network/alerts/anomalous_traffic",
      openPort: "home/network/alerts/open_port",
    },
  },
  media: {
    radarr: { upcoming: "home/media/radarr/upcoming" },
    sonarr: { upcoming: "home/media/sonarr/upcoming" },
    plex: {
      recentlyAdded: "home/media/plex/recently_added",
      nowPlaying: "home/media/plex/now_playing",
    },
  },
  smarthome: {
    lights: (zone: string) => `home/smarthome/lights/${zone}` as const,
    scenes: { triggered: "home/smarthome/scenes/triggered" },
    sports: { gameResult: "home/smarthome/sports/game_result" },
  },
  packages: {
    shipped: "home/packages/shipped",
    statusChanged: "home/packages/status_changed",
    delivered: "home/packages/delivered",
  },
  printer: {
    bambu: {
      status: "home/printer/bambu/status",
      filament: "home/printer/bambu/filament",
    },
    inventory: { lowStock: "home/printer/inventory/low_stock" },
  },
  nas: {
    storage: { alert: "home/nas/storage/alert" },
    docker: {
      changed: "home/nas/docker/changed",
      down: "home/nas/docker/down",
    },
    health: "home/nas/health",
  },
  gaming: {
    ps4: {
      status: "home/gaming/ps4/status",
      catalog: "home/gaming/ps4/catalog",
    },
  },
  protect: {
    cameras: "home/protect/cameras",
    events: "home/protect/events",
  },
  hpPrinter: {
    status: "home/hp-printer/status",
    supplyLow: "home/hp-printer/supply_low",
    error: "home/hp-printer/error",
  },
  system: {
    agent: {
      health: (skill: string) => `home/system/agent/${skill}/health` as const,
      heartbeat: "home/system/agent/heartbeat",
    },
    scanner: { results: "home/system/scanner/results" },
    nightly: {
      status: "home/system/nightly/status",
      progress: "home/system/nightly/progress",
    },
    hevc: {
      status: "home/system/hevc/status",
    },
  },
} as const;
