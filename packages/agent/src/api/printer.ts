import { Hono } from "hono";
import { analyze3mf, repair3mf, repairSingleObject } from "../skills/printer/mesh-repair";
import type { Services } from "./types";

export function createPrinterRouter(services: Pick<Services, "bambu" | "dsm">) {
  const router = new Hono();

  // --- Bambu Lab ---

  router.get("/bambu/status", (c) => {
    if (!services.bambu) return c.json({ error: "Bambu not configured" }, 503);
    const status = services.bambu!.getStatus();
    if (!status) return c.json({ error: "No status available yet" }, 503);
    return c.json(status);
  });

  // --- 3MF Viewer Extraction ---

  router.get("/3mf/extract", async (c) => {
    if (!services.dsm) return c.json({ error: "Synology not configured" }, 503);
    const nasPath = c.req.query("path");
    if (!nasPath) return c.json({ error: "path required" }, 400);
    try {
      const upstream = await services.dsm!.downloadFile(nasPath);
      const contentType = upstream.headers.get("content-type") || "";
      if (contentType.includes("json")) return c.json({ error: "File not found" }, 404);

      const tmpPath = `/tmp/maisie-3mf-viewer-${Date.now()}.3mf`;
      const buf = await upstream.arrayBuffer();
      await Bun.write(tmpPath, buf);

      const { extract3mf } = await import("../skills/printer/threemf-extract");
      const manifest = await extract3mf(tmpPath, nasPath);

      await Bun.spawn(["rm", "-f", tmpPath]).exited;
      return c.json(manifest);
    } catch (err) {
      console.error("[3mf] Extract error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/3mf/part", async (c) => {
    const nasPath = c.req.query("path");
    const partIdx = Number(c.req.query("index"));
    if (!nasPath || isNaN(partIdx)) return c.json({ error: "path and index required" }, 400);
    try {
      const { get3mfPartSTL } = await import("../skills/printer/threemf-extract");
      const stl = get3mfPartSTL(nasPath, partIdx);
      if (!stl) return c.json({ error: "Part not found — extract first" }, 404);
      return new Response(stl as unknown as BodyInit, {
        headers: { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=3600" },
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- 3MF Mesh Repair ---

  router.post("/printer/mesh/analyze", async (c) => {
    try {
      const { filePath } = await c.req.json<{ filePath: string }>();
      if (!filePath) return c.json({ error: "filePath required" }, 400);
      const analysis = await analyze3mf(filePath);
      return c.json(analysis);
    } catch (err) {
      console.error("[mesh-repair] Analyze error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/printer/mesh/repair", async (c) => {
    try {
      const { filePath, outputPath, objectName } = await c.req.json<{
        filePath: string;
        outputPath?: string;
        objectName?: string;
      }>();
      if (!filePath) return c.json({ error: "filePath required" }, 400);

      const result = objectName
        ? await repairSingleObject(filePath, objectName, outputPath)
        : await repair3mf(filePath, outputPath);

      return c.json(result);
    } catch (err) {
      console.error("[mesh-repair] Repair error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}
