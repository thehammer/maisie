import { Hono } from "hono";
import { join } from "path";
import { existsSync, mkdirSync, unlinkSync, readdirSync, renameSync } from "fs";
import sharp from "sharp";
import { getGuide, getEpgStatus, refreshGuide } from "../services/epg";
import { pushLineup, autoPopulateChannels } from "../skills/network/synthetic-hdhr";
import { hdhrChannels } from "../services/schema";
import { eq } from "drizzle-orm";
import {
  listLibraryChannels,
  getLibraryChannel,
  updateLibraryChannel,
  resolveNowPlaying,
  generateSchedule,
  type ScheduleEpisode,
} from "../skills/media/library-channels";
import { createLibraryChannelsRouter, type SyncResult } from "../skills/media/library-channels-router";
import type { Services } from "./types";

export function createTvRouter(services: Pick<Services, "db" | "plex" | "protect">) {
  const { db } = services;
  const router = new Hono();

  const syntheticHdhrUrl = process.env.SYNTHETIC_HDHR_URL || "http://localhost:5004";
  const PLEX_HOST = process.env.PLEX_HOST || "";
  const PLEX_PORT = process.env.PLEX_PORT || "32400";
  const PLEX_TOKEN = process.env.PLEX_TOKEN || "";

  async function syncChannels(): Promise<SyncResult> {
    const result: SyncResult = { hdhr: false, plex: false, errors: [] };

    // 1. Rebuild synthetic-hdhr lineup
    try {
      const res = await fetch(`${syntheticHdhrUrl}/api/rebuild`, { method: "POST" });
      result.hdhr = res.ok;
      if (!res.ok) result.errors.push(`hdhr: ${res.status}`);
    } catch (err) {
      result.errors.push(`hdhr: ${String(err)}`);
    }

    // 2. Refresh Plex guide (find DVR using our device, reload its guide)
    if (!PLEX_HOST || !PLEX_TOKEN) {
      result.plex = true; // not configured — nothing to sync
      return result;
    }
    try {
      const plexBase = `http://${PLEX_HOST}:${PLEX_PORT}`;
      const dvrsRes = await fetch(`${plexBase}/livetv/dvrs?X-Plex-Token=${PLEX_TOKEN}`, {
        headers: { Accept: "application/json" },
      });
      if (!dvrsRes.ok) {
        result.errors.push(`plex dvrs: ${dvrsRes.status}`);
        return result;
      }
      const dvrs = (await dvrsRes.json()) as any;
      let reloaded = false;
      for (const dvr of dvrs.MediaContainer?.Dvr || []) {
        // Check if this DVR uses our synthetic-hdhr
        const isMaisie = dvr.Device?.some((d: any) =>
          d.deviceId === "MAISIE01" || d.uri?.includes("5004"),
        );
        if (isMaisie) {
          const reloadRes = await fetch(
            `${plexBase}/livetv/dvrs/${dvr.key}/reloadGuide?X-Plex-Token=${PLEX_TOKEN}`,
            { method: "POST" },
          );
          if (reloadRes.ok) {
            reloaded = true;
            console.log(`[plex] Triggered guide reload for DVR ${dvr.key}`);
          } else {
            result.errors.push(`plex reload dvr ${dvr.key}: ${reloadRes.status}`);
          }
        }
      }
      result.plex = reloaded;
    } catch (err) {
      result.errors.push(`plex: ${String(err)}`);
      console.error(`[plex] Guide refresh failed: ${err}`);
    }

    return result;
  }

  // Channel icon directory — defined before router mount so onRenumber can reference it
  const dataDir = join(process.env.DB_PATH || join(import.meta.dir, "../../../../..", "data/maisie.db"), "..");
  const ICON_DIR = join(dataDir, "channel-icons");
  mkdirSync(ICON_DIR, { recursive: true });

  const TOKYO_STREAMER_URL = process.env.TOKYO_STREAMER_URL || "http://localhost:5050";
  // Plex returns paths like /volume1/PlexLibrary/TV Shows/...
  // Tokyo streamer mounts the NAS at MEDIA_ROOT, so we strip the Plex prefix
  const PLEX_PATH_PREFIX = process.env.PLEX_PATH_PREFIX || process.env.PLEX_MEDIA_PREFIX || "/volume1/PlexLibrary";

  // Resolve episodes for a library channel — works for both shows and playlists
  async function resolveChannelEpisodes(
    channel: ReturnType<typeof getLibraryChannel>,
  ): Promise<ScheduleEpisode[]> {
    if (!services.plex) throw new Error("Plex not connected");
    if (!channel) throw new Error("Channel not found");

    if (channel.content.type === "playlist" && channel.content.playlistRatingKey) {
      const items = await services.plex!.getPlaylistItems(channel.content.playlistRatingKey);
      return items
        .filter((item) => item.filePath)
        .map((item) => ({
          title: item.title + (item.year ? ` (${item.year})` : ""),
          showTitle: item.grandparentTitle || undefined,
          seasonNumber: item.parentIndex ?? 0,
          episodeNumber: item.index ?? 0,
          durationMs: item.duration,
          filePath: item.filePath.replace(PLEX_PATH_PREFIX, ""),
          thumb: item.thumb || undefined,
        }));
    }

    if (!channel.content.showRatingKey) {
      throw new Error("Channel has no showRatingKey");
    }
    const plexEpisodes = await services.plex!.getShowEpisodes(channel.content.showRatingKey);
    return plexEpisodes.map((ep) => ({
      title: ep.title,
      seasonNumber: ep.parentIndex,
      episodeNumber: ep.index,
      durationMs: ep.duration,
      filePath: ep.filePath.replace(PLEX_PATH_PREFIX, ""),
      thumb: ep.thumb || undefined,
    }));
  }

  // --- HDHR Protect lineup management ---

  router.get("/synthetic-hdhr/channels", (c) => {
    const channels = db.select().from(hdhrChannels).all();
    return c.json(channels);
  });

  router.post("/synthetic-hdhr/channels", async (c) => {
    const body = await c.req.json<{ number: string; name: string; streamName: string; cameraId?: string }>();
    db.insert(hdhrChannels)
      .values({ ...body, enabled: 1 })
      .onConflictDoUpdate({
        target: hdhrChannels.number,
        set: { name: body.name, streamName: body.streamName, cameraId: body.cameraId },
      })
      .run();
    const syncResult = await syncChannels();
    return c.json({ ok: true, sync: syncResult });
  });

  router.delete("/synthetic-hdhr/channels/:number", async (c) => {
    const { eq } = await import("drizzle-orm");
    db.delete(hdhrChannels).where(eq(hdhrChannels.number, c.req.param("number"))).run();
    const syncResult = await syncChannels();
    return c.json({ ok: true, sync: syncResult });
  });

  router.post("/synthetic-hdhr/channels/:number/toggle", async (c) => {
    const { eq } = await import("drizzle-orm");
    const num = c.req.param("number");
    const ch = db.select().from(hdhrChannels).where(eq(hdhrChannels.number, num)).get();
    if (!ch) return c.json({ error: "Channel not found" }, 404);
    db.update(hdhrChannels).set({ enabled: ch.enabled ? 0 : 1 }).where(eq(hdhrChannels.number, num)).run();
    const syncResult = await syncChannels();
    return c.json({ ok: true, enabled: !ch.enabled, sync: syncResult });
  });

  router.post("/synthetic-hdhr/sync", async (c) => {
    try {
      const result = await pushLineup(db);
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/synthetic-hdhr/auto-populate", async (c) => {
    if (!services.protect) return c.json({ error: "Protect not connected" }, 503);
    try {
      const cameras = await services.protect!.getCameras();
      const result = await autoPopulateChannels(db, cameras);
      if (result.added > 0) {
        try { await pushLineup(db); } catch {}
      }
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- Library Channels API ---

  // Mount library channel CRUD + sync-on-mutation router.
  // onRenumber renames the icon file on disk whenever a channel is renumbered.
  router.route(
    "/library-channels",
    createLibraryChannelsRouter({
      db,
      sync: syncChannels,
      onRenumber: (oldNum, newNum) => {
        const oldIcon = join(ICON_DIR, `${oldNum}.png`);
        const newIcon = join(ICON_DIR, `${newNum}.png`);
        if (existsSync(oldIcon)) {
          renameSync(oldIcon, newIcon);
          // Update icon_url in DB — skip temp names used during two-pass reorder
          if (!newNum.startsWith("_tmp_")) {
            updateLibraryChannel(db, newNum, { iconUrl: `channel-icons/${newNum}.png` });
          }
        }
      },
    }),
  );
  const ICON_WIDTH = 360;
  const ICON_HEIGHT = 270;

  router.post("/library-channels/:number/icon", async (c) => {
    const num = c.req.param("number");
    const channel = getLibraryChannel(db, num);
    if (!channel) return c.json({ error: "Channel not found" }, 404);

    try {
      let imageBuffer: Buffer;
      const contentType = c.req.header("content-type") || "";

      if (contentType.includes("multipart/form-data")) {
        const formData = await c.req.formData();
        const file = formData.get("icon") as File | null;
        if (!file) return c.json({ error: "No icon file provided" }, 400);
        imageBuffer = Buffer.from(await file.arrayBuffer());
      } else {
        const body = await c.req.json<{ url: string }>();
        if (!body.url) return c.json({ error: "url is required" }, 400);
        const res = await fetch(body.url);
        if (!res.ok) return c.json({ error: `Failed to fetch: ${res.status}` }, 400);
        imageBuffer = Buffer.from(await res.arrayBuffer());
      }

      // Resize to square PNG
      const outputPath = join(ICON_DIR, `${num}.png`);
      await sharp(imageBuffer)
        .resize(ICON_WIDTH, ICON_HEIGHT, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(outputPath);

      // Store relative reference in DB
      updateLibraryChannel(db, num, { iconUrl: `channel-icons/${num}.png` });
      const syncResult = await syncChannels();

      return c.json({ ok: true, iconUrl: `/api/library-channels/${num}/icon`, sync: syncResult });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  router.delete("/library-channels/:number/icon", async (c) => {
    const num = c.req.param("number");
    const channel = getLibraryChannel(db, num);
    if (!channel) return c.json({ error: "Channel not found" }, 404);

    const iconPath = join(ICON_DIR, `${num}.png`);
    if (existsSync(iconPath)) {
      unlinkSync(iconPath);
    }
    updateLibraryChannel(db, num, { iconUrl: null });
    const syncResult = await syncChannels();
    return c.json({ ok: true, sync: syncResult });
  });

  // Serve channel icon — works for any channel type (camera, library, etc.)
  const serveIcon = (c: any) => {
    const num = c.req.param("number");
    const iconPath = join(ICON_DIR, `${num}.png`);
    if (!existsSync(iconPath)) return c.body("No icon", 404);

    const file = Bun.file(iconPath);
    return new Response(file, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  };
  router.get("/library-channels/:number/icon", serveIcon);
  router.get("/channels/:number/icon", serveIcon);

  // Channel icon URLs for XMLTV — returns icon URL for each library channel
  router.get("/library-channels/icons", async (c) => {
    if (!services.plex) return c.json({});
    const channels = listLibraryChannels(db);
    const lanIp = process.env.LAN_IP || "localhost";
    const apiPort = process.env.API_PORT || "3001";
    const maisieBase = `http://${lanIp}:${apiPort}`;
    const icons: Record<string, string> = {};

    // Get playlist composite paths (they need the timestamp suffix)
    let playlistComposites: Record<string, string> = {};
    try {
      const playlists = await services.plex!.getPlaylists("video");
      // Fetch full metadata to get composite paths
      const plRes = await fetch(
        `http://${PLEX_HOST}:${PLEX_PORT}/playlists?X-Plex-Token=${PLEX_TOKEN}`,
        { headers: { Accept: "application/json" } },
      );
      if (plRes.ok) {
        const plData = (await plRes.json()) as any;
        for (const pl of plData.MediaContainer?.Metadata || []) {
          if (pl.composite) playlistComposites[pl.ratingKey] = pl.composite;
        }
      }
    } catch {}

    for (const ch of channels) {
      try {
        // Custom icon takes priority
        if (ch.iconUrl && existsSync(join(ICON_DIR, `${ch.number}.png`))) {
          icons[ch.number] = `${maisieBase}/api/library-channels/${ch.number}/icon`;
          continue;
        }
        if (ch.content.type === "playlist" && ch.content.playlistRatingKey) {
          const composite = playlistComposites[ch.content.playlistRatingKey];
          if (composite) {
            icons[ch.number] = `${maisieBase}/api/plex/image${composite}`;
          }
        } else if (ch.content.showRatingKey) {
          icons[ch.number] = `${maisieBase}/api/plex/image/library/metadata/${ch.content.showRatingKey}/thumb`;
        }
      } catch {}
    }
    return c.json(icons);
  });

  // All channel icons — includes camera channels with icons on disk
  router.get("/channel-icons", (c) => {
    const lanIp = process.env.LAN_IP || "localhost";
    const apiPort = process.env.API_PORT || "3001";
    const maisieBase = `http://${lanIp}:${apiPort}`;
    const icons: Record<string, string> = {};

    // Scan icon directory for any channel icons
    try {
      const files = readdirSync(ICON_DIR) as string[];
      for (const file of files) {
        if (file.endsWith(".png")) {
          const num = file.replace(".png", "");
          icons[num] = `${maisieBase}/api/channels/${num}/icon`;
        }
      }
    } catch {}

    return c.json(icons);
  });

  router.get("/library-channels/:number/now-playing", async (c) => {
    const num = c.req.param("number");
    const channel = getLibraryChannel(db, num);
    if (!channel) return c.json({ error: "Channel not found" }, 404);
    if (!channel.enabled) return c.json({ error: "Channel is disabled" }, 400);

    try {
      const atMs = c.req.query("at") ? Number(c.req.query("at")) : undefined;
      const episodes = await resolveChannelEpisodes(channel);
      const result = resolveNowPlaying(
        episodes,
        channel.mode,
        channel.content.seed ?? 0,
        TOKYO_STREAMER_URL,
        channel.number,
        atMs,
      );
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // Library channel schedule — episode-by-episode for guide/XMLTV
  router.get("/library-channels/:number/schedule", async (c) => {
    const num = c.req.param("number");
    const days = Math.min(Number(c.req.query("days")) || 14, 30);
    const channel = getLibraryChannel(db, num);
    if (!channel) return c.json({ error: "Channel not found" }, 404);

    try {
      const episodes = await resolveChannelEpisodes(channel);

      const now = new Date();
      const start = new Date(now.getTime() - 12 * 3600 * 1000); // 12h of history
      const end = new Date(now);
      end.setDate(end.getDate() + days);

      const schedule = generateSchedule(
        episodes,
        channel.mode,
        channel.content.seed ?? 0,
        start,
        end,
      );

      const lanIp = process.env.LAN_IP || "localhost";
      const apiPort = process.env.API_PORT || "3001";
      const maisieBase = `http://${lanIp}:${apiPort}`;

      // Convert Plex thumb paths to proxied URLs
      const enrichedSchedule = schedule.map((entry) => ({
        ...entry,
        imageUrl: entry.imageUrl ? `${maisieBase}/api/plex/image${entry.imageUrl}` : undefined,
      }));

      return c.json({
        channel: { number: channel.number, name: channel.name, mode: channel.mode, contentType: channel.content.type },
        schedule: enrichedSchedule,
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- TV Tuning API ---
  // Provides unified channel list and tunes cable channels dynamically via go2rtc.
  // Camera channels are always available in go2rtc (static config).
  // Cable channels are added on-demand when tuned and removed when untuned.

  const PRIME_HOST = process.env.PRIME_HOST || "";
  const SYNTHETIC_HDHR_API = process.env.SYNTHETIC_HDHR_URL || "http://localhost:5004";

  router.get("/tv/channels", async (c) => {
    try {
      const res = await fetch(`${SYNTHETIC_HDHR_API}/api/lineup`);
      if (!res.ok) throw new Error(`${res.status}`);
      return c.json(await res.json());
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // TV Guide — returns EPG schedule data for broadcast channels
  router.get("/tv/guide", async (c) => {
    const hours = Math.min(Number(c.req.query("hours")) || 4, 24);
    return c.json(getGuide(hours));
  });

  router.get("/tv/guide/status", async (c) => {
    return c.json(getEpgStatus());
  });

  router.post("/tv/guide/refresh", async (c) => {
    await refreshGuide();
    return c.json(getEpgStatus());
  });

  router.post("/tv/tune", async (c) => {
    const { channel } = await c.req.json<{ channel: string }>();
    if (!channel) return c.json({ error: "channel required" }, 400);

    try {
      // Stop previous stream for THIS channel type only (don't kill other clients' streams)
      // TODO: implement proper session-based stream tracking (see docs/next-session.md)
      const chType = (() => {
        // Peek at channel type without consuming the lineup fetch
        const num = parseInt(channel);
        if (num >= 90001) return "camera";
        if (num >= 20001) return "library";
        return "cable";
      })();
      if (chType === "cable" || chType === "library") {
        try {
          const streamsRes = await fetch(`${TOKYO_STREAMER_URL}/streams`);
          const active = await streamsRes.json() as { id: string }[];
          // Only stop streams of the same type prefix
          const prefix = chType + "_";
          for (const s of active) {
            if (s.id.startsWith(prefix)) {
              await fetch(`${TOKYO_STREAMER_URL}/stream/${s.id}`, { method: "DELETE" });
            }
          }
        } catch {}
      }

      // Get the channel info from synthetic-hdhr
      const lineupRes = await fetch(`${SYNTHETIC_HDHR_API}/api/lineup`);
      const channels = await lineupRes.json() as any[];
      const ch = channels.find((ch: any) => ch.number === channel);
      if (!ch) return c.json({ error: "Channel not found" }, 404);

      if (ch.type === "camera") {
        // Camera streams are always in go2rtc — just return the stream name
        return c.json({ stream: ch.streamName, type: "camera" });
      }

      if (ch.type === "library") {
        // Library channel — resolve schedule, start HLS on Tokyo
        const npRes = await fetch(`http://localhost:3001/api/library-channels/${channel}/now-playing`);
        if (!npRes.ok) {
          const err = await npRes.json().catch(() => ({})) as any;
          return c.json({ error: err.error || `now-playing failed: ${npRes.status}` }, 502);
        }
        const nowPlaying = await npRes.json() as { episode: any; offsetSeconds: number; streamUrl: string };

        // Start HLS stream on Tokyo
        const hlsId = `library_${channel}`;
        const hlsRes = await fetch(
          `${TOKYO_STREAMER_URL}/hls?file=${encodeURIComponent(nowPlaying.episode.filePath)}&offset=${nowPlaying.offsetSeconds}&id=${hlsId}&channel=${encodeURIComponent(channel)}`,
          { method: "POST" },
        );
        if (!hlsRes.ok) {
          const err = await hlsRes.json().catch(() => ({})) as any;
          return c.json({ error: err.error || `HLS start failed: ${hlsRes.status}` }, 502);
        }
        const { playlist } = await hlsRes.json() as { id: string; playlist: string };

        // Wait for 2 segments — with -re, ffmpeg outputs at 1x speed so
        // 1 segment isn't enough buffer (player stalls after 4s)
        for (let i = 0; i < 20; i++) {
          const check = await fetch(`${TOKYO_STREAMER_URL}${playlist}`);
          if (check.ok) {
            const body = await check.text();
            if ((body.match(/\.ts/g) || []).length >= 2) break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }

        return c.json({
          type: "library",
          hlsUrl: `/api/tokyo${playlist}`,
          nowPlaying: {
            title: nowPlaying.episode.title,
            seasonNumber: nowPlaying.episode.seasonNumber,
            episodeNumber: nowPlaying.episode.episodeNumber,
          },
        });
      }

      // Cable channel — start HLS via Tokyo streamer from PRIME URL
      const hlsId = `cable_${channel}`;
      const primeUrl = `http://${PRIME_HOST}:5004/auto/v${channel}`;
      const hlsRes = await fetch(
        `${TOKYO_STREAMER_URL}/hls/url?url=${encodeURIComponent(primeUrl)}&id=${hlsId}&channel=${encodeURIComponent(channel)}`,
        { method: "POST" },
      );
      if (!hlsRes.ok) {
        const err = await hlsRes.json().catch(() => ({})) as any;
        return c.json({ error: err.error || `HLS start failed: ${hlsRes.status}` }, 502);
      }
      const { playlist } = await hlsRes.json() as { id: string; playlist: string };

      // Wait for 2 segments (PRIME takes ~10s to tune + segment production)
      for (let i = 0; i < 25; i++) {
        const check = await fetch(`${TOKYO_STREAMER_URL}${playlist}`);
        if (check.ok) {
          const body = await check.text();
          if ((body.match(/\.ts/g) || []).length >= 2) break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      return c.json({ type: "cable", hlsUrl: `/api/tokyo${playlist}` });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // Proxy Tokyo streamer HLS for browser access
  router.get("/tokyo/*", async (c) => {
    const path = c.req.path.replace(/^\/api\/tokyo/, "");
    try {
      const res = await fetch(`${TOKYO_STREAMER_URL}${path}`);
      if (!res.ok) return c.body(null, res.status as any);
      const contentType = path.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : "video/mp2t";
      return new Response(res.body, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch {
      return c.body("Tokyo streamer unavailable", 502);
    }
  });

  router.post("/tv/untune", async (c) => {
    const { channel, type } = await c.req.json<{ channel: string; type?: string }>();
    if (!channel) return c.json({ error: "channel required" }, 400);

    if (type === "library" || type === "cable") {
      const prefix = type === "library" ? "library" : "cable";
      try {
        await fetch(`${TOKYO_STREAMER_URL}/stream/${prefix}_${channel}`, { method: "DELETE" });
      } catch {}
      return c.json({ ok: true });
    }

    return c.json({ ok: true });
  });

  // --- go2rtc proxy (for production — Vite handles this in dev) ---
  const go2rtcUrl = process.env.GO2RTC_URL || "http://localhost:1984";
  router.all("/go2rtc/*", async (c) => {
    const path = c.req.path.replace(/^\/api\/go2rtc/, "").replace(/^\/go2rtc/, "");
    const url = new URL(c.req.url);
    const target = `${go2rtcUrl}${path}${url.search}`;
    try {
      let body: string | undefined;
      if (c.req.method !== "GET" && c.req.method !== "HEAD") {
        body = await c.req.text();
      }
      const res = await fetch(target, {
        method: c.req.method,
        body,
      });
      const responseBody = await res.text();
      // Log WebRTC SDP answers to debug ICE candidates
      if (path.includes("webrtc") && c.req.method === "POST") {
        const candidates = responseBody.split("\n").filter((l: string) => l.includes("candidate"));
        console.log(`[go2rtc-proxy] ${path} → ${res.status}, candidates: ${JSON.stringify(candidates)}`);
      }
      return new Response(responseBody, {
        status: res.status,
        headers: {
          "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (err) {
      return c.json({ error: `go2rtc proxy: ${err}` }, 502);
    }
  });

  return router;
}
