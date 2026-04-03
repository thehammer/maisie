interface ProwlarrConfig {
  host: string;
  port: number;
  apiKey: string;
  urlBase?: string;
}

export interface ProwlarrResult {
  guid: string;
  title: string;
  size: number;
  seeders: number;
  leechers: number;
  indexer: string;
  downloadUrl: string;
  infoUrl: string;
  publishDate: string;
  categories: { id: number; name: string }[];
}

export function createProwlarrClient(config: ProwlarrConfig) {
  const base = config.urlBase || "";
  const baseUrl = `http://${config.host}:${config.port}${base}/api/v1`;

  async function request(path: string): Promise<any> {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { "X-Api-Key": config.apiKey },
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Prowlarr API ${res.status}: ${res.statusText} — ${path} ${body}`);
    }
    return res.json();
  }

  return {
    async searchAudiobooks(query: string): Promise<ProwlarrResult[]> {
      // Category 3030 = Audio/Audiobook
      // Only query 1337x (id:1) for speed — it has the best audiobook selection
      const q = query.toLowerCase().includes("audiobook") ? query : `${query} audiobook`;
      const results = await request(
        `/search?query=${encodeURIComponent(q)}&categories=3030&type=search&limit=20&indexerIds=1`
      );
      return results;
    },
  };
}

export type ProwlarrClient = ReturnType<typeof createProwlarrClient>;

export function createProwlarrClientFromEnv() {
  const host = process.env.PROWLARR_HOST;
  const apiKey = process.env.PROWLARR_API_KEY;
  if (!host || !apiKey) return null;

  return createProwlarrClient({
    host,
    port: Number(process.env.PROWLARR_PORT) || 9696,
    apiKey,
    urlBase: process.env.PROWLARR_URL_BASE || "",
  });
}
