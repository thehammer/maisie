interface PlexConfig {
  host: string;
  port: number;
  token: string;
}

export interface PlexEpisode {
  ratingKey: string;
  title: string;
  parentIndex: number; // season number
  index: number; // episode number
  duration: number; // milliseconds
  filePath: string;
  thumb?: string; // episode thumbnail path
}

export interface PlexShow {
  ratingKey: string;
  title: string;
  year?: number;
  leafCount: number; // total episodes
}

export interface PlexPlaylist {
  ratingKey: string;
  title: string;
  playlistType: string;
  leafCount: number;
  duration: number; // milliseconds
}

export interface PlexPlaylistItem {
  ratingKey: string;
  title: string;
  type: string; // "movie" | "episode"
  year?: number;
  duration: number; // milliseconds
  filePath: string;
  // For episodes
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  thumb?: string; // item thumbnail path
}

export function createPlexClient(config: PlexConfig) {
  const baseUrl = `http://${config.host}:${config.port}`;

  async function request(path: string): Promise<any> {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        "X-Plex-Token": config.token,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Plex API ${res.status}: ${res.statusText} — ${path}`);
    }

    return res.json();
  }

  return {
    async getServerInfo(): Promise<{ friendlyName: string; version: string }> {
      const data = await request("/");
      const mc = data.MediaContainer;
      return {
        friendlyName: mc.friendlyName,
        version: mc.version,
      };
    },

    async getLibraries(): Promise<
      { key: string; title: string; type: string; count: number }[]
    > {
      const data = await request("/library/sections");
      return (data.MediaContainer.Directory ?? []).map((d: any) => ({
        key: d.key,
        title: d.title,
        type: d.type,
        count: 0, // populated per-library below
      }));
    },

    async getLibraryCount(key: string): Promise<number> {
      const data = await request(`/library/sections/${key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0`);
      return data.MediaContainer.totalSize ?? 0;
    },

    async getNowPlaying(): Promise<
      {
        title: string;
        type: string;
        year?: number;
        grandparentTitle?: string;
        parentIndex?: number;
        index?: number;
        User: { title: string };
        Player: { title: string; state: string };
        TranscodeSession?: { videoDecision: string };
        viewOffset: number;
        duration: number;
      }[]
    > {
      const data = await request("/status/sessions");
      return data.MediaContainer.Metadata ?? [];
    },

    async getImageUrl(thumbPath: string): Promise<string> {
      return `${baseUrl}${thumbPath}?X-Plex-Token=${config.token}`;
    },

    async proxyImage(thumbPath: string): Promise<Response> {
      const url = `${baseUrl}${thumbPath}?X-Plex-Token=${config.token}`;
      return fetch(url);
    },

    async searchShows(title: string, sectionKey: string): Promise<PlexShow[]> {
      const data = await request(
        `/library/sections/${sectionKey}/all?type=2&title=${encodeURIComponent(title)}`,
      );
      return (data.MediaContainer.Metadata ?? []).map((s: any) => ({
        ratingKey: s.ratingKey,
        title: s.title,
        year: s.year,
        leafCount: s.leafCount ?? 0,
      }));
    },

    async getShowEpisodes(showRatingKey: string): Promise<PlexEpisode[]> {
      const data = await request(`/library/metadata/${showRatingKey}/allLeaves`);
      return (data.MediaContainer.Metadata ?? []).map((ep: any) => ({
        ratingKey: ep.ratingKey,
        title: ep.title,
        parentIndex: ep.parentIndex ?? 0,
        index: ep.index ?? 0,
        duration: ep.duration ?? 0,
        filePath: ep.Media?.[0]?.Part?.[0]?.file ?? "",
        thumb: ep.thumb || undefined,
      }));
    },

    async getEpisodeFilePath(ratingKey: string): Promise<string> {
      const data = await request(`/library/metadata/${ratingKey}`);
      const ep = data.MediaContainer.Metadata?.[0];
      return ep?.Media?.[0]?.Part?.[0]?.file ?? "";
    },

    async getPlaylists(type?: string): Promise<PlexPlaylist[]> {
      const data = await request("/playlists");
      const playlists = (data.MediaContainer.Metadata ?? []) as any[];
      return playlists
        .filter((p: any) => !type || p.playlistType === type)
        .map((p: any) => ({
          ratingKey: p.ratingKey,
          title: p.title,
          playlistType: p.playlistType,
          leafCount: p.leafCount ?? 0,
          duration: p.duration ?? 0,
        }));
    },

    async getPlaylistItems(ratingKey: string): Promise<PlexPlaylistItem[]> {
      const data = await request(`/playlists/${ratingKey}/items`);
      return (data.MediaContainer.Metadata ?? []).map((item: any) => ({
        ratingKey: item.ratingKey,
        title: item.title,
        type: item.type,
        year: item.year,
        duration: item.duration ?? 0,
        filePath: item.Media?.[0]?.Part?.[0]?.file ?? "",
        grandparentTitle: item.grandparentTitle,
        parentIndex: item.parentIndex,
        index: item.index,
        thumb: item.thumb || item.grandparentThumb || undefined,
      }));
    },

    async getRecentlyAdded(count = 20): Promise<
      {
        title: string;
        type: string;
        year?: number;
        grandparentTitle?: string;
        parentTitle?: string;
        parentIndex?: number;
        index?: number;
        addedAt: number;
        thumb?: string;
      }[]
    > {
      const data = await request(`/library/recentlyAdded?X-Plex-Container-Size=${count}`);
      return data.MediaContainer.Metadata ?? [];
    },
  };
}

export function createPlexClientFromEnv() {
  const host = process.env.PLEX_HOST;
  const token = process.env.PLEX_TOKEN;

  if (!host || !token) {
    return null;
  }

  return createPlexClient({
    host,
    port: Number(process.env.PLEX_PORT) || 32400,
    token,
  });
}
