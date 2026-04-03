import { Hono } from "hono";
import { streamCamera } from "./camera-streams";
import {
  isPrimeConfigured,
  isPrimeAvailable,
  getPrimeLineup,
  fetchPrimeLineup,
  streamFromPrime,
  startPrimeRefresh,
} from "./prime-proxy";
import { generateXmltv, OTA_NAMES, type EpgChannel } from "./epg";

const PORT = Number(process.env.PORT) || 5004;
const DEVICE_ID = process.env.DEVICE_ID || "MAISIE01";
const DEVICE_NAME = process.env.DEVICE_NAME || "The Estate TV";
const TUNER_COUNT = Number(process.env.TUNER_COUNT) || 7;
const MAISIE_URL = process.env.MAISIE_URL || "http://maisie:3001";
const CAMERA_CHANNEL_START = Number(process.env.CAMERA_CHANNEL_START) || 10001;

// --- Channel types ---

interface CameraChannel {
  number: string;
  name: string;
  streamName: string;
  type: "camera";
}

interface CableChannel {
  number: string;
  name: string;
  callSign: string;
  type: "cable";
}

interface LibraryChannel {
  number: string;
  name: string;
  type: "library";
}

type Channel = CameraChannel | CableChannel | LibraryChannel;

let channels: Channel[] = [];

function getCableChannels(): CableChannel[] {
  return channels.filter((c): c is CableChannel => c.type === "cable");
}

function getCameraChannels(): CameraChannel[] {
  return channels.filter((c): c is CameraChannel => c.type === "camera");
}

function getLibraryChannels(): LibraryChannel[] {
  return channels.filter((c): c is LibraryChannel => c.type === "library");
}

// --- Build unified lineup ---

async function buildLineup() {
  const newChannels: Channel[] = [];

  // 1. Cable channels from PRIME (refresh first)
  // Skip DRM-protected and known-broken channels
  const EXCLUDED_CHANNELS = new Set(["183"]); // WCIU — ffmpeg can't parse
  if (isPrimeConfigured()) {
    await fetchPrimeLineup();
    const primeLineup = getPrimeLineup();
    for (const ch of primeLineup) {
      if (ch.DRM || EXCLUDED_CHANNELS.has(ch.GuideNumber)) continue;
      const otaInfo = OTA_NAMES[ch.GuideName];
      newChannels.push({
        number: ch.GuideNumber,
        name: otaInfo?.name || ch.GuideName,
        callSign: ch.GuideName,
        type: "cable",
      });
    }
  }

  // 2. Camera channels from Maisie
  try {
    const res = await fetch(`${MAISIE_URL}/api/synthetic-hdhr/channels`);
    if (res.ok) {
      const maisieChannels = (await res.json()) as any[];
      for (const ch of maisieChannels.filter((c: any) => c.enabled)) {
        newChannels.push({
          number: ch.number,
          name: ch.name,
          streamName: ch.streamName,
          type: "camera",
        });
      }
    }
  } catch {}

  // 3. Library channels from Maisie
  try {
    const res = await fetch(`${MAISIE_URL}/api/library-channels`);
    if (res.ok) {
      const libChannels = (await res.json()) as any[];
      for (const ch of libChannels.filter((c: any) => c.enabled)) {
        newChannels.push({
          number: ch.number,
          name: ch.name,
          type: "library",
        });
      }
    }
  } catch {}

  channels = newChannels;
  console.log(`[lineup] Built: ${getCableChannels().length} cable + ${getCameraChannels().length} camera + ${getLibraryChannels().length} library = ${channels.length} total`);
}

// --- Hono app ---

const app = new Hono();

// HDHomeRun discovery
app.get("/discover.json", (c) => {
  const host = c.req.header("host") || `localhost:${PORT}`;
  const baseUrl = `http://${host}`;
  return c.json({
    FriendlyName: DEVICE_NAME,
    Manufacturer: "Maisie",
    ModelNumber: "HDHR5-4US",
    FirmwareName: "maisie-synthetic-hdhr",
    FirmwareVersion: "3.0.0",
    DeviceID: DEVICE_ID,
    DeviceAuth: "maisie",
    BaseURL: baseUrl,
    LineupURL: `${baseUrl}/lineup.json`,
    TunerCount: TUNER_COUNT,
  });
});

// Unified lineup — cable + cameras
app.get("/lineup.json", (c) => {
  const host = c.req.header("host") || `localhost:${PORT}`;
  const baseUrl = `http://${host}`;

  return c.json(
    channels.map((ch) => {
      let url: string;
      if (ch.type === "cable") {
        url = `${baseUrl}/stream/cable/${ch.number}`;
      } else if (ch.type === "camera") {
        url = `${baseUrl}/stream/camera/${(ch as CameraChannel).streamName}`;
      } else {
        url = `${baseUrl}/stream/library/${ch.number}`;
      }
      return { GuideNumber: ch.number, GuideName: ch.name, URL: url };
    }),
  );
});

app.get("/lineup_status.json", (c) => {
  return c.json({
    ScanInProgress: 0,
    ScanPossible: 1,
    Source: "Cable",
    SourceList: ["Cable"],
  });
});

app.post("/lineup.post", (c) => {
  return c.json({ ScanInProgress: 0 });
});

// --- Stream routing ---

// Camera streams via go2rtc + ffmpeg
app.get("/stream/camera/:name", (c) => {
  const name = c.req.param("name");
  const ch = getCameraChannels().find((cam) => cam.streamName === name);
  if (!ch) return c.body("Camera stream not found", 404);
  return streamCamera(name);
});

// Library streams — continuous MPEG-TS that auto-advances through episodes.
// Uses prefetch pipeline: starts the next episode's ffmpeg before the current one ends.
function streamLibrary(channelNumber: string): Response {
  let cancelled = false;
  const viewerId = Date.now(); // unique per viewer to avoid stream ID collisions

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (chunk: Uint8Array): boolean => {
        try { controller.enqueue(chunk); return true; }
        catch { cancelled = true; return false; }
      };

      const pipeReader = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> => {
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!enqueue(value)) { reader.cancel(); break; }
        }
      };

      // Prefetch state
      let prefetched: {
        reader: ReadableStreamDefaultReader<Uint8Array>;
        abort: AbortController;
        episode: { title: string; seasonNumber: number; episodeNumber: number; durationMs: number };
        remainingMs: number;
      } | null = null;

      while (!cancelled) {
        try {
          let currentReader: ReadableStreamDefaultReader<Uint8Array>;
          let remainingMs: number;

          if (prefetched) {
            // Use the prefetched stream — no API calls needed
            const ep = prefetched.episode;
            remainingMs = prefetched.remainingMs;
            console.log(
              `[library:${channelNumber}] Switching to prefetched: ${ep.title} S${ep.seasonNumber}E${ep.episodeNumber}`,
            );
            currentReader = prefetched.reader;
            prefetched = null;
          } else {
            // Resolve and start fresh
            const npRes = await fetch(
              `${MAISIE_URL}/api/library-channels/${channelNumber}/now-playing`,
            );
            if (!npRes.ok) {
              console.error(`[library:${channelNumber}] Schedule resolution failed: ${npRes.status}`);
              break;
            }
            const np = (await npRes.json()) as {
              episode: { title: string; seasonNumber: number; episodeNumber: number; durationMs: number };
              offsetSeconds: number;
              remainingMs: number;
              streamUrl: string;
            };

            remainingMs = np.remainingMs;
            const remainingSec = Math.floor(remainingMs / 1000);
            console.log(
              `[library:${channelNumber}] Playing: ${np.episode.title} S${np.episode.seasonNumber}E${np.episode.episodeNumber} ` +
              `(offset ${np.offsetSeconds}s, ~${remainingSec}s remaining)`,
            );

            const currentId = `lib-${channelNumber}-${viewerId}`;
            const streamUrl = `${np.streamUrl}&id=${currentId}`;
            const stream = await fetch(streamUrl);
            if (!stream.ok || !stream.body) {
              console.error(`[library:${channelNumber}] Tokyo stream unavailable`);
              break;
            }
            currentReader = stream.body.getReader();
          }

          // Start prefetch for next episode after a short delay
          const prefetchAbort = new AbortController();
          const prefetchTimer = setTimeout(async () => {
            if (cancelled || prefetchAbort.signal.aborted) return;
            try {
              const futureMs = Date.now() + remainingMs + 1000;
              const nextRes = await fetch(
                `${MAISIE_URL}/api/library-channels/${channelNumber}/now-playing?at=${futureMs}`,
              );
              if (!nextRes.ok || cancelled || prefetchAbort.signal.aborted) return;
              const next = (await nextRes.json()) as {
                episode: { title: string; seasonNumber: number; episodeNumber: number; durationMs: number };
                offsetSeconds: number;
                remainingMs: number;
                streamUrl: string;
              };

              if (cancelled || prefetchAbort.signal.aborted) return;

              const nextId = `lib-${channelNumber}-${viewerId}-next`;
              const nextUrl = `${next.streamUrl}&id=${nextId}`;
              console.log(
                `[library:${channelNumber}] Prefetching: ${next.episode.title} S${next.episode.seasonNumber}E${next.episode.episodeNumber}`,
              );

              const nextStream = await fetch(nextUrl, { signal: prefetchAbort.signal });
              if (!nextStream.ok || !nextStream.body || cancelled) return;

              prefetched = {
                reader: nextStream.body.getReader(),
                abort: prefetchAbort,
                episode: next.episode,
                remainingMs: next.remainingMs,
              };
            } catch (err) {
              if (!prefetchAbort.signal.aborted) {
                console.error(`[library:${channelNumber}] Prefetch failed: ${err}`);
              }
            }
          }, 2000);

          // Pipe current episode
          await pipeReader(currentReader);

          clearTimeout(prefetchTimer);
          if (cancelled) break;

          if (!prefetched) {
            prefetchAbort.abort();
            console.log(`[library:${channelNumber}] Episode ended, no prefetch ready — re-resolving`);
          }
          // No sleep — loop immediately
        } catch (err) {
          console.error(`[library:${channelNumber}] Stream error: ${err}`);
          break;
        }
      }

      // Cleanup
      if (prefetched) {
        prefetched.abort.abort();
        try { prefetched.reader.cancel(); } catch {}
        prefetched = null;
      }
      try { controller.close(); } catch {}
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "video/mp2t", Connection: "keep-alive" },
  });
}

app.get("/stream/library/:number", (c) => {
  const num = c.req.param("number");
  const ch = getLibraryChannels().find((l) => l.number === num);
  if (!ch) return c.body("Library channel not found", 404);
  return streamLibrary(num);
});

// Cable streams proxied from PRIME
app.get("/stream/cable/:channel", (c) => {
  const num = c.req.param("channel");
  const ch = getCableChannels().find((cab) => cab.number === num);
  if (!ch) return c.body("Cable channel not found", 404);
  if (!isPrimeAvailable()) return c.body("PRIME tuner unavailable", 503);
  return streamFromPrime(num);
});

// HDHomeRun native tuning — Plex uses /auto/v{channel}
app.get("/auto/:channel", async (c) => {
  const chParam = c.req.param("channel").replace(/^v/, "");
  console.log(`[tune] Request for channel: ${chParam}`);

  const ch = channels.find((l) => l.number === chParam);
  if (!ch) {
    console.log(`[tune] Channel ${chParam} not in lineup`);
    return c.body("Channel not found", 404);
  }

  if (ch.type === "cable") {
    if (!isPrimeAvailable()) return c.body("PRIME tuner unavailable", 503);
    return streamFromPrime(ch.number);
  } else if (ch.type === "camera") {
    return streamCamera((ch as CameraChannel).streamName);
  } else {
    return streamLibrary(ch.number);
  }
});

// --- XMLTV Guide ---

app.get("/xmltv.xml", async (c) => {
  const epgChannels: EpgChannel[] = channels.map((ch) => ({
    number: ch.number,
    name: ch.name,
    type: ch.type as EpgChannel["type"],
    callSign: ch.type === "cable" ? (ch as CableChannel).callSign : undefined,
    streamName: ch.type === "camera" ? (ch as CameraChannel).streamName : undefined,
  }));
  const xml = await generateXmltv(epgChannels);
  return c.body(xml, 200, { "Content-Type": "application/xml" });
});

// --- Management API ---

app.get("/api/lineup", (c) => c.json(channels));
app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    channels: channels.length,
    cable: getCableChannels().length,
    cameras: getCameraChannels().length,
    library: getLibraryChannels().length,
    primeAvailable: isPrimeAvailable(),
  }),
);

// Push camera lineup from Maisie (legacy — triggers full rebuild to include all channel types)
app.post("/api/lineup", async (c) => {
  await buildLineup();
  return c.json({ ok: true, count: channels.length });
});

// Trigger full lineup rebuild
app.post("/api/rebuild", async (c) => {
  await buildLineup();
  return c.json({ ok: true, count: channels.length });
});

// --- Start ---

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch: app.fetch,
  idleTimeout: 255, // max — streams are long-lived
});

// Start PRIME lineup refresh (hourly)
startPrimeRefresh(60 * 60 * 1000);

// Build initial lineup (PRIME + cameras from Maisie)
async function startup() {
  // Wait for PRIME lineup to load (startPrimeRefresh fires immediately)
  await new Promise((r) => setTimeout(r, 3000));
  await buildLineup();

  // Retry until all channel types are present (maisie may still be starting)
  const hasCameras = () => channels.some((c) => c.type === "camera");
  const hasLibrary = () => channels.some((c) => c.type === "library");
  let retries = 0;
  const maxRetries = 10;
  while ((!hasCameras() || !hasLibrary()) && retries < maxRetries) {
    retries++;
    const missing = [!hasCameras() && "cameras", !hasLibrary() && "library"].filter(Boolean).join(" + ");
    console.log(`[startup] Missing ${missing}, retry ${retries}/${maxRetries} in 15s`);
    await new Promise((r) => setTimeout(r, 15000));
    await buildLineup();
  }
  if (!hasCameras() || !hasLibrary()) {
    console.log("[startup] Warning: still missing channels after all retries");
  }
}
startup();

console.log(`📺 synthetic-hdhr listening on port ${PORT}`);
console.log(`   Device: ${DEVICE_NAME} (${DEVICE_ID})`);
console.log(`   PRIME: ${isPrimeConfigured() ? "configured" : "not configured"}`);
console.log(`   XMLTV: http://localhost:${PORT}/xmltv.xml`);
