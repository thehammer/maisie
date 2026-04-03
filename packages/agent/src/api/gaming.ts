import { Hono } from "hono";
import { getPs4Catalog } from "../skills/gaming/ps4-sync";
import type { Services } from "./types";

export function createGamingRouter(services: Pick<Services, "db" | "ps4">) {
  const { db } = services;
  const router = new Hono();

  router.get("/ps4/status", async (c) => {
    if (!services.ps4) return c.json({ error: "PS4 not configured" }, 503);
    try {
      const status = await services.ps4!.getStatus();
      return c.json({
        ...status,
        totalInstalled: status.apps.length,
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/ps4/catalog", (c) => {
    const catalog = getPs4Catalog(db);
    const installed = catalog.filter((a) => !a.removed);
    const removed = catalog.filter((a) => a.removed);
    return c.json({
      installed,
      removed,
      totalInstalled: installed.length,
      totalRemoved: removed.length,
      timestamp: new Date().toISOString(),
    });
  });

  router.post("/ps4/scan", async (c) => {
    if (!services.ps4) return c.json({ error: "PS4 not configured" }, 503);
    try {
      const { syncPs4Apps } = await import("../skills/gaming/ps4-sync");
      const apps = await services.ps4!.getInstalledApps();
      const result = syncPs4Apps(db, apps);
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}
