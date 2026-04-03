interface SonarrConfig {
  host: string
  port: number
  apiKey: string
  urlBase?: string
}

export function createSonarrClient(config: SonarrConfig) {
  const base = config.urlBase || ''
  const baseUrl = `http://${config.host}:${config.port}${base}/api/v3`

  async function request(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'X-Api-Key': config.apiKey,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Sonarr API ${res.status}: ${res.statusText} — ${path} ${body}`)
    }
    return res.json()
  }

  return {
    async getCalendar(startDate?: string, endDate?: string): Promise<any[]> {
      const start = startDate || new Date().toISOString().split('T')[0]
      const end = endDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
      return request(`/calendar?start=${start}&end=${end}&includeSeries=true`)
    },

    async getQueue(): Promise<{ records: any[]; totalRecords: number }> {
      return request('/queue?pageSize=50&includeSeries=true&includeEpisode=true')
    },

    async getSeries(): Promise<any[]> {
      return request('/series')
    },

    async getHealth(): Promise<any[]> {
      return request('/health')
    },

    async getSystemStatus(): Promise<{ version: string; buildTime: string }> {
      return request('/system/status')
    },

    async lookup(term: string): Promise<any[]> {
      return request(`/series/lookup?term=${encodeURIComponent(term)}`)
    },

    async getRootFolders(): Promise<any[]> {
      return request('/rootfolder')
    },

    async getQualityProfiles(): Promise<any[]> {
      return request('/qualityprofile')
    },

    async getLanguageProfiles(): Promise<any[]> {
      return request('/languageprofile')
    },

    async addSeries(series: {
      title: string
      tvdbId: number
      qualityProfileId: number
      rootFolderPath: string
      languageProfileId?: number
      monitored?: boolean
      addOptions?: { searchForMissingEpisodes: boolean }
    }): Promise<any> {
      return request('/series', {
        method: 'POST',
        body: JSON.stringify({
          ...series,
          monitored: series.monitored ?? true,
          addOptions: series.addOptions ?? { searchForMissingEpisodes: true },
        }),
      })
    },
  }
}

export type SonarrClient = ReturnType<typeof createSonarrClient>

let _client: SonarrClient | null = null

export function initSonarrClient(): SonarrClient | null {
  const host = process.env.SONARR_HOST
  const apiKey = process.env.SONARR_API_KEY

  if (!host || !apiKey) return null

  _client = createSonarrClient({
    host,
    port: Number(process.env.SONARR_PORT) || 8989,
    apiKey,
    urlBase: process.env.SONARR_URL_BASE,
  })
  return _client
}

export function getSonarrClient(): SonarrClient | null {
  return _client
}

/** Backward-compatible factory for agent skill code. */
export function createSonarrClientFromEnv(): SonarrClient | null {
  return initSonarrClient()
}
