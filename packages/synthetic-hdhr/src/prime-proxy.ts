// Proxies the real HDHomeRun PRIME device — fetches lineup, forwards streams.

const PRIME_HOST = process.env.PRIME_HOST || "";
const PRIME_PORT = Number(process.env.PRIME_PORT) || 80;

export interface PrimeChannel {
  GuideNumber: string;
  GuideName: string;
  URL: string;
  DRM?: number;
}

let primeLineup: PrimeChannel[] = [];
let primeAvailable = false;

export function isPrimeConfigured(): boolean {
  return !!PRIME_HOST;
}

export function isPrimeAvailable(): boolean {
  return primeAvailable;
}

export function getPrimeLineup(): PrimeChannel[] {
  return primeLineup;
}

export async function fetchPrimeLineup(): Promise<PrimeChannel[]> {
  if (!PRIME_HOST) return [];
  try {
    const res = await fetch(`http://${PRIME_HOST}:${PRIME_PORT}/lineup.json`);
    if (!res.ok) throw new Error(`${res.status}`);
    primeLineup = await res.json() as PrimeChannel[];
    primeAvailable = true;
    console.log(`[prime] Loaded ${primeLineup.length} channels from PRIME at ${PRIME_HOST}`);
    return primeLineup;
  } catch (err) {
    console.error(`[prime] Failed to fetch lineup: ${err}`);
    primeAvailable = false;
    return primeLineup; // return stale data if available
  }
}

// Proxy a stream from the real PRIME device.
// PRIME serves MPEG-TS natively — no ffmpeg needed.
export function streamFromPrime(channelNumber: string): Response {
  const url = `http://${PRIME_HOST}:5004/auto/v${channelNumber}`;
  console.log(`[prime] Tuning cable channel ${channelNumber} via ${url}`);

  const proc = Bun.spawn([
    "ffmpeg",
    "-hide_banner",
    "-loglevel", "warning",
    "-nostats",
    "-i", url,
    "-c", "copy",
    "-f", "mpegts",
    "-mpegts_flags", "+resend_headers",
    "-muxdelay", "0",
    "-muxpreload", "0",
    "-flush_packets", "1",
    "pipe:1",
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });

  (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value).trim();
      if (text) console.error(`[prime-ffmpeg] ${text}`);
    }
  })();

  proc.exited.then((code) => {
    console.log(`[prime] Stream ended for channel ${channelNumber} (exit ${code})`);
  });

  return new Response(proc.stdout, {
    headers: {
      "Content-Type": "video/mp2t",
      "Connection": "keep-alive",
    },
  });
}

// Refresh lineup periodically
export function startPrimeRefresh(intervalMs: number = 60 * 60 * 1000) {
  if (!PRIME_HOST) return;
  fetchPrimeLineup();
  setInterval(fetchPrimeLineup, intervalMs);
}
