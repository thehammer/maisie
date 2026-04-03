import { Hono } from "hono";
import { runNetworkAudit, formatAuditReport } from "../skills/network/audit";
import type { Services } from "./types";

export function createNetworkRouter(services: Pick<Services, "db" | "unifi">) {
  const { db } = services;
  const router = new Hono();

  router.get("/audit", async (c) => {
    if (!services.unifi) return c.json({ error: "UniFi not configured" }, 503);
    try {
      const format = c.req.query("format");
      const report = await runNetworkAudit(db, services.unifi!);
      if (format === "markdown") {
        return c.text(formatAuditReport(report));
      }
      return c.json(report);
    } catch (err) {
      console.error("[audit] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/network/config", async (c) => {
    if (!services.unifi) return c.json({ error: "UniFi not configured" }, 503);
    try {
      const networks = await services.unifi!.getNetworks();
      const wlans = await services.unifi!.getWlanConf();
      const fwRules = await services.unifi!.getFirewallRules();
      const portForwards = await services.unifi!.getPortForwards();
      const settings = await services.unifi!.getSiteSettings();
      return c.json({ networks, wlans, firewallRules: fwRules, portForwards, settings });
    } catch (err) {
      console.error("[network] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/network/devices", async (c) => {
    if (!services.unifi) return c.json({ error: "UniFi not configured" }, 503);
    try {
      const devices = await services.unifi!.getDevices();
      return c.json(devices);
    } catch (err) {
      console.error("[network] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/network/upload-cert", async (c) => {
    if (!services.unifi) return c.json({ error: "UniFi not configured" }, 503);
    try {
      const { cert, key } = await c.req.json<{ cert: string; key: string }>();
      if (!cert || !key) return c.json({ error: "cert and key are required" }, 400);
      const result = await services.unifi!.uploadSslCert(cert, key);
      return c.json({ ok: true, result });
    } catch (err) {
      console.error("[cert] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}
