interface ReadarrConfig {
  host: string;
  port: number;
  apiKey: string;
  urlBase?: string;
}

export function createReadarrClient(config: ReadarrConfig) {
  const base = config.urlBase || "";
  const baseUrl = `http://${config.host}:${config.port}${base}/api/v1`;

  async function request(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "X-Api-Key": config.apiKey,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Readarr API ${res.status}: ${res.statusText} — ${path} ${body}`);
    }
    return res.json();
  }

  return {
    async lookup(term: string): Promise<any[]> {
      return request(`/book/lookup?term=${encodeURIComponent(term)}`);
    },

    async getBooks(): Promise<any[]> {
      return request("/book");
    },

    async getRootFolders(): Promise<any[]> {
      return request("/rootfolder");
    },

    async getQualityProfiles(): Promise<any[]> {
      return request("/qualityprofile");
    },

    async getMetadataProfiles(): Promise<any[]> {
      return request("/metadataprofile");
    },

    async addBook(book: {
      foreignBookId: string;
      author: { foreignAuthorId: string };
      title: string;
      qualityProfileId: number;
      metadataProfileId: number;
      rootFolderPath: string;
      monitored?: boolean;
      addOptions?: { searchForNewBook: boolean };
    }): Promise<any> {
      return request("/book", {
        method: "POST",
        body: JSON.stringify({
          ...book,
          monitored: book.monitored ?? true,
          addOptions: book.addOptions ?? { searchForNewBook: true },
        }),
      });
    },

    async getQueue(): Promise<{ records: any[]; totalRecords: number }> {
      return request("/queue?pageSize=50&includeBook=true&includeAuthor=true");
    },

    async getSystemStatus(): Promise<{ version: string }> {
      return request("/system/status");
    },

    // Try to add an author+book by search term so Readarr can match downloads
    // This is best-effort — if metadata is slow/down, it fails silently
    async ensureBookExists(searchTerm: string): Promise<{ added: boolean; error?: string }> {
      try {
        const results = await request(`/book/lookup?term=${encodeURIComponent(searchTerm)}`);
        if (!results || results.length === 0) {
          return { added: false, error: "No results from metadata lookup" };
        }

        // Get first result that has both book and author IDs
        const match = results.find((r: any) => r.foreignBookId && r.author?.foreignAuthorId);
        if (!match) {
          return { added: false, error: "No valid book/author match" };
        }

        // Get root folder and profiles
        const [rootFolders, qualityProfiles, metadataProfiles] = await Promise.all([
          request("/rootfolder"),
          request("/qualityprofile"),
          request("/metadataprofile"),
        ]);

        if (!rootFolders.length || !qualityProfiles.length || !metadataProfiles.length) {
          return { added: false, error: "Readarr missing root folder or profiles" };
        }

        // Add the book (don't trigger a search — we already have the torrent)
        await request("/book", {
          method: "POST",
          body: JSON.stringify({
            foreignBookId: match.foreignBookId,
            author: match.author,
            title: match.title,
            qualityProfileId: qualityProfiles[0].id,
            metadataProfileId: metadataProfiles[0].id,
            rootFolderPath: rootFolders[0].path,
            monitored: true,
            addOptions: { searchForNewBook: false },
          }),
        });

        return { added: true };
      } catch (err: any) {
        return { added: false, error: String(err) };
      }
    },
  };
}

export type ReadarrClient = ReturnType<typeof createReadarrClient>;

export function createReadarrClientFromEnv() {
  const host = process.env.READARR_HOST;
  const apiKey = process.env.READARR_API_KEY;
  if (!host || !apiKey) return null;

  return createReadarrClient({
    host,
    port: Number(process.env.READARR_PORT) || 8787,
    apiKey,
    urlBase: process.env.READARR_URL_BASE || "",
  });
}
