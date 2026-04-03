import { eq } from "drizzle-orm";
import { libraryChannels } from "../../services/schema";

type Db = ReturnType<typeof import("../../services/db").initDb>;

export interface LibraryChannelConfig {
  type: "show" | "playlist";
  title: string;
  librarySection?: string;
  showRatingKey?: string;
  playlistRatingKey?: string;
  episodeDuration?: number; // average ms, used for schedule calc
  shuffle?: boolean;
  seed?: number;
}

export interface LibraryChannel {
  number: string;
  name: string;
  mode: string;
  content: LibraryChannelConfig;
  enabled: boolean;
  iconUrl: string | null;
  createdAt: string;
}

export function listLibraryChannels(db: Db): LibraryChannel[] {
  return db
    .select()
    .from(libraryChannels)
    .all()
    .map(deserialize);
}

export function getLibraryChannel(db: Db, number: string): LibraryChannel | null {
  const row = db
    .select()
    .from(libraryChannels)
    .where(eq(libraryChannels.number, number))
    .get();
  return row ? deserialize(row) : null;
}

export function createLibraryChannel(
  db: Db,
  channel: { number: string; name: string; mode: string; content: LibraryChannelConfig },
): LibraryChannel {
  const now = new Date().toISOString();
  db.insert(libraryChannels)
    .values({
      number: channel.number,
      name: channel.name,
      mode: channel.mode,
      content: JSON.stringify(channel.content),
      enabled: 1,
      createdAt: now,
    })
    .run();
  return { ...channel, enabled: true, iconUrl: null, createdAt: now, content: channel.content };
}

export function updateLibraryChannel(
  db: Db,
  number: string,
  updates: Partial<{ name: string; mode: string; content: LibraryChannelConfig; iconUrl: string | null }>,
): boolean {
  const existing = db
    .select()
    .from(libraryChannels)
    .where(eq(libraryChannels.number, number))
    .get();
  if (!existing) return false;

  const values: Record<string, any> = {};
  if (updates.name !== undefined) values.name = updates.name;
  if (updates.mode !== undefined) values.mode = updates.mode;
  if (updates.content !== undefined) values.content = JSON.stringify(updates.content);
  if (updates.iconUrl !== undefined) values.iconUrl = updates.iconUrl;

  if (Object.keys(values).length === 0) return false;

  db.update(libraryChannels)
    .set(values)
    .where(eq(libraryChannels.number, number))
    .run();
  return true;
}

export function renumberLibraryChannel(db: Db, oldNumber: string, newNumber: string): boolean {
  const existing = db
    .select()
    .from(libraryChannels)
    .where(eq(libraryChannels.number, oldNumber))
    .get();
  if (!existing) return false;

  // Check new number isn't taken
  const conflict = db
    .select()
    .from(libraryChannels)
    .where(eq(libraryChannels.number, newNumber))
    .get();
  if (conflict) return false;

  db.insert(libraryChannels)
    .values({ ...existing, number: newNumber })
    .run();
  db.delete(libraryChannels)
    .where(eq(libraryChannels.number, oldNumber))
    .run();
  return true;
}

export function deleteLibraryChannel(db: Db, number: string): boolean {
  const existing = db
    .select()
    .from(libraryChannels)
    .where(eq(libraryChannels.number, number))
    .get();
  if (!existing) return false;

  db.delete(libraryChannels)
    .where(eq(libraryChannels.number, number))
    .run();
  return true;
}

export function toggleLibraryChannel(db: Db, number: string): boolean {
  const row = db
    .select()
    .from(libraryChannels)
    .where(eq(libraryChannels.number, number))
    .get();
  if (!row) return false;

  db.update(libraryChannels)
    .set({ enabled: row.enabled ? 0 : 1 })
    .where(eq(libraryChannels.number, number))
    .run();
  return true;
}

// --- Schedule resolution ---

export interface ScheduleEpisode {
  title: string;
  showTitle?: string; // for playlist TV episodes: the parent show name
  seasonNumber: number;
  episodeNumber: number;
  durationMs: number;
  filePath: string;
  thumb?: string;
}

export interface NowPlayingResult {
  episode: ScheduleEpisode;
  offsetSeconds: number;
  remainingMs: number;
  streamUrl: string;
}

/**
 * Resolve what a library channel should be playing right now.
 * Uses deterministic schedule: position = currentTime % totalDuration.
 */
export function resolveNowPlaying(
  episodes: ScheduleEpisode[],
  mode: string,
  seed: number,
  tokyoBaseUrl: string,
  channelNumber: string,
  atMs?: number,
): NowPlayingResult {
  if (episodes.length === 0) throw new Error("No episodes available");

  const now = atMs ?? Date.now();
  const ordered = mode === "shuffle"
    ? deterministicShuffle(episodes, Math.floor(now / 86400000) + seed)
    : episodes;

  const totalMs = ordered.reduce((sum, ep) => sum + ep.durationMs, 0);
  if (totalMs <= 0) throw new Error("Total duration is zero");

  const positionMs = ((now % totalMs) + totalMs) % totalMs;

  let accumulated = 0;
  for (const episode of ordered) {
    if (accumulated + episode.durationMs > positionMs) {
      const offsetMs = positionMs - accumulated;
      const offsetSeconds = Math.floor(offsetMs / 1000);
      const remainingMs = episode.durationMs - offsetMs;
      const streamUrl = `${tokyoBaseUrl}/stream?file=${encodeURIComponent(episode.filePath)}&offset=${offsetSeconds}&channel=${encodeURIComponent(channelNumber)}`;
      return { episode, offsetSeconds, remainingMs, streamUrl };
    }
    accumulated += episode.durationMs;
  }

  // Fallback
  const ep = ordered[ordered.length - 1];
  const streamUrl = `${tokyoBaseUrl}/stream?file=${encodeURIComponent(ep.filePath)}&offset=0&channel=${encodeURIComponent(channelNumber)}`;
  return { episode: ep, offsetSeconds: 0, remainingMs: ep.durationMs, streamUrl };
}

function deterministicShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// --- Schedule generation ---

export interface ScheduleEntry {
  title: string;
  showTitle?: string;
  episodeTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  startTime: number; // unix seconds
  endTime: number; // unix seconds
  imageUrl?: string;
}

/**
 * Generate a continuous episode schedule for a time window.
 * Uses the same deterministic loop as resolveNowPlaying:
 *   position = time % totalDuration
 * Episodes play sequentially and loop forever.
 */
export function generateSchedule(
  episodes: ScheduleEpisode[],
  mode: string,
  seed: number,
  startTime: Date,
  endTime: Date,
): ScheduleEntry[] {
  if (episodes.length === 0) return [];

  const ordered = mode === "shuffle"
    ? deterministicShuffle(episodes, Math.floor(startTime.getTime() / 86400000) + seed)
    : episodes;

  const totalMs = ordered.reduce((sum, ep) => sum + ep.durationMs, 0);
  if (totalMs <= 0) return [];

  const windowStartMs = startTime.getTime();
  const windowEndMs = endTime.getTime();

  // Find where in the cycle the window starts
  const cyclePositionMs = ((windowStartMs % totalMs) + totalMs) % totalMs;

  // Walk backwards from cyclePositionMs to find the start of the current episode
  let accumulated = 0;
  let startIndex = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (accumulated + ordered[i].durationMs > cyclePositionMs) {
      startIndex = i;
      break;
    }
    accumulated += ordered[i].durationMs;
  }

  // The absolute start time of the current episode
  let currentTimeMs = windowStartMs - (cyclePositionMs - accumulated);

  const schedule: ScheduleEntry[] = [];
  let idx = startIndex;

  while (currentTimeMs < windowEndMs) {
    const ep = ordered[idx % ordered.length];
    const epStartMs = currentTimeMs;
    const epEndMs = currentTimeMs + ep.durationMs;

    // Only include if the episode overlaps the window
    if (epEndMs > windowStartMs) {
      const isMovie = ep.seasonNumber === 0 && ep.episodeNumber === 0;
      schedule.push({
        title: ep.title,
        showTitle: ep.showTitle || undefined,
        episodeTitle: isMovie
          ? ep.title
          : `S${String(ep.seasonNumber).padStart(2, "0")}E${String(ep.episodeNumber).padStart(2, "0")}`,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        startTime: Math.floor(epStartMs / 1000),
        endTime: Math.floor(epEndMs / 1000),
        imageUrl: ep.thumb || undefined,
      });
    }

    currentTimeMs = epEndMs;
    idx++;

    // Safety: if we've gone around the full episode list many times, stop
    if (schedule.length > 5000) break;
  }

  return schedule;
}

// --- Serialization ---

function deserialize(row: typeof libraryChannels.$inferSelect): LibraryChannel {
  return {
    number: row.number,
    name: row.name,
    mode: row.mode,
    content: JSON.parse(row.content) as LibraryChannelConfig,
    enabled: !!row.enabled,
    iconUrl: row.iconUrl || null,
    createdAt: row.createdAt,
  };
}
