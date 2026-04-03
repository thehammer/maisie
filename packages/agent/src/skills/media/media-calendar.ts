import type { createRadarrClient } from "./radarr-client";
import type { createSonarrClient } from "./sonarr-client";

type Radarr = ReturnType<typeof createRadarrClient>;
type Sonarr = ReturnType<typeof createSonarrClient>;

export interface CalendarItem {
  title: string;
  type: "movie" | "episode";
  seriesTitle?: string;
  seasonEpisode?: string;
  date: string;
  status: "downloading" | "queued" | "missing" | "available" | "upcoming";
  quality?: string;
  overview?: string;
}

export interface MediaCalendar {
  upcoming: CalendarItem[];
  queue: CalendarItem[];
  timestamp: string;
}

export async function getMediaCalendar(
  radarr: Radarr | null,
  sonarr: Sonarr | null,
): Promise<MediaCalendar> {
  const upcoming: CalendarItem[] = [];
  const queue: CalendarItem[] = [];

  if (radarr) {
    const [calendar, queueData] = await Promise.all([
      radarr.getCalendar(),
      radarr.getQueue(),
    ]);

    for (const movie of calendar) {
      upcoming.push({
        title: movie.title,
        type: "movie",
        date: movie.digitalRelease || movie.physicalRelease || movie.inCinemas || "",
        status: movie.hasFile ? "available" : "upcoming",
        overview: movie.overview?.slice(0, 200),
      });
    }

    for (const item of queueData.records) {
      queue.push({
        title: item.movie?.title || item.title || "Unknown",
        type: "movie",
        date: item.estimatedCompletionTime || "",
        status: item.status === "downloading" ? "downloading" : "queued",
        quality: item.quality?.quality?.name,
      });
    }
  }

  if (sonarr) {
    const [calendar, queueData] = await Promise.all([
      sonarr.getCalendar(),
      sonarr.getQueue(),
    ]);

    for (const ep of calendar) {
      upcoming.push({
        title: ep.title || "TBA",
        type: "episode",
        seriesTitle: ep.series?.title,
        seasonEpisode: `S${String(ep.seasonNumber).padStart(2, "0")}E${String(ep.episodeNumber).padStart(2, "0")}`,
        date: ep.airDateUtc || ep.airDate || "",
        status: ep.hasFile ? "available" : "upcoming",
        overview: ep.overview?.slice(0, 200),
      });
    }

    for (const item of queueData.records) {
      queue.push({
        title: item.episode?.title || "Unknown",
        type: "episode",
        seriesTitle: item.series?.title,
        seasonEpisode: item.episode
          ? `S${String(item.episode.seasonNumber).padStart(2, "0")}E${String(item.episode.episodeNumber).padStart(2, "0")}`
          : undefined,
        date: item.estimatedCompletionTime || "",
        status: item.status === "downloading" ? "downloading" : "queued",
        quality: item.quality?.quality?.name,
      });
    }
  }

  // Sort upcoming by date
  upcoming.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return {
    upcoming,
    queue,
    timestamp: new Date().toISOString(),
  };
}
