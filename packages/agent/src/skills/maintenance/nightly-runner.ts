/**
 * Nightly Maintenance Runner — automated media library cleaning during a
 * configurable overnight window.
 *
 * Responsibilities:
 * 1. Scan Plex movie + TV libraries for files needing cleaning
 * 2. Process files sequentially: convert to MKV, strip metadata, embed subs
 * 3. HEVC encode h264 files via NVENC GPU (if enabled)
 * 4. Update Plex DB paths when extensions change
 * 5. Track progress in SQLite, publish via MQTT
 *
 * Workflow: cleanFile → verify → replace → hevcEncode (if h264) → update Plex DB
 */

import { stat, rename, unlink } from "fs/promises";
import { basename, dirname, extname, join } from "path";
import { eq, desc } from "drizzle-orm";
import { nightlyRuns, nightlyFiles } from "../../services/schema";
import { publish } from "../../services/mqtt";
import { TOPICS } from "@maisie/shared";
import { probeFile, cleanFile } from "../media/media-cleaner";
import type { createDsmClient } from "../synology/dsm-client";
import Database from "bun:sqlite";

// ── Types ────────────────────────────────────────────────────────────

type Db = ReturnType<typeof import("../../services/db").initDb>;
type Dsm = ReturnType<typeof createDsmClient>;

interface NightlyConfig {
  db: Db;
  dsm: Dsm | null;
  windowStart: number;   // hour (0-23), default 23
  windowEnd: number;     // hour (0-23), default 5
  moviePaths: string[];
  tvPaths: string[];
  hevcEnabled?: boolean;
  hevcQueuePath?: string; // Path to write h264 file queue for the HEVC bash script
  plexDbPath?: string;    // Path to Plex SQLite DB for path updates
  plexMediaPrefix?: string;    // Container path prefix (e.g. /media/)
  plexHostPrefix?: string;     // Host path prefix (e.g. /mnt/nas/plex-library/)
}

const MEDIA_EXTENSIONS = new Set([
  ".mkv", ".mp4", ".m4v", ".avi", ".wmv", ".flv", ".mov", ".ts", ".webm",
]);

// ── State ────────────────────────────────────────────────────────────

let config: NightlyConfig | null = null;
let running = false;
let stopping = false;
let currentFile: string | null = null;
let currentRunId: number | null = null;
let totalFiles = 0;
let processedFiles = 0;
let checkInterval: ReturnType<typeof setInterval> | null = null;

// ── Public API ───────────────────────────────────────────────────────

export function initNightly(cfg: NightlyConfig) {
  config = cfg;

  // Check every 60 seconds if we should start/stop
  checkInterval = setInterval(checkWindow, 60_000);

  // Also check immediately
  checkWindow();

  console.log(
    `  ✓ Nightly runner initialized (window: ${cfg.windowStart}:00–${cfg.windowEnd}:00)`,
  );
}

export function stopNightly() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

export async function manualStart(): Promise<{ started: boolean; reason?: string }> {
  if (!config) return { started: false, reason: "Not configured" };
  if (running) return { started: false, reason: "Already running" };

  // Start regardless of window
  await startRun();
  return { started: true };
}

export async function manualStop(): Promise<{ stopped: boolean; reason?: string }> {
  if (!running) return { stopped: false, reason: "Not running" };

  stopping = true;
  console.log("[nightly] Manual stop requested — finishing current file...");
  return { stopped: true };
}

export function getStatus() {
  if (!config) {
    return {
      running: false,
      currentRun: null,
      currentFile: null,
      totalFiles: 0,
      processedFiles: 0,
      windowStart: 23,
      windowEnd: 5,
      inWindow: false,
      recentRuns: [],
    };
  }

  const now = new Date();
  const hour = now.getHours();

  let currentRun = null;
  if (currentRunId) {
    currentRun = config.db
      .select()
      .from(nightlyRuns)
      .where(eq(nightlyRuns.id, currentRunId))
      .get() || null;
  }

  const recentRuns = config.db
    .select()
    .from(nightlyRuns)
    .orderBy(desc(nightlyRuns.id))
    .limit(5)
    .all();

  return {
    running,
    currentRun,
    currentFile: currentFile ? basename(currentFile) : null,
    totalFiles,
    processedFiles,
    windowStart: config.windowStart,
    windowEnd: config.windowEnd,
    inWindow: isInWindow(hour, config.windowStart, config.windowEnd),
    recentRuns,
  };
}

// ── Window logic ─────────────────────────────────────────────────────

function isInWindow(hour: number, start: number, end: number): boolean {
  if (start > end) {
    // Wraps midnight: e.g. 23–5 means 23,0,1,2,3,4
    return hour >= start || hour < end;
  }
  return hour >= start && hour < end;
}

function checkWindow() {
  if (!config) return;

  const now = new Date();
  const hour = now.getHours();
  const inWindow = isInWindow(hour, config.windowStart, config.windowEnd);

  if (inWindow && !running) {
    startRun().catch((err) => {
      console.error("[nightly] Failed to start:", err);
    });
  }

  if (!inWindow && running) {
    console.log("[nightly] Window closed — requesting stop...");
    stopping = true;
  }
}

// ── Run lifecycle ────────────────────────────────────────────────────

async function startRun() {
  if (!config || running) return;

  running = true;
  stopping = false;
  currentFile = null;
  totalFiles = 0;
  processedFiles = 0;

  const { db, dsm, moviePaths, tvPaths } = config;

  console.log("[nightly] Starting maintenance run...");

  // Create run record
  const result = db
    .insert(nightlyRuns)
    .values({
      startedAt: new Date().toISOString(),
      status: "running",
    })
    .returning({ id: nightlyRuns.id })
    .get();

  currentRunId = result.id;
  publishStatus();

  // Radarr container management removed — with 8GB RAM the NAS can keep it running

  // Scan libraries and build work queue
  let moviesScanned = 0;
  let tvScanned = 0;

  for (const moviePath of moviePaths) {
    const count = await scanDirectory(moviePath, currentRunId);
    moviesScanned += count;
  }

  for (const tvPath of tvPaths) {
    const count = await scanDirectory(tvPath, currentRunId);
    tvScanned += count;
  }

  // Update run record with scan counts
  db.update(nightlyRuns)
    .set({ moviesScanned, tvScanned })
    .where(eq(nightlyRuns.id, currentRunId))
    .run();

  // Count pending files for this run
  const pendingFiles = db
    .select()
    .from(nightlyFiles)
    .where(eq(nightlyFiles.status, "pending"))
    .all();

  totalFiles = pendingFiles.length;
  console.log(`[nightly] Scanned ${moviesScanned} movies, ${tvScanned} TV files. ${totalFiles} need cleaning.`);
  publishStatus();

  // Process files sequentially
  await processQueue(db);

  // Finalize
  await finishRun(db);
}

async function scanDirectory(dirPath: string, runId: number): Promise<number> {
  if (!config) return 0;
  const { db } = config;

  let count = 0;
  const glob = new Bun.Glob("**/*");

  for await (const entry of glob.scan({ cwd: dirPath })) {
    if (stopping) break;

    const ext = extname(entry).toLowerCase();
    if (!MEDIA_EXTENSIONS.has(ext)) continue;

    const filePath = join(dirPath, entry);

    // Skip if already processed (idempotent)
    const existing = db
      .select()
      .from(nightlyFiles)
      .where(eq(nightlyFiles.filePath, filePath))
      .get();

    if (existing && (existing.status === "cleaned" || existing.status === "skipped")) {
      continue;
    }

    // Quick probe to see if this file needs work
    try {
      const probe = await probeFile(filePath);

      const videoCodec = probe.videoStreams[0]?.codecName;
      const needsHevc = config?.hevcEnabled && videoCodec === "h264";
      const needsWork =
        probe.container !== "mkv" ||
        probe.garbageTags.length > 0 ||
        probe.externalSubs.length > 0 ||
        needsHevc;

      if (!needsWork) {
        // Mark as skipped — no work needed
        db.insert(nightlyFiles)
          .values({
            filePath,
            status: "skipped",
            originalSizeBytes: probe.sizeBytes,
            processedAt: new Date().toISOString(),
            runId,
          })
          .onConflictDoUpdate({
            target: nightlyFiles.filePath,
            set: { status: "skipped", processedAt: new Date().toISOString(), runId },
          })
          .run();
      } else {
        // Queue for cleaning
        db.insert(nightlyFiles)
          .values({
            filePath,
            status: "pending",
            originalSizeBytes: probe.sizeBytes,
            runId,
          })
          .onConflictDoUpdate({
            target: nightlyFiles.filePath,
            set: { status: "pending", originalSizeBytes: probe.sizeBytes, runId },
          })
          .run();
      }
    } catch (err) {
      console.error(`[nightly] Probe failed for ${entry}: ${err}`);
    }

    count++;
    if (count % 100 === 0) {
      console.log(`[nightly] Scanned ${count} files in ${dirPath}...`);
    }
  }

  return count;
}

async function processQueue(db: Db) {
  while (!stopping) {
    // Fetch next pending file
    const next = db
      .select()
      .from(nightlyFiles)
      .where(eq(nightlyFiles.status, "pending"))
      .limit(1)
      .get();

    if (!next) break; // Queue empty

    currentFile = next.filePath;
    const fileName = basename(next.filePath);

    try {
      console.log(`[nightly] Cleaning ${fileName}...`);

      const result = await cleanFile(next.filePath, {
        embedExternalSubs: true,
        setDefaultAudio: true,
        removeAttachments: true,
      });

      // Verify the output file is valid
      const outputProbe = await probeFile(result.outputPath);
      if (!outputProbe.videoStreams.length) {
        throw new Error("Output file has no video streams — aborting replacement");
      }

      // Replace original with cleaned version
      const originalPath = next.filePath;
      const dir = dirname(originalPath);
      const base = basename(originalPath, extname(originalPath));
      const finalPath = join(dir, `${base}.mkv`);

      // If original is not .mkv, we'll write to a new .mkv path
      // and remove the original non-mkv file
      if (originalPath !== finalPath) {
        await rename(result.outputPath, finalPath);
        try {
          await unlink(originalPath);
        } catch {}
      } else {
        // Same extension — atomic-ish replace
        const backupPath = originalPath + ".bak";
        await rename(originalPath, backupPath);
        await rename(result.outputPath, originalPath);
        try {
          await unlink(backupPath);
        } catch {}
      }

      // Delete external subtitle files that were embedded
      if (result.subsEmbedded > 0) {
        const probe = await probeFile(next.filePath).catch(() => null);
        // Re-probe original location to find subs (they're alongside the original)
        // Actually we already have this info from the clean result
        const originalProbe = await probeFile(finalPath).catch(() => null);
        // Find and delete external subs from the directory
        const subExts = [".srt", ".ass", ".ssa", ".sub", ".idx", ".sup"];
        for (const subExt of subExts) {
          // Try common patterns
          for (const pattern of [
            join(dir, `${base}${subExt}`),
            join(dir, `${base}.en${subExt}`),
            join(dir, `${base}.eng${subExt}`),
            join(dir, `${base}.english${subExt}`),
            join(dir, `${base}.en.forced${subExt}`),
            join(dir, `${base}.eng.forced${subExt}`),
          ]) {
            try {
              await stat(pattern);
              await unlink(pattern);
              console.log(`[nightly] Deleted embedded sub: ${basename(pattern)}`);
            } catch {} // File doesn't exist, that's fine
          }
        }
      }

      // Update Plex DB path if extension changed (e.g. .mp4 → .mkv)
      if (originalPath !== finalPath && config?.plexDbPath) {
        updatePlexDbPath(originalPath, finalPath);
      }

      // Queue for HEVC encoding if enabled and file is h264
      if (config?.hevcEnabled && !stopping && config.hevcQueuePath) {
        const postCleanProbe = await probeFile(finalPath);
        const videoCodec = postCleanProbe.videoStreams[0]?.codecName;

        if (videoCodec === "h264") {
          try {
            const { appendFile } = await import("fs/promises");
            await appendFile(config.hevcQueuePath, `${postCleanProbe.sizeBytes}|${finalPath}\n`);
            console.log(`[nightly] Queued for HEVC: ${basename(finalPath)} (${postCleanProbe.sizeGB}GB)`);
          } catch (err) {
            console.error(`[nightly] Failed to queue for HEVC:`, err);
          }
        }
      }

      // Calculate space saved (from original to final state)
      const finalFilePath = finalPath;
      let cleanedSize = 0;
      try {
        const finalStat = await stat(finalFilePath);
        cleanedSize = finalStat.size;
      } catch {}

      const spaceSaved = (next.originalSizeBytes || 0) - cleanedSize;
      const allActions = [
        ...result.actions,
      ];

      // Update file record
      db.update(nightlyFiles)
        .set({
          status: "cleaned",
          cleanedSizeBytes: cleanedSize,
          actions: JSON.stringify(allActions),
          processedAt: new Date().toISOString(),
          filePath: finalFilePath,
        })
        .where(eq(nightlyFiles.filePath, next.filePath))
        .run();

      // Update run totals
      if (currentRunId) {
        const run = db.select().from(nightlyRuns).where(eq(nightlyRuns.id, currentRunId)).get();
        if (run) {
          db.update(nightlyRuns)
            .set({
              filesCleaned: (run.filesCleaned || 0) + 1,
              spaceRecoveredBytes: (run.spaceRecoveredBytes || 0) + Math.max(0, spaceSaved),
            })
            .where(eq(nightlyRuns.id, currentRunId))
            .run();
        }
      }

      processedFiles++;
      console.log(
        `[nightly] Done ${fileName} (${allActions.length} actions, ` +
        `${spaceSaved > 0 ? `saved ${formatBytes(spaceSaved)}` : "no size change"})`,
      );
    } catch (err) {
      console.error(`[nightly] Error cleaning ${fileName}:`, err);

      db.update(nightlyFiles)
        .set({
          status: "error",
          errorMessage: String(err),
          processedAt: new Date().toISOString(),
        })
        .where(eq(nightlyFiles.filePath, next.filePath))
        .run();

      if (currentRunId) {
        const run = db.select().from(nightlyRuns).where(eq(nightlyRuns.id, currentRunId)).get();
        if (run) {
          db.update(nightlyRuns)
            .set({ filesErrored: (run.filesErrored || 0) + 1 })
            .where(eq(nightlyRuns.id, currentRunId))
            .run();
        }
      }

      processedFiles++;

      // Clean up any leftover .cleaned.mkv file
      try {
        const cleanedPath = next.filePath.replace(/\.[^.]+$/, ".cleaned.mkv");
        await unlink(cleanedPath);
      } catch {}
    }

    // Publish progress every 10 files
    if (processedFiles % 10 === 0) {
      publishStatus();
    }
  }

  currentFile = null;
}

async function finishRun(db: Db) {
  // Update run record
  const finalStatus = stopping ? "stopped" : "completed";
  if (currentRunId) {
    db.update(nightlyRuns)
      .set({
        stoppedAt: new Date().toISOString(),
        status: finalStatus,
      })
      .where(eq(nightlyRuns.id, currentRunId))
      .run();
  }

  console.log(`[nightly] Run ${finalStatus}. Cleaned ${processedFiles} files.`);

  running = false;
  stopping = false;
  currentFile = null;
  currentRunId = null;
  totalFiles = 0;
  processedFiles = 0;

  publishStatus();
}

// ── Helpers ──────────────────────────────────────────────────────────

function publishStatus() {
  try {
    const status = getStatus();
    publish(TOPICS.system.nightly.status, status);
  } catch {}
}

function updatePlexDbPath(oldHostPath: string, newHostPath: string) {
  if (!config?.plexDbPath || !config.plexMediaPrefix || !config.plexHostPrefix) return;

  const oldContainerPath = oldHostPath.replace(config.plexHostPrefix, config.plexMediaPrefix);
  const newContainerPath = newHostPath.replace(config.plexHostPrefix, config.plexMediaPrefix);

  if (oldContainerPath === newContainerPath) return;

  try {
    const plexDb = new Database(config.plexDbPath);
    plexDb.exec("PRAGMA busy_timeout = 5000");
    const stmt = plexDb.prepare(
      "UPDATE media_parts SET file = ? WHERE file = ?",
    );
    const result = stmt.run(newContainerPath, oldContainerPath);
    if (result.changes > 0) {
      console.log(`[nightly] Plex DB: updated path (${result.changes} row(s))`);
    }
    plexDb.close();
  } catch (err) {
    console.error(`[nightly] Plex DB update failed:`, err);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
