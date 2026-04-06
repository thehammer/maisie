// ffmpeg process management with per-file format detection.

import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const MEDIA_ROOT = process.env.MEDIA_ROOT || "/media";
const HLS_DIR = process.env.HLS_DIR || "/tmp/tokyo-hls";

interface StreamInfo {
  videoCodec: string;
  pixFmt: string;
  width: number;
  height: number;
  frameRate: number;
  audioCodec: string;
  audioChannels: number;
  is10Bit: boolean;
  isHevc: boolean;
}

interface ActiveStream {
  proc: ReturnType<typeof Bun.spawn>;
  file: string;
  startedAt: number;
  channel?: string;
  hlsDir?: string;
}

const activeStreams = new Map<string, ActiveStream>();

mkdirSync(HLS_DIR, { recursive: true });

/**
 * Probe a media file to determine format details.
 */
export function probeFile(fullPath: string): StreamInfo {
  const result = Bun.spawnSync([
    "ffprobe", "-v", "quiet",
    "-print_format", "json",
    "-show_streams",
    fullPath,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`ffprobe failed: ${result.stderr.toString()}`);
  }

  const data = JSON.parse(result.stdout.toString());
  const streams = data.streams || [];

  const video = streams.find((s: any) => s.codec_type === "video");
  const audio = streams.find((s: any) => s.codec_type === "audio");

  if (!video) throw new Error("No video stream found");

  // Parse frame rate — handle fractional like "24000/1001" and bogus like "120/1"
  let frameRate = 24;
  const avg = video.avg_frame_rate || video.r_frame_rate || "24/1";
  const [num, den] = avg.split("/").map(Number);
  if (den && den > 0) {
    const parsed = num / den;
    // Clamp unreasonable rates (telecine artifacts)
    frameRate = parsed > 60 ? 24 : parsed;
  }

  const pixFmt = video.pix_fmt || "yuv420p";
  const is10Bit = pixFmt.includes("10") || pixFmt.includes("p10");

  return {
    videoCodec: video.codec_name,
    pixFmt,
    width: video.width || 1920,
    height: video.height || 1080,
    frameRate,
    audioCodec: audio?.codec_name || "unknown",
    audioChannels: audio?.channels || 2,
    is10Bit,
    isHevc: video.codec_name === "hevc" || video.codec_name === "h265",
  };
}

/**
 * Build ffmpeg args based on probed stream info.
 */
function buildFfmpegArgs(opts: {
  fullPath: string;
  offsetSeconds: number;
  info: StreamInfo;
  outputArgs: string[];
  channel?: string;
  realtime?: boolean;
}): string[] {
  const { fullPath, offsetSeconds, info, outputArgs, channel, realtime } = opts;
  const args = [
    "ffmpeg",
    "-hide_banner",
    "-loglevel", "warning",
    "-nostats",
  ];

  if (realtime) {
    args.push("-re");
  }

  // Seek before input for fast keyframe-level seeking (both HLS and MPEG-TS).
  // This jumps to the nearest keyframe before the offset, giving clean output.
  if (offsetSeconds > 0) {
    args.push("-ss", String(offsetSeconds));
  }

  args.push("-fflags", "+genpts+discardcorrupt", "-i", fullPath);

  // Video encoding
  if (info.isHevc || info.is10Bit) {
    // Must transcode — HEVC/10-bit can't be copied to HLS H.264
    args.push(
      "-pix_fmt", "yuv420p",
      "-c:v", "h264_nvenc", "-preset", "p4", "-cq", "23",
      "-r", String(Math.round(info.frameRate)),
      "-g", String(Math.round(info.frameRate * 2)),
      "-keyint_min", String(Math.round(info.frameRate * 2)),
    );
  } else {
    // H.264 8-bit — can copy video directly
    args.push("-c:v", "copy");
  }

  // Audio encoding
  if (info.audioCodec === "aac") {
    args.push("-c:a", "copy");
  } else {
    args.push("-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2");
  }

  if (channel) {
    args.push("-metadata", `service_provider=Maisie`);
    args.push("-metadata", `service_name=${channel}`);
  }

  args.push(...outputArgs);
  return args;
}

/**
 * Start an HLS stream from a URL input (e.g., HDHR PRIME MPEG-TS).
 * No probe — assumes H.264 + AC3/AAC.
 */
export function startHlsFromUrl(
  url: string,
  id: string,
  channel?: string,
): { hlsDir: string; cleanup: () => void } {
  stopStream(id);

  const streamDir = join(HLS_DIR, id);
  try { rmSync(streamDir, { recursive: true }); } catch {}
  mkdirSync(streamDir, { recursive: true });
  const playlistPath = join(streamDir, "stream.m3u8");

  console.log(`[hls:${id}] Starting URL stream from ${url}`);

  const args = [
    "ffmpeg",
    "-hide_banner",
    "-loglevel", "warning",
    "-nostats",
    "-analyzeduration", "10000000",
    "-probesize", "10000000",
    "-fflags", "+genpts+discardcorrupt+nobuffer",
    "-i", url,
    "-c:v", "copy",
    "-bsf:v", "dump_extra",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-f", "hls",
    "-hls_time", "4",
    "-hls_list_size", "20",
    "-hls_flags", "append_list",
    "-hls_segment_filename", join(streamDir, "seg%05d.ts"),
    playlistPath,
  ];

  const proc = Bun.spawn(args, {
    stdout: "ignore",
    stderr: "pipe",
  });

  (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value).trim();
      if (text) console.error(`[hls:${id}] ${text}`);
    }
  })();

  const stream: ActiveStream = { proc, file: url, startedAt: Date.now(), channel, hlsDir: streamDir };
  activeStreams.set(id, stream);

  proc.exited.then((code) => {
    console.log(`[hls:${id}] ffmpeg exited (code ${code})`);
    if (activeStreams.get(id)?.proc === proc) {
      activeStreams.delete(id);
    }
  });

  return { hlsDir: streamDir, cleanup: () => stopStream(id) };
}

/**
 * Start an HLS stream for a media file.
 */
export function startHlsStream(
  file: string,
  offsetSeconds: number,
  id: string,
  channel?: string,
): { hlsDir: string; cleanup: () => void } {
  const fullPath = `${MEDIA_ROOT}/${file}`;
  if (!existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);

  stopStream(id);

  const streamDir = join(HLS_DIR, id);
  // Clean and recreate — rmSync then mkdirSync to ensure empty dir
  try { rmSync(streamDir, { recursive: true }); } catch {}
  mkdirSync(streamDir, { recursive: true });
  const playlistPath = join(streamDir, "stream.m3u8");

  const info = probeFile(fullPath);
  console.log(`[hls:${id}] Probed: ${info.videoCodec} ${info.width}x${info.height} ${info.pixFmt} ${info.frameRate}fps, audio=${info.audioCodec}`);
  console.log(`[hls:${id}] Strategy: video=${info.isHevc || info.is10Bit ? "nvenc transcode" : "copy"}, audio=${info.audioCodec === "aac" ? "copy" : "transcode"}`);

  const outputArgs = [
    "-f", "hls",
    "-hls_time", "4",
    "-hls_list_size", "20",
    "-hls_flags", "append_list",
    "-hls_segment_filename", join(streamDir, "seg%05d.ts"),
    playlistPath,
  ];

  const args = buildFfmpegArgs({ fullPath, offsetSeconds, info, outputArgs, channel, realtime: true });

  const proc = Bun.spawn(args, {
    stdout: "ignore",
    stderr: "pipe",
  });

  (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value).trim();
      if (text) console.error(`[hls:${id}] ${text}`);
    }
  })();

  const stream: ActiveStream = { proc, file, startedAt: Date.now(), channel, hlsDir: streamDir };
  activeStreams.set(id, stream);

  proc.exited.then((code) => {
    console.log(`[hls:${id}] ffmpeg exited (code ${code})`);
    // Only remove from map if this is still the active stream (not replaced)
    if (activeStreams.get(id)?.proc === proc) {
      activeStreams.delete(id);
    }
    // Never delete the HLS dir here — let startHlsStream handle cleanup
  });

  return { hlsDir: streamDir, cleanup: () => stopStream(id) };
}

/**
 * Start an MPEG-TS pipe stream (for hdhr-protect / Plex).
 */
export function startStream(
  file: string,
  offsetSeconds: number,
  id: string,
  channel?: string,
): { body: ReadableStream; cleanup: () => void } {
  const fullPath = `${MEDIA_ROOT}/${file}`;
  if (!existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);

  stopStream(id);

  const info = probeFile(fullPath);
  console.log(`[stream:${id}] Probed: ${info.videoCodec} ${info.pixFmt} ${info.frameRate}fps`);

  const outputArgs = [
    "-f", "mpegts",
    "-mpegts_flags", "+resend_headers",
    "-flush_packets", "1",
    "pipe:1",
  ];

  console.log(`[stream:${id}] Strategy: video=${(info.isHevc || info.is10Bit) ? "nvenc transcode" : "copy"}, audio=${info.audioCodec === "aac" ? "copy" : "transcode"}`);
  const args = buildFfmpegArgs({ fullPath, offsetSeconds, info, outputArgs, channel, realtime: true });

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value).trim();
      if (text) console.error(`[stream:${id}] ${text}`);
    }
  })();

  const stream: ActiveStream = { proc, file, startedAt: Date.now(), channel };
  activeStreams.set(id, stream);

  proc.exited.then((code) => {
    console.log(`[stream:${id}] ffmpeg exited (code ${code})`);
    if (activeStreams.get(id)?.proc === proc) {
      activeStreams.delete(id);
    }
  });

  return { body: proc.stdout as unknown as ReadableStream, cleanup: () => stopStream(id) };
}

export function stopStream(id: string): boolean {
  const stream = activeStreams.get(id);
  if (!stream) return false;
  activeStreams.delete(id);
  try { stream.proc.kill(); } catch {}
  // Don't delete HLS dir here — startHlsStream handles cleanup before creating new stream
  return true;
}

export function getStreamHlsDir(id: string): string | null {
  return activeStreams.get(id)?.hlsDir ?? null;
}

export function getActiveStreams(): {
  id: string;
  file: string;
  channel?: string;
  uptimeMs: number;
  hls: boolean;
}[] {
  const now = Date.now();
  return Array.from(activeStreams.entries()).map(([id, s]) => ({
    id,
    file: s.file,
    channel: s.channel,
    uptimeMs: now - s.startedAt,
    hls: !!s.hlsDir,
  }));
}

export function checkMediaRoot(): boolean {
  return existsSync(MEDIA_ROOT);
}

export function checkFfmpeg(): boolean {
  try {
    const proc = Bun.spawnSync(["ffmpeg", "-version"]);
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}
