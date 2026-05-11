import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { devices, eventLog } from "../services/schema";
import type { Services } from "./types";

export function createDevicesRouter(services: Pick<Services, "db">) {
  const { db } = services;
  const router = new Hono();

  router.get("/devices/summary", (c) => {
    const DEFAULT_VLAN_TYPES = new Set([
      "computer", "phone", "tablet", "server", "network", "camera",
      "gaming", "streaming", "unknown", "ap", "wearable",
      "tuner", "av", "display",
    ]);

    const allDevices = db.select().from(devices).all();

    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const d of allDevices) {
      const status = d.status ?? "unknown";
      const type = d.deviceType ?? "unknown";
      byStatus[status] = (byStatus[status] || 0) + 1;
      byType[type] = (byType[type] || 0) + 1;
    }

    const newCount = byStatus["new"] || 0;
    const suspiciousCount = byStatus["suspicious"] || 0;
    const alertCount = newCount + suspiciousCount;

    const misplacedIot = allDevices
      .filter(
        (d) =>
          d.networkSegment === "Default" &&
          !DEFAULT_VLAN_TYPES.has(d.deviceType ?? "unknown") &&
          d.status !== "new",
      )
      .map((d) => ({
        name: d.deviceDescription || d.hostname || d.mac,
        type: d.deviceType,
        ip: d.ip || null,
      }));

    const topTypes = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));

    return c.json({
      total: allDevices.length,
      trusted: byStatus["trusted"] || 0,
      newDevices: newCount,
      suspicious: suspiciousCount,
      alertCount,
      topTypes,
      misplacedIot,
      misplacedIotCount: misplacedIot.length,
    });
  });

  router.get("/devices", (c) => {
    const allDevices = db.select().from(devices).all();
    return c.json(allDevices);
  });

  router.get("/devices/:mac", (c) => {
    const mac = c.req.param("mac");
    const device = db.select().from(devices).where(eq(devices.mac, mac)).get();
    if (!device) return c.json({ error: "Device not found" }, 404);
    return c.json(device);
  });

  router.patch("/devices/:mac", async (c) => {
    const mac = c.req.param("mac");
    const device = db.select().from(devices).where(eq(devices.mac, mac)).get();
    if (!device) return c.json({ error: "Device not found" }, 404);

    const body = await c.req.json();
    const allowed = ["status", "deviceType", "deviceDescription", "notes"] as const;
    const updates: Record<string, string> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }
    if (Object.keys(updates).length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    db.update(devices).set(updates).where(eq(devices.mac, mac)).run();
    const updated = db.select().from(devices).where(eq(devices.mac, mac)).get();
    return c.json(updated);
  });

  router.post("/devices/bulk-update", async (c) => {
    const body = await c.req.json();
    const { updates: deviceUpdates } = body as {
      updates: Array<{
        mac: string;
        status?: string;
        deviceType?: string;
        deviceDescription?: string;
        notes?: string;
      }>;
    };
    if (!Array.isArray(deviceUpdates)) {
      return c.json({ error: "Expected { updates: [...] }" }, 400);
    }

    const allowed = ["status", "deviceType", "deviceDescription", "notes"] as const;
    let applied = 0;
    for (const item of deviceUpdates) {
      const fields: Record<string, string> = {};
      for (const key of allowed) {
        if (key in item) fields[key] = item[key as keyof typeof item] as string;
      }
      if (Object.keys(fields).length > 0) {
        db.update(devices).set(fields).where(eq(devices.mac, item.mac)).run();
        applied++;
      }
    }
    return c.json({ applied, total: deviceUpdates.length });
  });

  router.get("/events", (c) => {
    const limit = Number(c.req.query("limit")) || 50;
    const events = db
      .select()
      .from(eventLog)
      .orderBy(desc(eventLog.timestamp))
      .limit(limit)
      .all();
    return c.json(events);
  });

  return router;
}
