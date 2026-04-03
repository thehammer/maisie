import { Hono } from "hono";
import { join } from "path";
import { getNasHealth } from "../skills/synology/health";
import type { Services } from "./types";

export function createNasRouter(services: Pick<Services, "db" | "dsm">) {
  const router = new Hono();

  router.get("/nas/health", async (c) => {
    if (!services.dsm) return c.json({ error: "Synology not configured" }, 503);
    try {
      const health = await getNasHealth(services.dsm!);
      return c.json(health);
    } catch (err) {
      console.error("[nas] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/nas/files", async (c) => {
    if (!services.dsm) return c.json({ error: "Synology not configured" }, 503);
    try {
      const path = c.req.query("path") || "/volume1/docker";
      const files = await services.dsm!.listFiles(path);
      // Hide viewer config files from listings
      const filtered = files.filter((f: any) => f.name !== ".maisie-viewer.json");
      return c.json(filtered);
    } catch (err) {
      console.error("[nas] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  // Viewer config — stored locally in agent data dir, keyed by folder path hash
  const viewerConfigDir = join(import.meta.dir, "../../../data/viewer-configs");

  router.get("/nas/viewer-config", async (c) => {
    const folderPath = c.req.query("path");
    if (!folderPath) return c.json({ error: "path required" }, 400);
    try {
      const { existsSync, readFileSync } = await import("fs");
      const configKey = Buffer.from(folderPath).toString("base64url");
      const configFile = join(viewerConfigDir, `${configKey}.json`);
      if (existsSync(configFile)) {
        return c.json(JSON.parse(readFileSync(configFile, "utf-8")));
      }
      return c.json({});
    } catch {
      return c.json({});
    }
  });

  router.post("/nas/viewer-config", async (c) => {
    const folderPath = c.req.query("path");
    if (!folderPath) return c.json({ error: "path required" }, 400);
    try {
      const { mkdirSync, writeFileSync } = await import("fs");
      mkdirSync(viewerConfigDir, { recursive: true });
      const configKey = Buffer.from(folderPath).toString("base64url");
      const configFile = join(viewerConfigDir, `${configKey}.json`);
      const config = await c.req.json();
      writeFileSync(configFile, JSON.stringify(config, null, 2));
      return c.json({ ok: true });
    } catch (err) {
      console.error("[viewer] Config write error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/nas/download", async (c) => {
    if (!services.dsm) return c.json({ error: "Synology not configured" }, 503);
    const filePath = c.req.query("path");
    if (!filePath) return c.json({ error: "path required" }, 400);
    try {
      const upstream = await services.dsm!.downloadFile(filePath);
      const contentType = upstream.headers.get("content-type") || "";
      // Synology returns JSON with error on failure, binary on success
      if (contentType.includes("json")) {
        const err = await upstream.json();
        console.error("[nas] File download failed:", err);
        return c.json({ error: "File not found" }, 404);
      }
      const filename = filePath.split("/").pop() ?? "file";
      return new Response(upstream.body, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `inline; filename="${filename}"`,
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch (err) {
      console.error("[nas] File download error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/nas/container/:name", async (c) => {
    if (!services.dsm) return c.json({ error: "Synology not configured" }, 503);
    try {
      const name = c.req.param("name");
      const details = await services.dsm!.getDockerContainerDetails(name);
      return c.json(details);
    } catch (err) {
      console.error("[nas] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}
