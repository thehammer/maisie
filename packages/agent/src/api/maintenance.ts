import { Hono } from "hono";
import { getStatus as getNightlyStatus, manualStart as nightlyStart, manualStop as nightlyStop } from "../skills/maintenance/nightly-runner";
import type { Services } from "./types";

export function createMaintenanceRouter(_services: Pick<Services, "db">) {
  const router = new Hono();

  router.get("/maintenance/nightly/status", (c) => {
    return c.json(getNightlyStatus());
  });

  router.post("/maintenance/nightly/start", async (c) => {
    try {
      const result = await nightlyStart();
      if (!result.started) {
        return c.json({ error: result.reason }, 409);
      }
      return c.json({ ok: true });
    } catch (err) {
      console.error("[nightly] Start error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/maintenance/nightly/stop", async (c) => {
    try {
      const result = await nightlyStop();
      if (!result.stopped) {
        return c.json({ error: result.reason }, 409);
      }
      return c.json({ ok: true });
    } catch (err) {
      console.error("[nightly] Stop error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}
