import { Hono } from "hono";
import type { Services } from "./types";

export function createProtectRouter(services: Pick<Services, "protect">) {
  const router = new Hono();
  const protectHost = process.env.UNIFI_HOST ?? "192.168.1.1";

  router.get("/protect/status", async (c) => {
    if (!services.protect) return c.json({ error: "UniFi Protect not configured" }, 503);
    try {
      const bootstrap = await services.protect!.getBootstrap();
      const cameras = (bootstrap.cameras ?? []).map((cam: any) => {
        // Build RTSP URLs from channels — Protect uses rtsps on port 7447
        const channels = (cam.channels ?? []).map((ch: any) => ({
          id: ch.id,
          name: ch.name,
          enabled: ch.enabled,
          isRtspEnabled: ch.isRtspEnabled,
          rtspAlias: ch.rtspAlias ?? null,
          rtspUrl: ch.isRtspEnabled && ch.rtspAlias
            ? `rtsps://${protectHost}:7447/${ch.rtspAlias}`
            : null,
          width: ch.width,
          height: ch.height,
          fps: ch.fps,
          bitrate: ch.bitrate,
        }));
        // Pick the highest-res enabled RTSP channel as the primary stream URL
        const primaryChannel = channels
          .filter((ch: any) => ch.rtspUrl)
          .sort((a: any, b: any) => (b.width * b.height) - (a.width * a.height))[0];
        return {
          id: cam.id,
          name: cam.name,
          type: cam.type,
          state: cam.state,
          host: cam.host,
          mac: cam.mac,
          firmwareVersion: cam.firmwareVersion,
          isConnected: cam.isConnected,
          isRecording: cam.isRecording,
          isMotionDetected: cam.isMotionDetected,
          lastMotionEventId: cam.lastMotionEventId ?? null,
          upSince: cam.upSince ?? null,
          connectedSince: cam.connectedSince ?? null,
          /** Primary RTSP stream URL (highest resolution enabled channel). */
          rtspUrl: primaryChannel?.rtspUrl ?? null,
          channels,
        };
      });
      const nvr = bootstrap.nvr
        ? {
            id: bootstrap.nvr.id,
            name: bootstrap.nvr.name,
            host: bootstrap.nvr.host,
            mac: bootstrap.nvr.mac,
            firmwareVersion: bootstrap.nvr.firmwareVersion,
            uptime: bootstrap.nvr.uptime,
            isRecordingDisabled: bootstrap.nvr.isRecordingDisabled,
            storageUsedBytes: bootstrap.nvr.storageInfo?.usedSize ?? 0,
            storageTotalBytes: bootstrap.nvr.storageInfo?.totalSize ?? 0,
            recordingRetentionDays: bootstrap.nvr.recordingRetentionDurationMs
              ? Math.round(bootstrap.nvr.recordingRetentionDurationMs / 86400000)
              : 0,
          }
        : null;
      return c.json({
        nvr,
        cameras,
        sensorCount: (bootstrap.sensors ?? []).length,
        lightCount: (bootstrap.lights ?? []).length,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[protect] Status error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/protect/cameras", async (c) => {
    if (!services.protect) return c.json({ error: "UniFi Protect not configured" }, 503);
    try {
      const cameras = await services.protect!.getCameras();
      return c.json(cameras);
    } catch (err) {
      console.error("[protect] Cameras error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/protect/cameras/:id", async (c) => {
    if (!services.protect) return c.json({ error: "UniFi Protect not configured" }, 503);
    try {
      const camera = await services.protect!.getCamera(c.req.param("id"));
      return c.json(camera);
    } catch (err) {
      console.error("[protect] Camera error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/protect/events", async (c) => {
    if (!services.protect) return c.json({ error: "UniFi Protect not configured" }, 503);
    try {
      const start = c.req.query("start") ? Number(c.req.query("start")) : undefined;
      const end = c.req.query("end") ? Number(c.req.query("end")) : undefined;
      const types = c.req.query("types")?.split(",") ?? undefined;
      const events = await services.protect!.getEvents({ start, end, types });
      return c.json(events);
    } catch (err) {
      console.error("[protect] Events error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}
