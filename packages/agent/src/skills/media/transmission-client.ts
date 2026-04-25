interface TransmissionConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export function createTransmissionClient(config: TransmissionConfig) {
  const baseUrl = `http://${config.host}:${config.port}/transmission/rpc`;
  let sessionId = "";

  async function rpc(method: string, args?: Record<string, any>): Promise<any> {
    const body = JSON.stringify({ method, arguments: args });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Transmission-Session-Id": sessionId,
    };
    if (config.username) {
      headers["Authorization"] = "Basic " + btoa(`${config.username}:${config.password || ""}`);
    }

    let res = await fetch(baseUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(30_000) });

    // 409 = CSRF token refresh needed
    if (res.status === 409) {
      sessionId = res.headers.get("X-Transmission-Session-Id") || "";
      headers["X-Transmission-Session-Id"] = sessionId;
      res = await fetch(baseUrl, { method: "POST", headers, body, signal: AbortSignal.timeout(30_000) });
    }

    if (!res.ok) {
      throw new Error(`Transmission RPC ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (data.result !== "success") {
      throw new Error(`Transmission RPC error: ${data.result}`);
    }
    return data.arguments;
  }

  return {
    async addTorrentUrl(url: string, downloadDir?: string): Promise<{ id: number; name: string }> {
      const args: Record<string, any> = {};
      if (downloadDir) args["download-dir"] = downloadDir;

      if (url.startsWith("magnet:")) {
        // Magnet URI — pass directly to Transmission as `filename`.
        args["filename"] = url;
      } else {
        // HTTP(S) URL. Many Prowlarr/indexer proxy URLs 301-redirect to a
        // magnet: URI in the Location header — Bun's fetch can't follow
        // those because magnet: isn't an HTTP scheme. Walk redirects
        // manually and hand a magnet to Transmission as soon as we see one.
        let current = url;
        let res: Response | null = null;
        for (let hop = 0; hop < 5; hop++) {
          res = await fetch(current, { signal: AbortSignal.timeout(30_000), redirect: "manual" });
          if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get("location");
            if (!loc) break;
            if (loc.startsWith("magnet:")) {
              args["filename"] = loc;
              break;
            }
            current = new URL(loc, current).toString();
            continue;
          }
          break;
        }

        if (!args["filename"]) {
          if (!res || !res.ok) {
            throw new Error(`Failed to fetch torrent: ${res?.status ?? "?"} ${res?.statusText ?? "no response"}`);
          }
          // Real torrent file — base64-encode and forward as metainfo so
          // Transmission doesn't need to reach the URL itself (which may be
          // blocked by the container's VPN routing).
          const torrentBuf = await res.arrayBuffer();
          args["metainfo"] = Buffer.from(torrentBuf).toString("base64");
        }
      }

      const result = await rpc("torrent-add", args);
      const added = result["torrent-added"] || result["torrent-duplicate"];
      return { id: added?.id || 0, name: added?.name || "Unknown" };
    },

    async test(): Promise<boolean> {
      try {
        await rpc("session-get");
        return true;
      } catch {
        return false;
      }
    },
  };
}

export type TransmissionClient = ReturnType<typeof createTransmissionClient>;

export function createTransmissionClientFromEnv() {
  const host = process.env.TRANSMISSION_HOST;
  if (!host) return null;

  return createTransmissionClient({
    host,
    port: Number(process.env.TRANSMISSION_PORT) || 9091,
    username: process.env.TRANSMISSION_USERNAME,
    password: process.env.TRANSMISSION_PASSWORD,
  });
}
