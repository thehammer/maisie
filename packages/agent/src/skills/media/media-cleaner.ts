/**
 * Media Cleaner — probes, cleans, and transcodes video files in the Plex library.
 *
 * Probe: ffprobe for format/streams/metadata analysis
 * Clean: mkvmerge for fast remux (metadata strip, subtitle embed, format conversion)
 * Transcode: ffmpeg with HEVC encoding (VideoToolbox HW accel on macOS)
 * Scan: batch library analysis for issues
 *
 * All operations are non-destructive — output goes to new files.
 */

import { stat } from "fs/promises";
import { basename, dirname, extname, join } from "path";

// ── Types ────────────────────────────────────────────────────────────

export interface StreamInfo {
  index: number;
  codecType: "video" | "audio" | "subtitle" | "attachment" | string;
  codecName: string;
  codecLongName?: string;
  profile?: string;
  language?: string;
  title?: string;
  isDefault: boolean;
  isForced: boolean;
  // Video-specific
  width?: number;
  height?: number;
  bitRate?: number;
  frameRate?: string;
  pixelFormat?: string;
  // Audio-specific
  channels?: number;
  channelLayout?: string;
  sampleRate?: string;
}

export interface GarbageTag {
  key: string;
  value: string;
}

export interface ExternalSubtitle {
  filePath: string;
  fileName: string;
  language: string;
  forced: boolean;
}

export type Resolution = "2160p" | "1080p" | "720p" | "SD";

export interface MediaProbeResult {
  filePath: string;
  fileName: string;
  format: string;
  container: string;
  duration: number;
  sizeBytes: number;
  sizeGB: number;
  streams: StreamInfo[];
  videoStreams: StreamInfo[];
  audioStreams: StreamInfo[];
  subtitleStreams: StreamInfo[];
  resolution: Resolution;
  width: number;
  height: number;
  garbageTags: GarbageTag[];
  externalSubs: ExternalSubtitle[];
  metadata: Record<string, string>;
}

export interface CleanOptions {
  dryRun?: boolean;
  outputPath?: string;
  keepLanguages?: string[];
  removeAttachments?: boolean;
  embedExternalSubs?: boolean;
  setDefaultAudio?: boolean;
  setDefaultSubtitle?: string;
}

export interface CleanResult {
  filePath: string;
  outputPath: string;
  dryRun: boolean;
  actions: string[];
  converted: boolean;
  metadataStripped: boolean;
  subsEmbedded: number;
  tracksRemoved: number;
  inputSizeBytes: number;
  outputSizeBytes: number;
  durationMs: number;
}

export interface TranscodeOptions {
  dryRun?: boolean;
  outputPath?: string;
  targetResolution?: "1080p" | "720p";
  crf?: number;
  preset?: string;
  hwAccel?: boolean;
}

export interface TranscodeResult {
  filePath: string;
  outputPath: string;
  dryRun: boolean;
  encoder: string;
  targetResolution: string;
  crf: number;
  inputSizeBytes: number;
  outputSizeBytes: number;
  estimatedSizeBytes?: number;
  durationMs: number;
}

export interface FileIssue {
  filePath: string;
  fileName: string;
  sizeGB: number;
  issues: string[];
  resolution: Resolution;
  container: string;
}

export interface LibraryScanResult {
  path: string;
  totalFiles: number;
  scanned: number;
  issues: FileIssue[];
  summary: {
    nonMkv: number;
    garbageMetadata: number;
    externalSubs: number;
    is4K: number;
    overSize: number;
  };
  durationMs: number;
}

// ── Constants ────────────────────────────────────────────────────────

const MEDIA_EXTENSIONS = new Set([
  ".mkv", ".mp4", ".m4v", ".avi", ".wmv", ".flv", ".mov", ".ts", ".webm",
]);

const SUBTITLE_EXTENSIONS = [".srt", ".ass", ".ssa", ".sub", ".idx", ".sup"];

const GARBAGE_TAG_KEYS = new Set([
  "encoder", "encoding_tool", "handler_name", "vendor_id",
  "creation_time", "compatible_brands", "major_brand", "minor_version",
  "comment", "description", "synopsis", "purl", "PURL",
  "ENCODER", "ENCODED_BY", "encoded_by",
  "DATE_RELEASED", "DATE_TAGGED",
  "_STATISTICS_WRITING_APP", "_STATISTICS_WRITING_DATE_UTC", "_STATISTICS_TAGS",
]);

// mkvmerge always writes these — not actionable garbage after a clean.
// Stream-level: _STATISTICS_* tags. Format-level: encoder (libebml).
const MKVMERGE_OWN_TAGS: Record<string, RegExp> = {
  encoder: /^libebml/,
  _STATISTICS_WRITING_APP: /^mkvmerge/,
  _STATISTICS_WRITING_DATE_UTC: /./,
  _STATISTICS_TAGS: /^BPS /,
};

// Scene group pattern: stuff like "YTS", "RARBG", "FGT", etc. in title tag
const SCENE_GROUP_PATTERN = /\b(YTS|YIFY|RARBG|FGT|EVO|SPARKS|AMIABLE|GECKOS|STUTTERSHIT|ION10|FLAME|DRONES|JYK|USURY|NOGRP)\b/i;

const LANGUAGE_MAP: Record<string, string> = {
  eng: "eng", en: "eng", english: "eng",
  spa: "spa", es: "spa", spanish: "spa",
  fre: "fre", fr: "fre", french: "fre",
  ger: "ger", de: "ger", german: "ger",
  ita: "ita", it: "ita", italian: "ita",
  por: "por", pt: "por", portuguese: "por",
  jpn: "jpn", ja: "jpn", japanese: "jpn",
  chi: "chi", zh: "chi", chinese: "chi",
  kor: "kor", ko: "kor", korean: "kor",
  ara: "ara", ar: "ara", arabic: "ara",
  rus: "rus", ru: "rus", russian: "rus",
  hin: "hin", hi: "hin", hindi: "hin",
  und: "und",
};

// ── Helpers ──────────────────────────────────────────────────────────

function classifyResolution(height: number): Resolution {
  if (height >= 2000) return "2160p";
  if (height >= 900) return "1080p";
  if (height >= 600) return "720p";
  return "SD";
}

function inferSubLanguage(fileName: string): { language: string; forced: boolean } {
  const lower = fileName.toLowerCase();
  const forced = lower.includes(".forced") || lower.includes(".forced.");

  // Try to extract language from filename patterns like "movie.en.srt" or "movie.english.srt"
  const parts = lower.replace(/\.(srt|ass|ssa|sub|idx|sup)$/i, "").split(".");
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i].replace("forced", "").trim();
    if (part && LANGUAGE_MAP[part]) {
      return { language: LANGUAGE_MAP[part], forced };
    }
  }

  return { language: "eng", forced };
}

async function runProc(
  cmd: string[],
  options?: { stdin?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: options?.stdin ? "pipe" : undefined,
  });

  if (options?.stdin && proc.stdin) {
    proc.stdin.write(options.stdin);
    proc.stdin.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

// ── 1. Probe ─────────────────────────────────────────────────────────

export async function probeFile(filePath: string): Promise<MediaProbeResult> {
  const { stdout, exitCode } = await runProc([
    "ffprobe",
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  if (exitCode !== 0) {
    throw new Error(`ffprobe failed for ${filePath} (exit ${exitCode})`);
  }

  const probe = JSON.parse(stdout);
  const format = probe.format || {};
  const rawStreams: any[] = probe.streams || [];

  const fileStat = await stat(filePath);
  const sizeBytes = fileStat.size;

  // Parse streams
  const streams: StreamInfo[] = rawStreams.map((s: any) => ({
    index: s.index,
    codecType: s.codec_type,
    codecName: s.codec_name,
    codecLongName: s.codec_long_name,
    profile: s.profile,
    language: s.tags?.language || s.tags?.LANGUAGE,
    title: s.tags?.title || s.tags?.TITLE,
    isDefault: s.disposition?.default === 1,
    isForced: s.disposition?.forced === 1,
    width: s.width,
    height: s.height,
    bitRate: s.bit_rate ? parseInt(s.bit_rate) : undefined,
    frameRate: s.r_frame_rate,
    pixelFormat: s.pix_fmt,
    channels: s.channels,
    channelLayout: s.channel_layout,
    sampleRate: s.sample_rate,
  }));

  const videoStreams = streams.filter((s) => s.codecType === "video");
  const audioStreams = streams.filter((s) => s.codecType === "audio");
  const subtitleStreams = streams.filter((s) => s.codecType === "subtitle");

  const primaryVideo = videoStreams[0];
  const width = primaryVideo?.width || 0;
  const height = primaryVideo?.height || 0;

  // Detect garbage metadata
  const formatTags: Record<string, string> = format.tags || {};
  const garbageTags: GarbageTag[] = [];
  const allMetadata: Record<string, string> = { ...formatTags };

  const isMkvmergeFile = formatTags.encoder?.startsWith("libebml");

  for (const [key, value] of Object.entries(formatTags)) {
    if (GARBAGE_TAG_KEYS.has(key)) {
      // Skip mkvmerge's own unavoidable tags
      const ownPattern = MKVMERGE_OWN_TAGS[key];
      if (ownPattern && ownPattern.test(value)) continue;
      // mkvmerge also sets creation_time to mux time — not actionable
      if (isMkvmergeFile && key === "creation_time") continue;
      garbageTags.push({ key, value });
    }
    if (key === "title" && SCENE_GROUP_PATTERN.test(value)) {
      garbageTags.push({ key: `title (scene group)`, value });
    }
  }

  // Also check stream-level tags
  for (const s of rawStreams) {
    const tags = s.tags || {};
    for (const [key, value] of Object.entries(tags)) {
      if (GARBAGE_TAG_KEYS.has(key) && typeof value === "string") {
        // Skip mkvmerge's own unavoidable tags
        const ownPattern = MKVMERGE_OWN_TAGS[key];
        if (ownPattern && ownPattern.test(value)) continue;
        garbageTags.push({ key: `stream[${s.index}].${key}`, value });
      }
    }
  }

  // Find external subtitles
  const dir = dirname(filePath);
  const base = basename(filePath, extname(filePath));
  const externalSubs: ExternalSubtitle[] = [];

  for (const subExt of SUBTITLE_EXTENSIONS) {
    // Check direct match: movie.srt
    const directPath = join(dir, base + subExt);
    try {
      await stat(directPath);
      const info = inferSubLanguage(base + subExt);
      externalSubs.push({
        filePath: directPath,
        fileName: base + subExt,
        language: info.language,
        forced: info.forced,
      });
    } catch {}

    // Check language-tagged: movie.en.srt, movie.english.srt, etc.
    for (const langCode of Object.keys(LANGUAGE_MAP)) {
      const taggedPath = join(dir, `${base}.${langCode}${subExt}`);
      try {
        await stat(taggedPath);
        const info = inferSubLanguage(`${base}.${langCode}${subExt}`);
        externalSubs.push({
          filePath: taggedPath,
          fileName: `${base}.${langCode}${subExt}`,
          language: info.language,
          forced: info.forced,
        });
      } catch {}

      // Also check forced variant
      const forcedPath = join(dir, `${base}.${langCode}.forced${subExt}`);
      try {
        await stat(forcedPath);
        externalSubs.push({
          filePath: forcedPath,
          fileName: `${base}.${langCode}.forced${subExt}`,
          language: LANGUAGE_MAP[langCode],
          forced: true,
        });
      } catch {}
    }
  }

  return {
    filePath,
    fileName: basename(filePath),
    format: format.format_name || "",
    container: extname(filePath).slice(1).toLowerCase(),
    duration: parseFloat(format.duration || "0"),
    sizeBytes,
    sizeGB: Math.round((sizeBytes / (1024 ** 3)) * 100) / 100,
    streams,
    videoStreams,
    audioStreams,
    subtitleStreams,
    resolution: classifyResolution(height),
    width,
    height,
    garbageTags,
    externalSubs,
    metadata: allMetadata,
  };
}

// ── 2. Clean ─────────────────────────────────────────────────────────

export async function cleanFile(
  filePath: string,
  options: CleanOptions = {},
): Promise<CleanResult> {
  const {
    dryRun = false,
    keepLanguages,
    removeAttachments = true,
    embedExternalSubs = true,
    setDefaultAudio = true,
    setDefaultSubtitle,
  } = options;

  const start = Date.now();
  const probe = await probeFile(filePath);
  const actions: string[] = [];

  const ext = extname(filePath).toLowerCase();
  const outBase = basename(filePath, extname(filePath));
  const outputPath = options.outputPath || join(dirname(filePath), `${outBase}.cleaned.mkv`);

  // Build mkvmerge command
  const cmd: string[] = ["mkvmerge", "-o", outputPath];

  // Strip all metadata
  cmd.push("--no-global-tags", "--no-track-tags");
  actions.push("Strip global and track tags");

  // Clear title
  cmd.push("--title", "");
  actions.push("Clear title metadata");

  // Handle audio track selection
  const audioTracks = probe.audioStreams;
  let audioTrackIds: number[] = [];

  if (keepLanguages && keepLanguages.length > 0) {
    const keepSet = new Set(keepLanguages.map((l) => LANGUAGE_MAP[l] || l));
    audioTrackIds = audioTracks
      .filter((t) => keepSet.has(t.language || "") || !t.language || t.language === "und")
      .map((t) => t.index);

    if (audioTrackIds.length === 0) {
      // Keep all if filtering would remove everything
      audioTrackIds = audioTracks.map((t) => t.index);
    } else if (audioTrackIds.length < audioTracks.length) {
      cmd.push("--audio-tracks", audioTrackIds.join(","));
      actions.push(`Keep audio languages: ${keepLanguages.join(", ")} (removed ${audioTracks.length - audioTrackIds.length} tracks)`);
    }
  }

  // Set default audio track (prefer highest quality English)
  if (setDefaultAudio && audioTracks.length > 1) {
    const englishTracks = audioTracks.filter(
      (t) => !t.language || t.language === "eng" || t.language === "und",
    );
    const candidates = englishTracks.length > 0 ? englishTracks : audioTracks;

    // Sort by channels (most first), then by codec quality
    const codecPriority: Record<string, number> = {
      truehd: 5, dts: 4, "dts-hd": 4, eac3: 3, ac3: 2, aac: 1, mp3: 0,
    };
    const best = [...candidates].sort((a, b) => {
      const chDiff = (b.channels || 2) - (a.channels || 2);
      if (chDiff !== 0) return chDiff;
      return (codecPriority[b.codecName] || 0) - (codecPriority[a.codecName] || 0);
    })[0];

    if (best) {
      // Set all tracks to non-default first, then set the best one
      for (const t of audioTracks) {
        cmd.push("--default-track-flag", `${t.index}:${t.index === best.index ? 1 : 0}`);
      }
      actions.push(`Set default audio: track ${best.index} (${best.codecName}, ${best.channels}ch, ${best.language || "und"})`);
    }
  }

  // Set default subtitle track
  if (setDefaultSubtitle) {
    const subTracks = probe.subtitleStreams;
    const target = subTracks.find(
      (t) => t.language === (LANGUAGE_MAP[setDefaultSubtitle] || setDefaultSubtitle),
    );
    if (target) {
      for (const t of subTracks) {
        cmd.push("--default-track-flag", `${t.index}:${t.index === target.index ? 1 : 0}`);
      }
      actions.push(`Set default subtitle: track ${target.index} (${target.language})`);
    }
  }

  // Remove attachments (fonts, images, etc.)
  if (removeAttachments) {
    const attachments = probe.streams.filter((s) => s.codecType === "attachment");
    if (attachments.length > 0) {
      cmd.push("--no-attachments");
      actions.push(`Remove ${attachments.length} attachments`);
    }
  }

  // Conversion note
  if (ext !== ".mkv") {
    actions.push(`Convert ${ext} → .mkv`);
  }

  // Input file
  cmd.push(filePath);

  // Embed external subtitles
  let subsEmbedded = 0;
  if (embedExternalSubs && probe.externalSubs.length > 0) {
    for (const sub of probe.externalSubs) {
      cmd.push("--language", `0:${sub.language}`);
      if (sub.forced) {
        cmd.push("--forced-display-flag", "0:1");
      }
      cmd.push(sub.filePath);
      subsEmbedded++;
      actions.push(`Embed subtitle: ${sub.fileName} (${sub.language}${sub.forced ? ", forced" : ""})`);
    }
  }

  if (dryRun) {
    return {
      filePath,
      outputPath,
      dryRun: true,
      actions,
      converted: ext !== ".mkv",
      metadataStripped: true,
      subsEmbedded,
      tracksRemoved: audioTracks.length - (audioTrackIds.length || audioTracks.length),
      inputSizeBytes: probe.sizeBytes,
      outputSizeBytes: 0,
      durationMs: Date.now() - start,
    };
  }

  // Execute mkvmerge
  console.log(`[media-cleaner] Running mkvmerge for ${basename(filePath)}...`);
  const { stdout, stderr, exitCode } = await runProc(cmd);

  // mkvmerge exit code 1 = warnings (treat as success), 2 = error
  if (exitCode >= 2) {
    throw new Error(
      `mkvmerge failed (exit ${exitCode}): ${stderr || stdout}`,
    );
  }

  if (exitCode === 1) {
    console.warn(`[media-cleaner] mkvmerge warnings: ${stderr || stdout}`);
  }

  let outputSizeBytes = 0;
  try {
    const outStat = await stat(outputPath);
    outputSizeBytes = outStat.size;
  } catch {}

  return {
    filePath,
    outputPath,
    dryRun: false,
    actions,
    converted: ext !== ".mkv",
    metadataStripped: true,
    subsEmbedded,
    tracksRemoved: audioTracks.length - (audioTrackIds.length || audioTracks.length),
    inputSizeBytes: probe.sizeBytes,
    outputSizeBytes,
    durationMs: Date.now() - start,
  };
}

// ── 3. HEVC Encode (NVENC) ─────────────────────────────────────────

export interface HevcEncodeOptions {
  cq?: number;           // Constant quality (default 24, lower = better quality)
  preset?: string;       // NVENC preset p1-p7 (default p5)
  tempDir?: string;      // SSD temp directory for encoding
  dryRun?: boolean;
}

export interface HevcEncodeResult {
  filePath: string;
  outputPath: string;
  dryRun: boolean;
  inputCodec: string;
  inputSizeBytes: number;
  outputSizeBytes: number;
  spaceSaved: number;
  durationMs: number;
  skipped: boolean;
  skipReason?: string;
}

export async function hevcEncode(
  filePath: string,
  options: HevcEncodeOptions = {},
): Promise<HevcEncodeResult> {
  const {
    cq = 24,
    preset = "p5",
    tempDir,
    dryRun = false,
  } = options;

  const start = Date.now();
  const probe = await probeFile(filePath);
  const primaryVideo = probe.videoStreams[0];

  if (!primaryVideo) {
    return {
      filePath, outputPath: filePath, dryRun, inputCodec: "unknown",
      inputSizeBytes: probe.sizeBytes, outputSizeBytes: probe.sizeBytes,
      spaceSaved: 0, durationMs: Date.now() - start,
      skipped: true, skipReason: "No video stream",
    };
  }

  // Skip if already HEVC
  if (primaryVideo.codecName === "hevc" || primaryVideo.codecName === "h265") {
    return {
      filePath, outputPath: filePath, dryRun, inputCodec: primaryVideo.codecName,
      inputSizeBytes: probe.sizeBytes, outputSizeBytes: probe.sizeBytes,
      spaceSaved: 0, durationMs: Date.now() - start,
      skipped: true, skipReason: "Already HEVC",
    };
  }

  if (dryRun) {
    return {
      filePath, outputPath: filePath, dryRun: true, inputCodec: primaryVideo.codecName,
      inputSizeBytes: probe.sizeBytes, outputSizeBytes: 0,
      spaceSaved: 0, durationMs: Date.now() - start,
      skipped: false,
    };
  }

  const outBase = basename(filePath, extname(filePath));
  const dir = dirname(filePath);

  // Use temp dir (SSD) if provided, otherwise same directory
  const workDir = tempDir || dir;
  const tempOutput = join(workDir, `${outBase}.hevc.mkv`);
  const finalOutput = join(dir, `${outBase}.mkv`);

  // If source is on NAS and we have a temp dir, copy source to SSD first
  let encodingInput = filePath;
  let tempSource: string | null = null;

  if (tempDir && !filePath.startsWith(tempDir)) {
    tempSource = join(tempDir, `${outBase}.source${extname(filePath)}`);
    console.log(`[media-cleaner] Copying source to SSD...`);
    const cpResult = await runProc(["cp", filePath, tempSource]);
    if (cpResult.exitCode !== 0) {
      throw new Error(`Failed to copy source to SSD: ${cpResult.stderr}`);
    }

    // Verify copy size
    const srcStat = await stat(tempSource);
    if (srcStat.size !== probe.sizeBytes) {
      await cleanup(tempSource);
      throw new Error(`Source copy size mismatch (${srcStat.size} != ${probe.sizeBytes})`);
    }
    encodingInput = tempSource;
  }

  // Encode with NVENC — try with subs first, fall back without
  console.log(`[media-cleaner] HEVC encoding ${probe.fileName} (${probe.sizeGB}GB, ${primaryVideo.codecName})...`);

  let ffmpegOk = false;
  const ffmpegBase = [
    "ffmpeg", "-nostdin", "-y", "-hwaccel", "cuda",
    "-i", encodingInput,
    "-c:v", "hevc_nvenc", "-preset", preset, "-cq", String(cq), "-rc", "vbr",
    "-c:a", "copy",
    "-map_metadata", "0",
  ];

  // Try with subtitle copy
  let result = await runProc([
    ...ffmpegBase, "-c:s", "copy",
    "-map", "0:v", "-map", "0:a", "-map", "0:s?",
    tempOutput,
  ]);

  if (result.exitCode === 0) {
    ffmpegOk = true;
  } else {
    // Retry without subtitles
    console.log(`[media-cleaner] Retrying without subtitle copy...`);
    try { await cleanup(tempOutput); } catch {}
    result = await runProc([
      ...ffmpegBase, "-sn",
      "-map", "0:v", "-map", "0:a",
      tempOutput,
    ]);
    if (result.exitCode === 0) {
      ffmpegOk = true;
    }
  }

  if (!ffmpegOk) {
    await cleanup(tempSource, tempOutput);
    throw new Error(`ffmpeg HEVC encode failed: ${result.stderr.slice(-500)}`);
  }

  // Verify output
  const outStat = await stat(tempOutput);
  if (outStat.size === 0) {
    await cleanup(tempSource, tempOutput);
    throw new Error("Output file is empty");
  }

  const outProbe = await probeFile(tempOutput);
  const outVideo = outProbe.videoStreams[0];

  if (!outVideo || outVideo.codecName !== "hevc") {
    await cleanup(tempSource, tempOutput);
    throw new Error(`Output codec is '${outVideo?.codecName}', expected 'hevc'`);
  }

  // Duration check
  const durationDiff = Math.abs(probe.duration - outProbe.duration);
  if (durationDiff > 2) {
    await cleanup(tempSource, tempOutput);
    throw new Error(`Duration mismatch (in=${probe.duration}s, out=${outProbe.duration}s, diff=${durationDiff}s)`);
  }

  // Move output to final location
  if (tempDir) {
    // Copy from SSD to NAS
    console.log(`[media-cleaner] Copying output to NAS (${outProbe.sizeGB}GB)...`);
    const nasNew = `${finalOutput}.new`;
    const cpResult = await runProc(["cp", tempOutput, nasNew]);
    if (cpResult.exitCode !== 0) {
      await cleanup(tempSource, tempOutput, nasNew);
      throw new Error(`Failed to copy output to NAS: ${cpResult.stderr}`);
    }

    // Verify NAS copy
    const nasStat = await stat(nasNew);
    if (nasStat.size !== outStat.size) {
      await cleanup(tempSource, tempOutput, nasNew);
      throw new Error(`NAS copy size mismatch (${nasStat.size} != ${outStat.size})`);
    }

    // Rename original to .old, rename .new to final
    const backupPath = `${filePath}.old`;
    const { rename: fsRename, unlink: fsUnlink } = await import("fs/promises");
    await fsRename(filePath, backupPath);
    await fsRename(nasNew, finalOutput);

    // Clean up SSD temp files and .old backup (verified output is on NAS)
    await cleanup(tempSource, tempOutput);
    try { await fsUnlink(backupPath); } catch {}
  } else {
    // Same filesystem — direct rename
    const backupPath = `${filePath}.old`;
    const { rename: fsRename, unlink: fsUnlink } = await import("fs/promises");
    await fsRename(filePath, backupPath);
    await fsRename(tempOutput, finalOutput);
    try { await fsUnlink(backupPath); } catch {}
  }

  const spaceSaved = probe.sizeBytes - outStat.size;

  return {
    filePath: finalOutput,
    outputPath: finalOutput,
    dryRun: false,
    inputCodec: primaryVideo.codecName,
    inputSizeBytes: probe.sizeBytes,
    outputSizeBytes: outStat.size,
    spaceSaved,
    durationMs: Date.now() - start,
    skipped: false,
  };
}

async function cleanup(...paths: (string | null | undefined)[]) {
  const { unlink: fsUnlink } = await import("fs/promises");
  for (const p of paths) {
    if (p) try { await fsUnlink(p); } catch {}
  }
}

// ── 4. Transcode (resolution change) ─────────────────────────────────

export async function transcodeFile(
  filePath: string,
  options: TranscodeOptions = {},
): Promise<TranscodeResult> {
  const {
    dryRun = false,
    targetResolution = "1080p",
    crf = 22,
    preset = "medium",
    hwAccel = true,
  } = options;

  const start = Date.now();
  const probe = await probeFile(filePath);

  const outBase = basename(filePath, extname(filePath));
  const outputPath = options.outputPath || join(dirname(filePath), `${outBase}.transcoded.mkv`);

  const targetHeight = targetResolution === "1080p" ? 1080 : 720;
  const scaleFilter = `scale=-2:${targetHeight}`;

  // Estimate output size (rough: HEVC at CRF 22 for 1080p ≈ 40-60% of 4K HEVC, or ~25-35% of 4K h264)
  const estimateRatio = targetResolution === "1080p" ? 0.35 : 0.2;
  const estimatedSizeBytes = Math.round(probe.sizeBytes * estimateRatio);

  if (dryRun) {
    return {
      filePath,
      outputPath,
      dryRun: true,
      encoder: hwAccel ? "hevc_videotoolbox" : "libx265",
      targetResolution,
      crf,
      inputSizeBytes: probe.sizeBytes,
      outputSizeBytes: 0,
      estimatedSizeBytes,
      durationMs: Date.now() - start,
    };
  }

  // Try hardware acceleration first, fall back to software
  let encoder = "libx265";
  let encoderArgs: string[];

  if (hwAccel) {
    // Test if VideoToolbox is available
    const testResult = await runProc([
      "ffmpeg", "-hide_banner", "-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1",
      "-c:v", "hevc_videotoolbox", "-f", "null", "-",
    ]);

    if (testResult.exitCode === 0) {
      encoder = "hevc_videotoolbox";
      // VideoToolbox uses -q:v for quality (1-100, lower = better), roughly map CRF
      const quality = Math.min(65, Math.max(30, crf * 2.5));
      encoderArgs = ["-c:v", "hevc_videotoolbox", "-q:v", String(Math.round(quality))];
    } else {
      console.log("[media-cleaner] VideoToolbox unavailable, falling back to libx265");
      encoderArgs = ["-c:v", "libx265", "-crf", String(crf), "-preset", preset];
    }
  } else {
    encoderArgs = ["-c:v", "libx265", "-crf", String(crf), "-preset", preset];
  }

  const cmd = [
    "ffmpeg", "-hide_banner", "-y",
    "-i", filePath,
    ...encoderArgs,
    "-vf", scaleFilter,
    "-c:a", "copy",
    "-c:s", "copy",
    "-map", "0",
    outputPath,
  ];

  console.log(`[media-cleaner] Transcoding ${basename(filePath)} → ${targetResolution} (${encoder})...`);

  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });

  // Log progress from stderr
  const stderrReader = proc.stderr.getReader();
  let stderrText = "";
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      stderrText += chunk;

      // Log progress lines (ffmpeg outputs "frame=... fps=... time=..." to stderr)
      const timeMatch = chunk.match(/time=(\d+:\d+:\d+\.\d+)/);
      if (timeMatch) {
        const speedMatch = chunk.match(/speed=\s*([\d.]+x)/);
        console.log(`[media-cleaner] Progress: ${timeMatch[1]}${speedMatch ? ` (${speedMatch[1]})` : ""}`);
      }
    }
  } catch {}

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`ffmpeg failed (exit ${exitCode}): ${stderrText.slice(-500)}`);
  }

  let outputSizeBytes = 0;
  try {
    const outStat = await stat(outputPath);
    outputSizeBytes = outStat.size;
  } catch {}

  return {
    filePath,
    outputPath,
    dryRun: false,
    encoder,
    targetResolution,
    crf,
    inputSizeBytes: probe.sizeBytes,
    outputSizeBytes,
    durationMs: Date.now() - start,
  };
}

// ── 4. Library Scan ──────────────────────────────────────────────────

export async function scanLibrary(options: {
  path: string;
  sizeThresholdGB?: number;
  maxFiles?: number;
}): Promise<LibraryScanResult> {
  const { path: libraryPath, sizeThresholdGB = 15, maxFiles = 500 } = options;
  const start = Date.now();

  // Find all media files
  const glob = new Bun.Glob("**/*");
  const allFiles: string[] = [];

  for await (const entry of glob.scan({ cwd: libraryPath })) {
    const ext = extname(entry).toLowerCase();
    if (MEDIA_EXTENSIONS.has(ext)) {
      allFiles.push(join(libraryPath, entry));
    }
    if (allFiles.length >= maxFiles) break;
  }

  const totalFiles = allFiles.length;
  const issues: FileIssue[] = [];
  const summary = {
    nonMkv: 0,
    garbageMetadata: 0,
    externalSubs: 0,
    is4K: 0,
    overSize: 0,
  };

  // Process files with limited concurrency
  const concurrency = 5;
  let scanned = 0;

  async function processFile(filePath: string): Promise<void> {
    try {
      const probe = await probeFile(filePath);
      scanned++;

      const fileIssues: string[] = [];

      if (probe.container !== "mkv") {
        fileIssues.push(`Non-MKV container: ${probe.container}`);
        summary.nonMkv++;
      }

      if (probe.garbageTags.length > 0) {
        fileIssues.push(`Garbage metadata: ${probe.garbageTags.length} tags`);
        summary.garbageMetadata++;
      }

      if (probe.externalSubs.length > 0) {
        fileIssues.push(`External subtitles: ${probe.externalSubs.length} files`);
        summary.externalSubs++;
      }

      if (probe.resolution === "2160p") {
        fileIssues.push("4K resolution");
        summary.is4K++;
      }

      if (probe.sizeGB > sizeThresholdGB) {
        fileIssues.push(`Over size threshold: ${probe.sizeGB}GB > ${sizeThresholdGB}GB`);
        summary.overSize++;
      }

      if (fileIssues.length > 0) {
        issues.push({
          filePath: probe.filePath,
          fileName: probe.fileName,
          sizeGB: probe.sizeGB,
          issues: fileIssues,
          resolution: probe.resolution,
          container: probe.container,
        });
      }

      if (scanned % 50 === 0) {
        console.log(`[media-cleaner] Scanned ${scanned}/${totalFiles} files...`);
      }
    } catch (err) {
      console.error(`[media-cleaner] Failed to probe ${filePath}: ${err}`);
    }
  }

  // Process in batches for concurrency control
  for (let i = 0; i < allFiles.length; i += concurrency) {
    const batch = allFiles.slice(i, i + concurrency);
    await Promise.all(batch.map(processFile));
  }

  return {
    path: libraryPath,
    totalFiles,
    scanned,
    issues,
    summary,
    durationMs: Date.now() - start,
  };
}
