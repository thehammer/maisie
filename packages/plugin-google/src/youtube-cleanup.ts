import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { GoogleAuth } from "./auth";
import { getLikedVideos, removeLikes, removeSubscriptions } from "./youtube";

// Injected by init — allows the plugin to emit MQTT events via MaisieCore
let _emit: ((topic: string, payload: unknown) => void) | null = null;
export function setEmit(fn: (topic: string, payload: unknown) => void) {
  _emit = fn;
}

const DATA_DIR = join(import.meta.dir, "../../data");
const LIKES_FILE = join(DATA_DIR, "youtube-likes-remaining.json");
const SUBS_FILE = join(DATA_DIR, "youtube-subs-remaining.json");

export interface YouTubeCleanupStatus {
  running: boolean;
  lastRun: string | null;
  lastResult: string | null;
  likesRemaining: number;
  subsRemaining: number;
  likesRemovedTotal: number;
  subsRemovedTotal: number;
  quotaExhausted: boolean;
  nextScheduledRun: string | null;
}

let running = false;
let lastRun: string | null = null;
let lastResult: string | null = null;
let likesRemovedTotal = 0;
let subsRemovedTotal = 0;
let quotaExhausted = false;
let checkInterval: ReturnType<typeof setInterval> | null = null;
let scheduledHour = 3; // 3 AM local time (after midnight PT quota reset)

function loadIds(path: string): { ids: string[]; exists: boolean } {
  if (!existsSync(path)) return { ids: [], exists: false };
  try {
    return { ids: JSON.parse(readFileSync(path, "utf-8")).ids || [], exists: true };
  } catch {
    return { ids: [], exists: true };
  }
}

function saveIds(path: string, ids: string[]) {
  // Write even when empty — an empty file means "done", no file means "never seeded"
  writeFileSync(path, JSON.stringify({ ids }, null, 2));
}

function publishStatus() {
  if (_emit) _emit("home/youtube/cleanup/status", getStatus());
}

export function getStatus(): YouTubeCleanupStatus {
  const likesRemaining = loadIds(LIKES_FILE).ids.length;
  const subsRemaining = loadIds(SUBS_FILE).ids.length;

  // Next scheduled run: today or tomorrow at scheduledHour
  let next: string | null = null;
  if (likesRemaining > 0 || subsRemaining > 0) {
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setHours(scheduledHour, 0, 0, 0);
    if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
    next = nextRun.toISOString();
  }

  return {
    running,
    lastRun,
    lastResult,
    likesRemaining,
    subsRemaining,
    likesRemovedTotal,
    subsRemovedTotal,
    quotaExhausted,
    nextScheduledRun: next,
  };
}

export async function runCleanup(auth: GoogleAuth): Promise<YouTubeCleanupStatus> {
  if (running) return getStatus();
  running = true;
  quotaExhausted = false;
  publishStatus();

  try {
    // --- Likes ---
    const likesData = loadIds(LIKES_FILE);

    // Only fetch fresh likes if never seeded (file doesn't exist).
    // An empty file means we're done — don't re-fetch.
    let likeIds = likesData.ids;
    if (!likesData.exists) {
      try {
        const videos = await getLikedVideos(auth);
        likeIds = videos.map((v) => v.id);
        if (likeIds.length > 0) {
          saveIds(LIKES_FILE, likeIds);
        }
      } catch (err) {
        if (String(err).includes("quotaExceeded")) {
          quotaExhausted = true;
          lastRun = new Date().toISOString();
          lastResult = "Quota exhausted before starting";
          running = false;
          publishStatus();
          return getStatus();
        }
        throw err;
      }
    }

    if (likeIds.length > 0) {
      const result = await removeLikes(auth, likeIds);
      likesRemovedTotal += result.removed;
      saveIds(LIKES_FILE, result.remaining);

      if (result.quotaExhausted) {
        quotaExhausted = true;
        lastRun = new Date().toISOString();
        lastResult = `Removed ${result.removed} likes, quota exhausted — ${result.remaining.length} likes remaining`;
        running = false;
        publishStatus();
        return getStatus();
      }
    }

    // --- Subscriptions ---
    let subIds = loadIds(SUBS_FILE).ids;

    if (subIds.length > 0) {
      const result = await removeSubscriptions(auth, subIds);
      subsRemovedTotal += result.removed;
      saveIds(SUBS_FILE, result.remaining);

      if (result.quotaExhausted) {
        quotaExhausted = true;
        lastRun = new Date().toISOString();
        lastResult = `Likes done! Removed ${result.removed} subs, quota exhausted — ${result.remaining.length} subs remaining`;
        running = false;
        publishStatus();
        return getStatus();
      }
    }

    lastRun = new Date().toISOString();
    const likesLeft = loadIds(LIKES_FILE).ids.length;
    const subsLeft = loadIds(SUBS_FILE).ids.length;
    lastResult = likesLeft === 0 && subsLeft === 0
      ? "Cleanup complete!"
      : `Likes remaining: ${likesLeft}, Subs remaining: ${subsLeft}`;
    running = false;
    publishStatus();
    return getStatus();
  } catch (err) {
    lastRun = new Date().toISOString();
    lastResult = `Error: ${String(err)}`;
    running = false;
    publishStatus();
    return getStatus();
  }
}

/**
 * Initialize the scheduled cleanup runner.
 * Checks every hour; runs at the configured hour if there's work to do.
 */
export function initYouTubeCleanup(auth: GoogleAuth, hour = 3) {
  scheduledHour = hour;

  const likesRemaining = loadIds(LIKES_FILE).ids.length;
  const subsRemaining = loadIds(SUBS_FILE).ids.length;

  if (likesRemaining === 0 && subsRemaining === 0) {
    console.log("  ⚠ YouTube cleanup: nothing queued (seed data/youtube-*-remaining.json to start)");
    return;
  }

  console.log(`  ✓ YouTube cleanup scheduled at ${hour}:00 (${likesRemaining} likes, ${subsRemaining} subs remaining)`);

  // Check every hour
  checkInterval = setInterval(() => {
    const now = new Date();
    const currentHour = now.getHours();

    if (currentHour === scheduledHour && !running) {
      const likes = loadIds(LIKES_FILE).ids.length;
      const subs = loadIds(SUBS_FILE).ids.length;

      if (likes > 0 || subs > 0) {
        console.log(`[youtube-cleanup] Starting scheduled run (${likes} likes, ${subs} subs)`);
        runCleanup(auth).catch((err) => {
          console.error("[youtube-cleanup] Scheduled run error:", err);
        });
      } else {
        console.log("[youtube-cleanup] Nothing left to clean — stopping scheduler");
        if (checkInterval) clearInterval(checkInterval);
      }
    }
  }, 60 * 60 * 1000); // every hour

  publishStatus();
}

/**
 * Add subscription IDs to the removal queue.
 */
export function queueSubscriptionRemovals(ids: string[]) {
  const existing = loadIds(SUBS_FILE).ids;
  const combined = [...new Set([...existing, ...ids])];
  saveIds(SUBS_FILE, combined);
}

/**
 * Add liked video IDs to the removal queue.
 */
export function queueLikeRemovals(ids: string[]) {
  const existing = loadIds(LIKES_FILE).ids;
  const combined = [...new Set([...existing, ...ids])];
  saveIds(LIKES_FILE, combined);
}
