import { config } from "dotenv";
import { join } from "path";

// Load .env from repo root (Bun only auto-loads .env from cwd)
config({ path: join(import.meta.dir, "../../..", ".env") });

import { createMqttClient } from "./services/mqtt";
import { initDb } from "./services/db";
import { loadDerivedEntities } from "./services/entity-loader";
import { loadDerivedComponents } from "./services/component-loader";
import { loadViewsIntoRegistry } from "./services/view-loader";
import { loadPersonasIntoRegistry } from "./services/persona-loader";
import { createApi } from "./api/index";
import type { Services } from "./api/types";
import { createUniFiClientFromEnv } from "./skills/network/unifi-client";
import { syncDevices } from "./skills/network/sync";
import { ensureOuiDatabase } from "./skills/network/oui-lookup";
import { publish } from "./services/mqtt";
import { TOPICS } from "@maisie/shared";
import { createDsmClientFromEnv } from "./skills/synology/dsm-client";
import { getNasHealth } from "./skills/synology/health";
import { getPlexStatus } from "./skills/media/plex-status";
import { createPlexClientFromEnv } from "./skills/media/plex-client";
import { createRadarrClientFromEnv } from "./skills/media/radarr-client";
import { createSonarrClientFromEnv } from "./skills/media/sonarr-client";
import { createHaClientFromEnv } from "./skills/smarthome/ha-client";
import { createDakboardClientFromEnv } from "./skills/display/dakboard-client";
import { createHdhrClientFromEnv } from "./skills/media/hdhr-client";
import { createBambuClientFromEnv } from "./skills/printer/bambu-client";
import { createGoogleAuthFromEnv } from "./skills/google/google-auth";
import { createCalibreClientFromEnv } from "./skills/calibre/calibre-client";
import { createAiClientFromEnv } from "./services/ai";
import { createCalibreExecFromEnv } from "./services/calibre-exec";
import { initNightly } from "./skills/maintenance/nightly-runner";
import { initDockerUpgrades } from "./skills/maintenance/docker-upgrades";
import { createPs4ClientFromEnv } from "./skills/gaming/ps4-client";
import { syncPs4Apps } from "./skills/gaming/ps4-sync";
import { initYouTubeCleanup } from "./skills/google/youtube-cleanup";
import { createProtectClientFromEnv } from "./skills/network/protect-client";
import { createProwlarrClientFromEnv } from "./skills/media/prowlarr-client";
import { createReadarrClientFromEnv } from "./skills/media/readarr-client";
import { createTransmissionClientFromEnv } from "./skills/media/transmission-client";
import { createAudiobookshelfClientFromEnv } from "./skills/media/audiobookshelf-client";
import { autoPopulateChannels, pushLineup } from "./skills/network/synthetic-hdhr";
import { initEpgService } from "./services/epg";
import { createAgent } from "./agent/index";
import { discoverPlugins } from "./services/plugin-registry";
import type { MaisiePlugin } from "@maisie/shared";
import corePlugin, { setPlugins as setCorePlugins, setCore as setCoreInstance } from "@maisie/plugin-core";
import { initBleSkill } from "./skills/ble/index"
import { startEntityEventBridge } from "./services/entity-events";

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DATA_DIR = join(import.meta.dir, "../../..", "data");
const RECONNECT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/** MQTT wildcard matching: + = single level, # = multi-level */
function topicMatchesPattern(pattern: string, topic: string): boolean {
  const pp = pattern.split('/')
  const tp = topic.split('/')
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '#') return true
    if (pp[i] === '+') continue
    if (pp[i] !== tp[i]) return false
    if (i === pp.length - 1 && i < tp.length - 1) return false
  }
  return pp.length === tp.length
}

async function main() {
  console.log("🏠 Maisie agent starting...");

  // Initialize database
  const db = initDb();
  console.log("  ✓ Database initialized");

  // Load persisted derived entities into the registry
  await loadDerivedEntities(db);

  // Load persisted derived components into the component registry
  await loadDerivedComponents(db);

  // Load persisted views into the view registry
  await loadViewsIntoRegistry(db);

  // Connect to MQTT broker
  const mqtt = await createMqttClient();
  console.log("  ✓ MQTT connected");

  // Load OUI database for manufacturer lookups
  await ensureOuiDatabase();

  // Shared mutable services object — API handlers read from this,
  // reconnection loop updates it when services come back online.
  const services: Services = {
    db,
    unifi: null,
    dsm: null,
    plex: null,
    radarr: null,
    sonarr: null,
    hdhr: null,
    dakboard: null,
    ha: null,
    bambu: null,
    google: null,
    calibre: null,
    claude: null,
    calibreExec: null,
    ps4: null,
    protect: null,
    prowlarr: null,
    transmission: null,
    readarr: null,
    audiobookshelf: null,
    bleRegistry: null,
    bleBridge: null,
  };

  // --- Initial connections ---

  // UniFi — session persisted to data/ so restarts don't require a fresh login
  const unifiClient = createUniFiClientFromEnv(join(DATA_DIR, "unifi-session.json"));
  if (unifiClient) {
    try {
      const restored = await unifiClient.tryRestoreSession();
      if (!restored) await unifiClient.login();
      services.unifi = unifiClient;
      console.log(`  ✓ UniFi connected${restored ? " (restored session)" : ""}`);
      const result = await syncDevices(db, unifiClient);
      console.log(`  ✓ Device sync: ${result.totalActive} active, ${result.newCount} new`);
    } catch (err) {
      console.error("  ✗ UniFi failed to connect (will retry):", err);
    }

    // Periodic sync — re-auth is handled automatically by the client on 401
    setInterval(async () => {
      if (!services.unifi) return;
      try {
        const r = await syncDevices(db, services.unifi);
        if (r.newCount > 0) {
          console.log(`[sync] ${r.newCount} new device(s) detected`);
        }
      } catch (err) {
        console.error("[sync] Device sync failed:", err);
      }
    }, SYNC_INTERVAL_MS);
  } else {
    console.log("  ⚠ UniFi not configured (set UNIFI_HOST, UNIFI_USERNAME, UNIFI_PASSWORD in .env)");
  }

  // Synology DSM
  const dsmClient = createDsmClientFromEnv();
  if (dsmClient) {
    try {
      await Promise.race([
        dsmClient.login(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
      ]);
      services.dsm = dsmClient;
      console.log("  ✓ Synology DSM connected");

    } catch (err) {
      console.error("  ✗ Synology DSM failed to connect (will retry):", err);
    }
  } else {
    console.log("  ⚠ Synology not configured (set SYNOLOGY_HOST, SYNOLOGY_USERNAME, SYNOLOGY_PASSWORD in .env)");
  }

  // Plex
  const plexClient = createPlexClientFromEnv();
  if (plexClient) {
    try {
      const info = await plexClient.getServerInfo();
      services.plex = plexClient;
      console.log(`  ✓ Plex connected (${info.friendlyName})`);
    } catch (err) {
      console.error("  ✗ Plex failed to connect (will retry):", err);
    }
  } else {
    console.log("  ⚠ Plex not configured (set PLEX_HOST, PLEX_TOKEN in .env)");
  }

  // Radarr
  const radarrClient = createRadarrClientFromEnv();
  if (radarrClient) {
    try {
      const status = await radarrClient.getSystemStatus();
      services.radarr = radarrClient;
      console.log(`  ✓ Radarr connected (v${status.version})`);
    } catch (err) {
      console.error("  ✗ Radarr failed to connect (will retry):", err);
    }
  } else {
    console.log("  ⚠ Radarr not configured (set RADARR_HOST, RADARR_API_KEY in .env)");
  }

  // Sonarr
  const sonarrClient = createSonarrClientFromEnv();
  if (sonarrClient) {
    try {
      const status = await sonarrClient.getSystemStatus();
      services.sonarr = sonarrClient;
      console.log(`  ✓ Sonarr connected (v${status.version})`);
    } catch (err) {
      console.error("  ✗ Sonarr failed to connect (will retry):", err);
    }
  } else {
    console.log("  ⚠ Sonarr not configured (set SONARR_HOST, SONARR_API_KEY in .env)");
  }

  // HDHomeRun
  const hdhrClient = createHdhrClientFromEnv();
  if (hdhrClient) {
    try {
      const info = await hdhrClient.getDeviceInfo();
      services.hdhr = hdhrClient;
      console.log(`  ✓ HDHomeRun connected (${info.FriendlyName}, ${info.TunerCount} tuners)`);
    } catch (err) {
      console.error("  ✗ HDHomeRun failed to connect (will retry):", err);
    }
  } else {
    console.log("  ⚠ HDHomeRun not configured (set HDHR_HOST in .env)");
  }

  // Home Assistant
  const haClient = createHaClientFromEnv();
  if (haClient) {
    try {
      const info = await haClient.ping();
      services.ha = haClient;
      console.log(`  ✓ Home Assistant connected (${info.message})`);
    } catch (err) {
      console.error("  ✗ Home Assistant failed to connect (will retry):", err);
    }
  } else {
    console.log("  ⚠ Home Assistant not configured (set HA_HOST, HA_TOKEN in .env)");
  }

  // DAKboard
  const dakboardClient = createDakboardClientFromEnv();
  if (dakboardClient) {
    try {
      const devices = await dakboardClient.getDevices();
      const screens = await dakboardClient.getScreens();
      services.dakboard = dakboardClient;
      console.log(`  ✓ DAKboard connected (${devices.length} devices, ${screens.length} screens)`);
    } catch (err) {
      console.error("  ✗ DAKboard failed to connect (will retry):", err);
    }
  } else {
    console.log("  ⚠ DAKboard not configured (set DAKBOARD_API_KEY in .env)");
  }

  // Bambu Lab printer
  const bambuClient = createBambuClientFromEnv();
  if (bambuClient) {
    try {
      await bambuClient.connect();
      bambuClient.requestFullStatus();
      bambuClient.onStatus((status) => {
        publish("home/printer/status", {
          ...status,
          timestamp: new Date().toISOString(),
        });
      });
      services.bambu = bambuClient;
      console.log("  ✓ Bambu Lab X1C connected");
    } catch (err) {
      console.error("  ✗ Bambu failed to connect (will retry):", err);
    }
  } else {
    console.log("  ⚠ Bambu not configured (set BAMBU_HOST, BAMBU_SERIAL, BAMBU_ACCESS_CODE in .env)");
  }

  // Google OAuth (Gmail + Calendar)
  const googleClient = createGoogleAuthFromEnv();
  if (googleClient) {
    services.google = googleClient;
    if (googleClient.isAuthorized()) {
      console.log("  ✓ Google connected (tokens loaded)");
    } else {
      console.log("  ⚠ Google configured but not authorized — visit http://localhost:3001/api/google/auth");
    }
  } else {
    console.log("  ⚠ Google not configured (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in .env)");
  }

  // YouTube cleanup scheduler — PAUSED while debugging removal issues
  // if (googleClient?.isAuthorized()) {
  //   initYouTubeCleanup(googleClient, 3);
  // }

  // Calibre
  const calibreClient = createCalibreClientFromEnv();
  if (calibreClient) {
    try {
      const info = await calibreClient.getLibraryInfo();
      const libCount = Object.keys(info.library_map).length;
      services.calibre = calibreClient;
      console.log(`  ✓ Calibre connected (${libCount} libraries)`);
    } catch (err) {
      console.error("  ✗ Calibre failed to connect (will retry):", err);
    }
  } else {
    console.log("  ⚠ Calibre not configured (set CALIBRE_HOST in .env)");
  }

  // AI client (Anthropic by default; set AI_PROVIDER=openai/ollama for alternatives)
  const aiClient = createAiClientFromEnv();
  if (aiClient) {
    services.claude = aiClient;
    const provider = process.env.AI_PROVIDER ?? "anthropic";
    console.log(`  ✓ AI configured (${provider})`);
  } else {
    console.log("  ⚠ AI not configured (set ANTHROPIC_API_KEY or AI_PROVIDER + key in .env)");
  }

  // Calibre exec (docker exec → local Calibre container)
  const calibreExecClient = createCalibreExecFromEnv();
  services.calibreExec = calibreExecClient;
  console.log(`  ✓ Calibre exec configured (docker → ${process.env.CALIBRE_CONTAINER_NAME || "calibre"})`);

  // PS4 (FTP)
  const ps4Client = createPs4ClientFromEnv();
  if (ps4Client) {
    try {
      const online = await ps4Client.ping();
      if (online) {
        services.ps4 = ps4Client;
        const apps = await ps4Client.getInstalledApps();
        const result = syncPs4Apps(db, apps);
        console.log(`  ✓ PS4 connected (${result.total} apps, ${result.added} new)`);
      } else {
        services.ps4 = ps4Client; // keep client for later scans
        console.log("  ⚠ PS4 configured but offline (FTP not responding)");
      }
    } catch (err) {
      services.ps4 = ps4Client;
      console.error("  ✗ PS4 failed to connect (will retry):", err);
    }
  } else {
    console.log("  ⚠ PS4 not configured (set PS4_HOST in .env)");
  }

  // Readarr (audiobooks)
  const readarrClient = createReadarrClientFromEnv();
  if (readarrClient) {
    try {
      const status = await readarrClient.getSystemStatus();
      services.readarr = readarrClient;
      console.log(`  ✓ Readarr connected (v${status.version})`);
    } catch (err) {
      services.readarr = readarrClient;
      console.error("  ✗ Readarr configured but failed to connect:", err);
    }
  } else {
    console.log("  ⚠ Readarr not configured (set READARR_HOST in .env)");
  }

  // Audiobookshelf (audiobook library)
  const absClient = createAudiobookshelfClientFromEnv();
  if (absClient) {
    try {
      const status = await absClient.getSystemStatus();
      services.audiobookshelf = absClient;
      console.log(`  ✓ Audiobookshelf connected (v${status.serverVersion})`);
    } catch (err) {
      services.audiobookshelf = absClient;
      console.error("  ✗ Audiobookshelf configured but failed to connect:", err);
    }
  } else {
    console.log("  ⚠ Audiobookshelf not configured (set ABS_HOST, ABS_TOKEN in .env)");
  }

  // Prowlarr (indexer search)
  const prowlarrClient = createProwlarrClientFromEnv();
  if (prowlarrClient) {
    services.prowlarr = prowlarrClient;
    console.log("  ✓ Prowlarr configured");
  } else {
    console.log("  ⚠ Prowlarr not configured (set PROWLARR_HOST in .env)");
  }

  // Transmission (torrent downloads)
  const transmissionClient = createTransmissionClientFromEnv();
  if (transmissionClient) {
    try {
      const ok = await transmissionClient.test();
      if (ok) {
        services.transmission = transmissionClient;
        console.log("  ✓ Transmission connected");
      } else {
        console.log("  ⚠ Transmission configured but not responding");
      }
    } catch (err) {
      console.error("  ✗ Transmission failed:", err);
    }
  } else {
    console.log("  ⚠ Transmission not configured (set TRANSMISSION_HOST in .env)");
  }

  // UniFi Protect (same UDM, separate session)
  const protectClient = createProtectClientFromEnv(join(DATA_DIR, "protect-session.json"));
  if (protectClient) {
    try {
      const restored = await protectClient.tryRestoreSession();
      if (!restored) await protectClient.login();
      const cameras = await protectClient.getCameras();
      services.protect = protectClient;
      console.log(`  ✓ UniFi Protect connected (${cameras.length} cameras)${restored ? " (restored session)" : ""}`);

      // Auto-populate HDHR channels from cameras (only if table is empty)
      try {
        const pop = await autoPopulateChannels(db, cameras);
        if (pop.added > 0) console.log(`  ✓ HDHR channels auto-populated (${pop.added} channels)`);
        const sync = await pushLineup(db);
        if (sync.pushed > 0) console.log(`  ✓ HDHR lineup pushed (${sync.pushed} channels)`);
      } catch {
        // synthetic-hdhr service might not be up yet — will sync on first API call
      }
    } catch (err) {
      console.error("  ✗ UniFi Protect failed to connect (will retry):", err);
    }
  } else {
    console.log("  ⚠ UniFi Protect not configured (set UNIFI_PROTECT_ENABLED=true in .env)");
  }

  // --- Audiobook import fallback ---
  // Every 5 minutes, check if there are completed audiobook downloads that Readarr
  // hasn't imported, and move them to the Audiobookshelf library directly.
  const AUDIOBOOK_SRC = "/transmission-data/completed/readarr";
  const AUDIOBOOK_DEST = "/audiobooks";
  setInterval(async () => {
    try {
      const { readdirSync, statSync, mkdirSync, renameSync, existsSync } = await import("fs");
      const { join } = await import("path");
      if (!existsSync(AUDIOBOOK_SRC)) return;
      const entries = readdirSync(AUDIOBOOK_SRC);
      for (const entry of entries) {
        const src = join(AUDIOBOOK_SRC, entry);
        const stat = statSync(src);
        // Only move items older than 10 minutes (give Readarr time to import first)
        if (Date.now() - stat.mtimeMs < 10 * 60_000) continue;
        const dest = join(AUDIOBOOK_DEST, entry);
        if (existsSync(dest)) continue;
        try {
          renameSync(src, dest);
          console.log(`[audiobook] Moved to Audiobookshelf: ${entry}`);
        } catch {
          // Cross-device move — try copy via spawn
          await Bun.spawn(["cp", "-r", src, dest]).exited;
          await Bun.spawn(["rm", "-rf", src]).exited;
          console.log(`[audiobook] Copied to Audiobookshelf: ${entry}`);
        }
      }
    } catch { /* source dir doesn't exist yet or other transient error */ }
  }, 5 * 60_000);

  // --- Reconnection loop ---
  // Every 2 minutes, retry services that failed initial connection.
  // UniFi and Protect use their own exponential-backoff loops (see below)
  // because the UDM Pro has an aggressive login rate limit that a fixed
  // interval can keep resetting.
  setInterval(async () => {
    // DSM
    if (!services.dsm && dsmClient) {
      try {
        await Promise.race([
          dsmClient.login(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
        ]);
        services.dsm = dsmClient;
        console.log("[reconnect] ✓ Synology DSM reconnected");
      } catch { /* still down */ }
    }

    // Plex
    if (!services.plex && plexClient) {
      try {
        await plexClient.getServerInfo();
        services.plex = plexClient;
        console.log("[reconnect] ✓ Plex reconnected");
      } catch { /* still down */ }
    }

    // Radarr
    if (!services.radarr && radarrClient) {
      try {
        await radarrClient.getSystemStatus();
        services.radarr = radarrClient;
        console.log("[reconnect] ✓ Radarr reconnected");
      } catch { /* still down */ }
    }

    // Sonarr
    if (!services.sonarr && sonarrClient) {
      try {
        await sonarrClient.getSystemStatus();
        services.sonarr = sonarrClient;
        console.log("[reconnect] ✓ Sonarr reconnected");
      } catch { /* still down */ }
    }

    // HDHomeRun
    if (!services.hdhr && hdhrClient) {
      try {
        await hdhrClient.getDeviceInfo();
        services.hdhr = hdhrClient;
        console.log("[reconnect] ✓ HDHomeRun reconnected");
      } catch { /* still down */ }
    }

    // Home Assistant
    if (!services.ha && haClient) {
      try {
        await haClient.ping();
        services.ha = haClient;
        console.log("[reconnect] ✓ Home Assistant reconnected");
      } catch { /* still down */ }
    }

    // DAKboard
    if (!services.dakboard && dakboardClient) {
      try {
        await dakboardClient.getDevices();
        services.dakboard = dakboardClient;
        console.log("[reconnect] ✓ DAKboard reconnected");
      } catch { /* still down */ }
    }

    // Bambu
    if (!services.bambu && bambuClient) {
      try {
        await bambuClient.connect();
        bambuClient.requestFullStatus();
        bambuClient.onStatus((status) => {
          publish("home/printer/status", {
            ...status,
            timestamp: new Date().toISOString(),
          });
        });
        services.bambu = bambuClient;
        console.log("[reconnect] ✓ Bambu Lab X1C reconnected");
      } catch { /* still down */ }
    }

    // Calibre
    if (!services.calibre && calibreClient) {
      try {
        await calibreClient.getLibraryInfo();
        services.calibre = calibreClient;
        console.log("[reconnect] ✓ Calibre reconnected");
      } catch { /* still down */ }
    }
  }, RECONNECT_INTERVAL_MS);

  // --- UniFi / Protect exponential-backoff reconnect ---
  // The UDM Pro has an aggressive rolling-window rate limit (~2 logins per
  // 15 min). A fixed interval can keep hitting it and resetting the window,
  // locking us out indefinitely. Exponential backoff gives the window time
  // to clear: 2 min → 4 → 8 → 16 → 30 (cap), reset to 2 on success.
  const UNIFI_BACKOFF_MIN = 2 * 60 * 1000;   // 2 min
  const UNIFI_BACKOFF_MAX = 30 * 60 * 1000;  // 30 min

  function scheduleUnifiReconnect(delay: number) {
    setTimeout(async () => {
      let nextDelay = delay;

      // UniFi Protect
      if (!services.protect && protectClient) {
        try {
          await protectClient.login();
          services.protect = protectClient;
          console.log("[reconnect] ✓ UniFi Protect reconnected");
          nextDelay = UNIFI_BACKOFF_MIN; // reset on success
        } catch (err) {
          const msg = String(err);
          const is429 = msg.includes("429") || msg.includes("Too Many");
          const next = Math.min(delay * 2, UNIFI_BACKOFF_MAX);
          if (is429) {
            console.warn(`[reconnect] UniFi Protect 429 — backing off to ${next / 60000}m`);
          }
          nextDelay = next;
        }
      }

      // UniFi (same UDM controller, same rate limit)
      if (!services.unifi && unifiClient) {
        try {
          await unifiClient.login();
          services.unifi = unifiClient;
          console.log("[reconnect] ✓ UniFi reconnected");
          nextDelay = UNIFI_BACKOFF_MIN; // reset on success
        } catch (err) {
          const msg = String(err);
          const is429 = msg.includes("429") || msg.includes("Too Many");
          const next = Math.min(delay * 2, UNIFI_BACKOFF_MAX);
          if (is429) {
            console.warn(`[reconnect] UniFi 429 — backing off to ${next / 60000}m`);
          }
          nextDelay = Math.max(nextDelay, next); // take the longer delay
        }
      }

      // If either service is still down, keep retrying
      if (!services.protect || !services.unifi) {
        scheduleUnifiReconnect(nextDelay);
      }
    }, delay);
  }

  if ((protectClient && !services.protect) || (unifiClient && !services.unifi)) {
    scheduleUnifiReconnect(UNIFI_BACKOFF_MIN);
  }

  // BLE skill — device registry + MQTT bridge (listens for gateway events)
  const ble = initBleSkill(db);
  services.bleRegistry = ble.registry;
  services.bleBridge = ble.bridge;
  console.log("  ✓ BLE skill initialized");

  // Discover plugins
  const rootDir = join(import.meta.dir, "../../..");
  let loadedPlugins: MaisiePlugin[] = [];
  try {
    const entries = await discoverPlugins(rootDir);
    loadedPlugins = entries.map((e) => e.plugin);
    if (loadedPlugins.length > 0) {
      console.log(`  ✓ Plugins discovered: ${loadedPlugins.map((p) => p.name).join(", ")}`);
    }
  } catch (err) {
    console.warn("  ⚠ Plugin discovery failed:", err);
  }

  // Register core plugin (always loaded — provides plugin/persona/layout management)
  const coreCore = {
    db,
    mqtt: {
      publish: (topic: string, payload: unknown) => publish(topic, payload as Record<string, unknown>),
      subscribe: (topic: string, handler: (payload: unknown) => void) => {
        mqtt.subscribe(topic);
        mqtt.on('message', (t: string, buf: Buffer) => {
          if (t !== topic) return;
          let parsed: unknown;
          try { parsed = JSON.parse(buf.toString()); } catch { parsed = buf.toString(); }
          handler(parsed);
        });
      },
      unsubscribe: () => {},
    },
    getCapability: () => null,
    ai: aiClient,
    log: (plugin: string, level: 'info' | 'warn' | 'error', message: string, data?: unknown) => {
      console[level](`[${plugin}] ${message}`, data ?? '');
    },
  };
  await corePlugin.init(coreCore);
  setCoreInstance(coreCore);

  // Channing's persona lives in synthetic-hdhr (a separate service, not a discoverable plugin).
  // Inject it as a persona-only stub so it appears in /api/personas and the agent's router.
  const channingStub: MaisiePlugin = {
    name: 'synthetic-hdhr',
    version: '0.1.0',
    description: 'Synthetic HDHomeRun — TV channels persona stub',
    capabilities: [],
    envVars: [],
    actions: [],
    events: [],
    persona: {
      name: 'Channing',
      role: 'TV & streaming specialist',
      avatar: '📺',
      defaultTier: 'advise',
      eventSubscriptions: ['home/media/plex/#', 'home/tv/#', 'home/channels/#', 'home/synthetic-hdhr/#'],
      toolScopes: ['get_lineup', 'get_channel_now_playing', 'get_channel_schedule', 'get_epg_guide', 'refresh_epg', 'add_library_channel', 'update_library_channel', 'remove_library_channel', 'get_library_channel_config'],
      systemPrompt: 'You are Channing, the TV and streaming specialist for this home. Your domain is the synthetic TV lineup — a custom HDHomeRun emulator that unifies cable channels (1–999), library channels (20001–29999), and camera streams (90001–90999) into Plex Live TV.',
    },
    async init() {},
    async shutdown() {},
    async healthCheck() { return { status: 'healthy', lastCheck: new Date() } },
  };

  // Prepend core, add channing stub, deduplicate by name (discovery may have picked up plugin-core)
  const allPlugins = [
    corePlugin,
    channingStub,
    ...loadedPlugins.filter((p) => p.name !== 'core' && p.name !== 'synthetic-hdhr'),
  ];
  setCorePlugins(allPlugins);
  loadedPlugins = allPlugins;
  console.log("  ✓ Core plugin initialized");

  // Phase 4c: load DB-persisted personas into the entity registry.
  // Built-ins are already registered by setCorePlugins → setPlugins above.
  // DB rows override built-ins with the same name (custom or seeded built-ins).
  await loadPersonasIntoRegistry(db);

  // Initialize all discovered plugins — calls each plugin's init() so their
  // internal clients (getClients()) are populated before the API starts.
  // Before each init, apply any env overrides stored in the DB so plugins
  // that read process.env in their init() pick up user-configured values.
  const { pluginConfigs: pluginConfigsTable } = await import('./services/schema')
  const { eq } = await import('drizzle-orm')
  for (const plugin of loadedPlugins) {
    if (plugin.name === 'core' || plugin.name === 'synthetic-hdhr') continue;
    try {
      const stored = await db
        .select()
        .from(pluginConfigsTable)
        .where(eq(pluginConfigsTable.packageName, plugin.name))
        .get()
      if (stored?.envOverrides) {
        const overrides = JSON.parse(stored.envOverrides) as Record<string, string>
        for (const [k, v] of Object.entries(overrides)) {
          if (v) process.env[k] = v
        }
      }
      await plugin.init(coreCore);
    } catch (err) {
      console.warn(`  ⚠ Plugin ${plugin.name} init() failed:`, err);
    }
  }

  // Agent runtime — wires MQTT events to the agent loop
  let agent: ReturnType<typeof createAgent> | undefined
  if (aiClient) {
    agent = createAgent({
      plugins: loadedPlugins,
      ai: aiClient,
      db,
      mqtt: {
        subscribe: (topic, handler) => {
          mqtt.subscribe(topic)
          mqtt.on('message', (t: string, payload: Buffer) => {
            if (!topicMatchesPattern(topic, t)) return
            let parsed: unknown
            try { parsed = JSON.parse(payload.toString()) } catch { parsed = payload.toString() }
            handler(t, parsed)
          })
        },
      },
    })
    agent.start()
  }

  // Entity event bridge — translates plugin MQTT events into derived-entity
  // invalidation notices so dashboard components re-fetch when base data changes.
  startEntityEventBridge()
  console.log("  ✓ Entity event bridge started")

  // Start HTTP API
  const port = Number(process.env.API_PORT) || 3001;
  const api = createApi(services, agent, loadedPlugins);

  Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: api.fetch,
    idleTimeout: 60,
  });

  console.log(`  ✓ API listening on port ${port}`);

  // EPG guide service (fetches TV schedule from SiliconDust API)
  initEpgService();

  // Trigger synthetic-hdhr lineup rebuild so that library + camera channels are
  // always up-to-date after a maisie restart (synthetic-hdhr may have started
  // before maisie and its initial buildLineup() would have fetched an empty list).
  const SYNTHETIC_HDHR_URL = process.env.SYNTHETIC_HDHR_URL || "http://synthetic-hdhr:5004";
  fetch(`${SYNTHETIC_HDHR_URL}/api/rebuild`, { method: "POST" })
    .then((r) => r.ok
      ? console.log("  ✓ synthetic-hdhr lineup rebuilt")
      : console.warn("  ⚠ synthetic-hdhr lineup rebuild failed:", r.status))
    .catch((err) => console.warn("  ⚠ synthetic-hdhr lineup rebuild failed:", err));

  // Nightly maintenance runner
  const nightlyMoviePaths = (process.env.PLEX_MOVIES_PATH || "").split(",").map(s => s.trim()).filter(Boolean);
  const nightlyTvPaths = (process.env.PLEX_TV_PATH || "").split(",").map(s => s.trim()).filter(Boolean);
  if (nightlyMoviePaths.length > 0 || nightlyTvPaths.length > 0) {
    initNightly({
      db,
      dsm: services.dsm,
      windowStart: Number(process.env.NIGHTLY_START_HOUR) || 23,
      windowEnd: Number(process.env.NIGHTLY_END_HOUR) || 5,
      moviePaths: nightlyMoviePaths,
      tvPaths: nightlyTvPaths,
      hevcEnabled: process.env.HEVC_ENABLED === "true",
      hevcQueuePath: process.env.HEVC_QUEUE_PATH,
      plexDbPath: process.env.PLEX_DB_PATH,
      plexMediaPrefix: process.env.PLEX_MEDIA_PREFIX || "/media/",
      plexHostPrefix: process.env.PLEX_HOST_PREFIX,
    });
  } else {
    console.log("  ⚠ Nightly runner not configured (set PLEX_MOVIES_PATH and/or PLEX_TV_PATH in .env)");
  }

  initDockerUpgrades({ db });

  // Heartbeat every 30s
  setInterval(() => {
    publish(TOPICS.system.agent.heartbeat, {
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  }, 30_000);

  // Publish live state every 30s for dashboard
  setInterval(async () => {
    try {
      // Plex now playing
      if (services.plex) {
        const status = await getPlexStatus(services.plex);
        publish(TOPICS.media.plex.nowPlaying, {
          nowPlaying: status.nowPlaying,
          recentlyAdded: status.recentlyAdded,
          timestamp: status.timestamp,
        });
      }

      // NAS health
      if (services.dsm) {
        const health = await getNasHealth(services.dsm);
        publish(TOPICS.nas.health, health as unknown as Record<string, unknown>);
      }

      // HA switches/lights state
      if (services.ha) {
        const switches = await services.ha.getSwitches();
        const lights = await services.ha.getLights();
        publish("home/smarthome/state", {
          switches: switches.map((s) => ({
            entityId: s.entity_id,
            name: s.attributes.friendly_name,
            state: s.state,
          })),
          lights: lights.map((l) => ({
            entityId: l.entity_id,
            name: l.attributes.friendly_name,
            state: l.state,
            brightness: l.attributes.brightness,
          })),
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error("[live] State publish error:", err);
    }
  }, 30_000);

  // Publish initial heartbeat
  publish(TOPICS.system.agent.heartbeat, {
    status: "ok",
    timestamp: new Date().toISOString(),
  });

  console.log("🏠 Maisie agent ready");
}

main().catch((err) => {
  console.error("Fatal error starting agent:", err);
  process.exit(1);
});
