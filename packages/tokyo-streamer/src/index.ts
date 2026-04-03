import { Hono } from "hono";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { startStream, startHlsStream, startHlsFromUrl, stopStream, getStreamHlsDir, getActiveStreams, checkMediaRoot, checkFfmpeg } from "./stream";

const PORT = Number(process.env.PORT) || 5050;

const app = new Hono();

// Start an HLS stream and return the playlist URL
// POST /hls?file={path}&offset={seconds}&id={streamId}&channel={name}
app.post("/hls", (c) => {
  const file = c.req.query("file");
  const offset = Number(c.req.query("offset") || "0");
  const id = c.req.query("id") || `hls-${Date.now()}`;
  const channel = c.req.query("channel");

  if (!file) return c.json({ error: "file parameter required" }, 400);

  try {
    startHlsStream(file, offset, id, channel || undefined);
    return c.json({ id, playlist: `/hls/${id}/stream.m3u8` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) return c.json({ error: msg }, 404);
    return c.json({ error: msg }, 500);
  }
});

// Start an HLS stream from a URL (e.g., HDHR PRIME cable stream)
// POST /hls/url?url={url}&id={streamId}&channel={name}
app.post("/hls/url", (c) => {
  const url = c.req.query("url");
  const id = c.req.query("id") || `hls-${Date.now()}`;
  const channel = c.req.query("channel");

  if (!url) return c.json({ error: "url parameter required" }, 400);

  try {
    startHlsFromUrl(url, id, channel || undefined);
    return c.json({ id, playlist: `/hls/${id}/stream.m3u8` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// Serve HLS playlist and segments
app.get("/hls/:id/:file", (c) => {
  const id = c.req.param("id");
  const file = c.req.param("file");
  const hlsDir = getStreamHlsDir(id);

  if (!hlsDir) return c.body("Stream not found", 404);

  const filePath = join(hlsDir, file);
  if (!existsSync(filePath)) return c.body("File not found", 404);

  const content = readFileSync(filePath);
  const contentType = file.endsWith(".m3u8")
    ? "application/vnd.apple.mpegurl"
    : "video/mp2t";

  return new Response(content, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

// Stream a media file as MPEG-TS (for hdhr-protect / Plex)
app.get("/stream", (c) => {
  const file = c.req.query("file");
  const offset = Number(c.req.query("offset") || "0");
  const id = c.req.query("id") || `stream-${Date.now()}`;
  const channel = c.req.query("channel");

  if (!file) return c.body("file parameter required", 400);

  try {
    const { body, cleanup } = startStream(file, offset, id, channel || undefined);
    c.req.raw.signal.addEventListener("abort", cleanup);
    return new Response(body, {
      headers: {
        "Content-Type": "video/mp2t",
        "Connection": "keep-alive",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) return c.body(msg, 404);
    return c.body(msg, 500);
  }
});

// Stop a specific stream
app.delete("/stream/:id", (c) => {
  const stopped = stopStream(c.req.param("id"));
  if (!stopped) return c.json({ error: "Stream not found" }, 404);
  return c.json({ ok: true });
});

// List active streams
app.get("/streams", (c) => {
  return c.json(getActiveStreams());
});

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    ffmpeg: checkFfmpeg(),
    mediaMount: checkMediaRoot(),
    activeStreams: getActiveStreams().length,
  });
});

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch: app.fetch,
});

console.log(`tokyo-streamer listening on port ${PORT}`);
console.log(`  Media root: ${process.env.MEDIA_ROOT || "/media"}`);
