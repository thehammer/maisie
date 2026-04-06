interface AbsConfig {
  host: string;
  port: number;
  token: string;
  urlBase?: string;
}

export interface AbsLibraryItem {
  id: string;
  title: string;
  author: string;
}

export function createAudiobookshelfClient(config: AbsConfig) {
  const base = config.urlBase || "";
  const baseUrl = `http://${config.host}:${config.port}${base}`;

  async function request(path: string): Promise<any> {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`ABS API ${res.status}: ${path}`);
    return res.json();
  }

  // Find the first audiobook library ID
  async function getAudiobookLibraryId(): Promise<string | null> {
    const data = await request("/api/libraries");
    const lib = (data.libraries || []).find((l: any) => l.mediaType === "book");
    return lib?.id ?? null;
  }

  function mapItems(results: any[]): AbsLibraryItem[] {
    return results.map((item: any) => {
      const meta = item.media?.metadata || {};
      const rawTitle: string = meta.title || "";
      const author: string = meta.authorName || meta.author || "";
      return { id: item.id, title: rawTitle, author };
    });
  }

  return {
    // Search by query — used for result display
    async search(q: string): Promise<AbsLibraryItem[]> {
      const libId = await getAudiobookLibraryId();
      if (!libId) return [];
      const data = await request(
        `/api/libraries/${libId}/items?search=${encodeURIComponent(q)}&limit=20`,
      );
      return mapItems(data.results || []);
    },

    // Fetch the entire library — used for "in library" cross-referencing
    async getAllItems(): Promise<AbsLibraryItem[]> {
      const libId = await getAudiobookLibraryId();
      if (!libId) return [];
      const all: AbsLibraryItem[] = [];
      let page = 0;
      const limit = 100;
      while (true) {
        const data = await request(
          `/api/libraries/${libId}/items?limit=${limit}&page=${page}`,
        );
        const items = mapItems(data.results || []);
        all.push(...items);
        if (all.length >= (data.total || 0) || items.length < limit) break;
        page++;
      }
      return all;
    },

    async getSystemStatus(): Promise<{ serverVersion: string }> {
      const data = await request("/api/server-settings");
      return { serverVersion: data.serverVersion || "unknown" };
    },
  };
}

export type AudiobookshelfClient = ReturnType<typeof createAudiobookshelfClient>;

export function createAudiobookshelfClientFromEnv(): AudiobookshelfClient | null {
  const host = process.env.ABS_HOST;
  const token = process.env.ABS_TOKEN;
  if (!host || !token) return null;
  return createAudiobookshelfClient({
    host,
    port: Number(process.env.ABS_PORT) || 13378,
    token,
    urlBase: process.env.ABS_URL_BASE || "/audiobookshelf",
  });
}
