// EPG Service — fetches TV guide data from SiliconDust's free API
// using the HDHomeRun PRIME's DeviceAuth token.
//
// The SiliconDust API returns schedule data for our exact cable lineup.
// Free tier provides ~4 hours of guide data; we refresh every 2 hours.

export interface GuideProgram {
  title: string;
  episodeTitle?: string;
  description?: string;
  startTime: number; // unix seconds
  endTime: number; // unix seconds
  imageUrl?: string;
  seriesId?: string;
  episodeNumber?: string;
  filter?: string[];
}

export interface ChannelGuide {
  number: string;
  name: string;
  imageUrl?: string;
  programs: GuideProgram[];
}

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

const GUIDE_API = "https://ipv4-api.hdhomerun.com/api/guide";
const REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Persist cache to disk so guide data survives restarts
const DATA_DIR = join(process.env.DB_PATH || join(import.meta.dir, "../../../..", "data/maisie.db"), "..");
const CACHE_PATH = join(DATA_DIR, "epg-cache.json");

let guideCache: ChannelGuide[] = [];
let deviceAuth: string | null = null;
let lastFetch = 0;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function saveCache() {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify({ lastFetch, channels: guideCache }));
  } catch (err) {
    console.error(`[epg] Failed to save cache: ${err}`);
  }
}

function loadCache() {
  try {
    if (!existsSync(CACHE_PATH)) return;
    const data = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
    if (data.channels && Array.isArray(data.channels)) {
      // Prune programs older than 12h
      const cutoff = Math.floor(Date.now() / 1000) - 12 * 3600;
      guideCache = data.channels.map((ch: ChannelGuide) => ({
        ...ch,
        programs: ch.programs.filter((p: GuideProgram) => p.endTime > cutoff),
      }));
      lastFetch = data.lastFetch || 0;
      const totalPrograms = guideCache.reduce((n, ch) => n + ch.programs.length, 0);
      console.log(`[epg] Restored cache: ${guideCache.length} channels, ${totalPrograms} programs`);
    }
  } catch (err) {
    console.error(`[epg] Failed to load cache: ${err}`);
  }
}

async function fetchDeviceAuth(primeHost: string): Promise<string | null> {
  try {
    const res = await fetch(`http://${primeHost}/discover.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return (data.DeviceAuth as string) || null;
  } catch (err) {
    console.error(`[epg] Failed to get DeviceAuth: ${err}`);
    return null;
  }
}

async function fetchGuideFromApi(auth: string): Promise<ChannelGuide[]> {
  const res = await fetch(`${GUIDE_API}?DeviceAuth=${encodeURIComponent(auth)}`);
  if (!res.ok) throw new Error(`Guide API returned ${res.status}`);
  const data = (await res.json()) as any[];

  return data.map((ch) => ({
    number: ch.GuideNumber,
    name: ch.GuideName,
    imageUrl: ch.ImageURL || undefined,
    programs: (ch.Guide || []).map((p: any) => ({
      title: p.Title,
      episodeTitle: p.EpisodeTitle || undefined,
      description: p.Synopsis || undefined,
      startTime: p.StartTime,
      endTime: p.EndTime,
      imageUrl: p.ImageURL || undefined,
      seriesId: p.SeriesID || undefined,
      episodeNumber: p.EpisodeNumber || undefined,
      filter: p.Filter || undefined,
    })),
  }));
}

export async function refreshGuide(): Promise<void> {
  const primeHost = process.env.PRIME_HOST;
  if (!primeHost) {
    console.log("[epg] No PRIME_HOST configured, skipping guide fetch");
    return;
  }

  if (!deviceAuth) {
    deviceAuth = await fetchDeviceAuth(primeHost);
    if (!deviceAuth) {
      console.error("[epg] Could not obtain DeviceAuth from PRIME");
      return;
    }
    console.log("[epg] Obtained DeviceAuth from PRIME");
  }

  try {
    const fresh = await fetchGuideFromApi(deviceAuth);
    // Merge: keep existing programs that haven't ended yet, add new ones.
    // This accumulates historical data so the XMLTV covers past programs.
    const cutoff = Math.floor(Date.now() / 1000) - 12 * 3600; // keep up to 12h of history
    const existingMap = new Map(guideCache.map((ch) => [ch.number, ch]));

    guideCache = fresh.map((ch) => {
      const existing = existingMap.get(ch.number);
      if (!existing) return ch;

      // Merge: keep old programs that ended after cutoff and aren't duplicated in fresh data
      const freshStarts = new Set(ch.programs.map((p) => p.startTime));
      const kept = existing.programs.filter(
        (p) => p.endTime > cutoff && !freshStarts.has(p.startTime),
      );
      return {
        ...ch,
        programs: [...kept, ...ch.programs].sort((a, b) => a.startTime - b.startTime),
      };
    });

    lastFetch = Date.now();
    const totalPrograms = guideCache.reduce((n, ch) => n + ch.programs.length, 0);
    console.log(
      `[epg] Loaded guide: ${guideCache.length} channels, ${totalPrograms} programs`,
    );
    saveCache();
  } catch (err) {
    console.error(`[epg] Guide fetch failed: ${err}`);
    // Auth may have expired — clear it so next refresh re-fetches
    deviceAuth = null;
  }
}

export function getGuide(hours = 24): ChannelGuide[] {
  const now = Math.floor(Date.now() / 1000);
  const start = now - 12 * 3600; // include 12h of history
  const end = now + hours * 3600;

  return guideCache.map((ch) => ({
    ...ch,
    programs: ch.programs.filter((p) => p.endTime > start && p.startTime < end),
  }));
}

export function getGuideForChannel(channelNumber: string): GuideProgram[] {
  const ch = guideCache.find((c) => c.number === channelNumber);
  return ch?.programs || [];
}

export function getEpgStatus() {
  return {
    channelCount: guideCache.length,
    programCount: guideCache.reduce((n, ch) => n + ch.programs.length, 0),
    lastFetch: lastFetch ? new Date(lastFetch).toISOString() : null,
    hasAuth: !!deviceAuth,
  };
}

export function initEpgService() {
  console.log("[epg] Initializing EPG service");
  // Restore cached data from disk (survives restarts)
  loadCache();
  // Initial fetch after short delay to let other services start
  setTimeout(refreshGuide, 5000);
  refreshTimer = setInterval(refreshGuide, REFRESH_INTERVAL);
}

export function stopEpgService() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
