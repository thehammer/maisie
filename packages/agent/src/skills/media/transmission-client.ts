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
        // Magnet URIs have no HTTP backing — pass to Transmission as `filename`,
        // which it handles natively (info-hash lookup via DHT/trackers).
        args["filename"] = url;
      } else {
        // HTTP(S) torrent-file URL. Fetch it ourselves and forward as base64
        // metainfo so Transmission doesn't need to reach the URL itself
        // (which may be blocked by the container's VPN routing).
        const torrentRes = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
        if (!torrentRes.ok) {
          throw new Error(`Failed to fetch torrent: ${torrentRes.status} ${torrentRes.statusText}`);
        }
        const torrentBuf = await torrentRes.arrayBuffer();
        args["metainfo"] = Buffer.from(torrentBuf).toString("base64");
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
