interface RadarrConfig {
  host: string;
  port: number;
  apiKey: string;
  urlBase?: string;
}

export function createRadarrClient(config: RadarrConfig) {
  const base = config.urlBase || "";
  const baseUrl = `http://${config.host}:${config.port}${base}/api/v3`;

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
      throw new Error(`Radarr API ${res.status}: ${res.statusText} — ${path} ${body}`);
    }
    return res.json();
  }

  return {
    async getCalendar(startDate?: string, endDate?: string): Promise<any[]> {
      const start = startDate || new Date().toISOString().split("T")[0];
      const end = endDate || new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
      return request(`/calendar?start=${start}&end=${end}`);
    },

    async getQueue(): Promise<{ records: any[]; totalRecords: number }> {
      return request("/queue?pageSize=50&includeMovie=true");
    },

    async getMovies(): Promise<any[]> {
      return request("/movie");
    },

    async getHealth(): Promise<any[]> {
      return request("/health");
    },

    async getSystemStatus(): Promise<{ version: string; buildTime: string }> {
      return request("/system/status");
    },

    async lookup(term: string): Promise<any[]> {
      return request(`/movie/lookup?term=${encodeURIComponent(term)}`);
    },

    async getRootFolders(): Promise<any[]> {
      return request("/rootfolder");
    },

    async getQualityProfiles(): Promise<any[]> {
      return request("/qualityprofile");
    },

    async addMovie(movie: {
      title: string;
      tmdbId: number;
      year: number;
      qualityProfileId: number;
      rootFolderPath: string;
      monitored?: boolean;
      addOptions?: { searchForMovie: boolean };
    }): Promise<any> {
      return request("/movie", {
        method: "POST",
        body: JSON.stringify({
          ...movie,
          monitored: movie.monitored ?? true,
          addOptions: movie.addOptions ?? { searchForMovie: true },
        }),
      });
    },
  };
}

export function createRadarrClientFromEnv() {
  const host = process.env.RADARR_HOST;
  const apiKey = process.env.RADARR_API_KEY;

  if (!host || !apiKey) return null;

  return createRadarrClient({
    host,
    port: Number(process.env.RADARR_PORT) || 7878,
    apiKey,
    urlBase: process.env.RADARR_URL_BASE,
  });
}
