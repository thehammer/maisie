import type { createPlexClient } from "./plex-client";
import type { PlexStatus, PlexNowPlaying, PlexRecentlyAdded } from "@maisie/shared";

type Plex = ReturnType<typeof createPlexClient>;

function formatSeasonEpisode(parentIndex?: number, index?: number): string | undefined {
  if (parentIndex == null || index == null) return undefined;
  return `S${String(parentIndex).padStart(2, "0")}E${String(index).padStart(2, "0")}`;
}

export async function getPlexStatus(plex: Plex): Promise<PlexStatus> {
  const serverInfo = await plex.getServerInfo();
  const libraries = await plex.getLibraries();

  // Get counts per library
  for (const lib of libraries) {
    lib.count = await plex.getLibraryCount(lib.key);
  }

  const rawPlaying = await plex.getNowPlaying();
  const rawRecent = await plex.getRecentlyAdded(15);

  const nowPlaying: PlexNowPlaying[] = rawPlaying.map((m) => ({
    title: m.title,
    type: m.type === "episode" ? "episode" : "movie",
    year: m.year,
    seriesTitle: m.grandparentTitle,
    seasonEpisode: formatSeasonEpisode(m.parentIndex, m.index),
    user: m.User.title,
    player: m.Player.title,
    state: (m.Player.state === "playing" ? "playing" : m.Player.state === "paused" ? "paused" : "buffering") as PlexNowPlaying["state"],
    transcoding: !!m.TranscodeSession,
    progress: m.viewOffset,
    duration: m.duration,
    thumb: m.thumb ? `/api/plex/image?path=${encodeURIComponent(m.thumb)}` : undefined,
    art: m.art ? `/api/plex/image?path=${encodeURIComponent(m.art)}` : undefined,
  }));

  const recentlyAdded: PlexRecentlyAdded[] = rawRecent.map((m) => {
    // Plex returns "season" for recently added TV, with show name in parentTitle
    const isTv = m.type === "season" || m.type === "episode";
    return {
      title: m.title,
      type: isTv ? "episode" as const : "movie" as const,
      year: m.year,
      seriesTitle: m.grandparentTitle || m.parentTitle,
      seasonEpisode: isTv ? `S${String(m.index ?? 0).padStart(2, "0")}` : undefined,
      addedAt: new Date(m.addedAt * 1000).toISOString(),
      thumb: m.thumb,
    };
  });

  return {
    name: serverInfo.friendlyName,
    version: serverInfo.version,
    online: true,
    libraries: libraries.map((l) => ({
      id: l.key,
      title: l.title,
      type: l.type,
      count: l.count,
    })),
    nowPlaying,
    recentlyAdded,
    timestamp: new Date().toISOString(),
  };
}
