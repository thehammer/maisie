import { Hono } from "hono";
import type { Services } from "./types";

export function createSmartHomeRouter(services: Pick<Services, "ha" | "dakboard">) {
  const router = new Hono();

  // --- DAKboard ---

  router.get("/dakboard/devices", async (c) => {
    if (!services.dakboard) return c.json({ error: "DAKboard not configured" }, 503);
    try {
      const devices = await services.dakboard!.getDevices();
      return c.json(devices);
    } catch (err) {
      console.error("[dakboard] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/dakboard/screens", async (c) => {
    if (!services.dakboard) return c.json({ error: "DAKboard not configured" }, 503);
    try {
      const screens = await services.dakboard!.getScreens();
      return c.json(screens);
    } catch (err) {
      console.error("[dakboard] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/dakboard/devices/:deviceId/screen", async (c) => {
    if (!services.dakboard) return c.json({ error: "DAKboard not configured" }, 503);
    try {
      const deviceId = Number(c.req.param("deviceId"));
      const { screenId } = await c.req.json<{ screenId: number }>();
      const result = await services.dakboard!.setDeviceScreen(deviceId, screenId);
      return c.json(result);
    } catch (err) {
      console.error("[dakboard] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/dakboard/metrics", async (c) => {
    if (!services.dakboard) return c.json({ error: "DAKboard not configured" }, 503);
    try {
      const { name, value } = await c.req.json<{ name: string; value: number | string }>();
      await services.dakboard!.pushMetric(name, value);
      return c.json({ ok: true });
    } catch (err) {
      console.error("[dakboard] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- Home Assistant ---

  router.get("/ha/lights", async (c) => {
    if (!services.ha) return c.json({ error: "Home Assistant not configured" }, 503);
    try {
      const lights = await services.ha!.getLights();
      return c.json(lights.map((l) => ({
        entityId: l.entity_id,
        name: l.attributes.friendly_name || l.entity_id,
        state: l.state,
        brightness: l.attributes.brightness,
        rgb: l.attributes.rgb_color,
        colorTemp: l.attributes.color_temp,
      })));
    } catch (err) {
      console.error("[ha] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/ha/switches", async (c) => {
    if (!services.ha) return c.json({ error: "Home Assistant not configured" }, 503);
    try {
      const switches = await services.ha!.getSwitches();
      return c.json(switches.map((s) => ({
        entityId: s.entity_id,
        name: s.attributes.friendly_name || s.entity_id,
        state: s.state,
      })));
    } catch (err) {
      console.error("[ha] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/ha/switches/:entityId/toggle", async (c) => {
    if (!services.ha) return c.json({ error: "Home Assistant not configured" }, 503);
    try {
      const entityId = c.req.param("entityId");
      const state = await services.ha!.getState(entityId);
      if (state.state === "on") {
        await services.ha!.turnOff(entityId);
      } else {
        await services.ha!.turnOn(entityId);
      }
      return c.json({ ok: true });
    } catch (err) {
      console.error("[ha] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/ha/scenes", async (c) => {
    if (!services.ha) return c.json({ error: "Home Assistant not configured" }, 503);
    try {
      const scenes = await services.ha!.getScenes();
      return c.json(scenes.map((s) => ({
        entityId: s.entity_id,
        name: s.attributes.friendly_name || s.entity_id,
      })));
    } catch (err) {
      console.error("[ha] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/ha/lights/:entityId/toggle", async (c) => {
    if (!services.ha) return c.json({ error: "Home Assistant not configured" }, 503);
    try {
      const entityId = c.req.param("entityId");
      const state = await services.ha!.getState(entityId);
      if (state.state === "on") {
        await services.ha!.turnOff(entityId);
      } else {
        await services.ha!.turnOn(entityId);
      }
      return c.json({ ok: true });
    } catch (err) {
      console.error("[ha] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/ha/scenes/:entityId/trigger", async (c) => {
    if (!services.ha) return c.json({ error: "Home Assistant not configured" }, 503);
    try {
      const entityId = c.req.param("entityId");
      await services.ha!.triggerScene(entityId);
      return c.json({ ok: true });
    } catch (err) {
      console.error("[ha] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}
