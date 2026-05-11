import { Hono } from "hono";
import { getStatus as getNightlyStatus, manualStart as nightlyStart, manualStop as nightlyStop } from "../skills/maintenance/nightly-runner";
import {
  getDockerUpgradesStatus,
  triggerDockerUpgradeCheck,
  setServiceAutoUpdate,
} from "../skills/maintenance/docker-upgrades";
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

  // Docker upgrade status (read-only — Wave 1)
  router.get("/maintenance/docker/status", (c) => {
    return c.json(getDockerUpgradesStatus());
  });

  // Write endpoints — added now so the legacy DockerUpgradesCard keeps working.
  // Not exposed via ViewDef; write-path ViewCard wiring is deferred to Wave 5.
  router.post("/maintenance/docker/check", async (c) => {
    const body = await c.req.json<{ service?: string }>().catch(() => ({}));
    const result = await triggerDockerUpgradeCheck(body.service);
    if (!result.started) return c.json({ error: result.reason }, 409);
    return c.json({ ok: true });
  });

  router.patch("/maintenance/docker/services/:service", async (c) => {
    const service = c.req.param("service");
    const body = await c.req.json<{ autoUpdate?: boolean }>().catch(() => ({}));
    if (typeof body.autoUpdate !== "boolean") {
      return c.json({ error: "autoUpdate (boolean) required" }, 400);
    }
    const result = setServiceAutoUpdate(service, body.autoUpdate);
    if (!result.ok) return c.json({ error: result.reason }, 404);
    return c.json({ ok: true });
  });

  return router;
}
