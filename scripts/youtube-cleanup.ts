/**
 * YouTube Cleanup Script
 *
 * Removes liked videos and subscriptions in quota-aware batches.
 * Run daily until cleanup is complete — stops gracefully when quota runs out.
 *
 * Usage: bun run scripts/youtube-cleanup.ts
 *
 * State files in data/:
 *   youtube-likes-remaining.json   - { ids: string[] }
 *   youtube-subs-remaining.json    - { ids: string[] }
 *
 * These files are updated after each run with whatever's left.
 */

import { config } from "dotenv";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";

config({ path: join(import.meta.dir, "..", ".env") });

import { createGoogleAuthFromEnv } from "../packages/agent/src/skills/google/google-auth";
import { removeLikes, removeLike, getLikedVideos, removeSubscriptions } from "../packages/agent/src/skills/google/youtube";

const DATA_DIR = join(import.meta.dir, "..", "data");
const LIKES_FILE = join(DATA_DIR, "youtube-likes-remaining.json");
const SUBS_FILE = join(DATA_DIR, "youtube-subs-remaining.json");

function loadIds(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")).ids || [];
  } catch {
    return [];
  }
}

function saveIds(path: string, ids: string[]) {
  if (ids.length === 0) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  writeFileSync(path, JSON.stringify({ ids }, null, 2));
}

async function main() {
  const auth = createGoogleAuthFromEnv();
  if (!auth) {
    console.error("Google not configured (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in .env)");
    process.exit(1);
  }
  if (!auth.isAuthorized()) {
    console.error("Not authorized — visit http://localhost:3001/api/google/auth first");
    process.exit(1);
  }

  // --- Likes ---
  let likeIds = loadIds(LIKES_FILE);
  if (likeIds.length === 0) {
    // If no saved state, fetch current likes
    console.log("No saved likes state — fetching current liked videos...");
    try {
      const videos = await getLikedVideos(auth);
      likeIds = videos.map((v) => v.id);
      console.log(`  Found ${likeIds.length} liked videos`);
    } catch (err) {
      if (String(err).includes("quotaExceeded")) {
        console.log("  Quota already exhausted — try again tomorrow");
        process.exit(0);
      }
      throw err;
    }
  }

  if (likeIds.length > 0) {
    console.log(`\nRemoving ${likeIds.length} likes...`);
    const result = await removeLikes(auth, likeIds);
    console.log(`  Removed: ${result.removed}`);
    if (result.errors.length > 0) console.log(`  Errors (non-quota): ${result.errors.length}`);

    // Save whatever's left
    saveIds(LIKES_FILE, result.remaining);

    if (result.quotaExhausted) {
      console.log(`  Quota exhausted — ${result.remaining.length} likes remaining for next run`);
      // Save subs state too if we haven't started them
      process.exit(0);
    }

    if (result.remaining.length === 0) {
      console.log("  All likes cleared!");
    }
  } else {
    console.log("No likes to remove.");
  }

  // --- Subscriptions ---
  let subIds = loadIds(SUBS_FILE);
  if (subIds.length > 0) {
    console.log(`\nRemoving ${subIds.length} subscriptions...`);
    const result = await removeSubscriptions(auth, subIds);
    console.log(`  Removed: ${result.removed}`);
    if (result.errors.length > 0) console.log(`  Errors (non-quota): ${result.errors.length}`);

    saveIds(SUBS_FILE, result.remaining);

    if (result.quotaExhausted) {
      console.log(`  Quota exhausted — ${result.remaining.length} subs remaining for next run`);
      process.exit(0);
    }

    if (result.remaining.length === 0) {
      console.log("  All subscriptions cleared!");
    }
  } else {
    console.log("No subscriptions to remove.");
  }

  console.log("\nCleanup complete!");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
