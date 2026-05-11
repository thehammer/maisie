import { Hono } from "hono";
import type { Services } from "./types";

export function createBleRouter(
  services: Pick<Services, "bleRegistry" | "bleBridge">
) {
  const router = new Hono();

  // ---- Devices ----

  router.get("/ble/devices", (c) => {
    if (!services.bleRegistry) return c.json({ error: "BLE not configured" }, 503);
    const ownership = c.req.query("ownership"); // "home" | "neighbor" | "unknown"
    if (ownership) {
      const devices = services.bleRegistry.getDevicesByOwnership(ownership as any);
      return c.json(devices);
    }
    return c.json(services.bleRegistry.getAllDevices());
  });

  router.get("/ble/devices/:mac", (c) => {
    if (!services.bleRegistry) return c.json({ error: "BLE not configured" }, 503);
    const mac = c.req.param("mac");
    const device = services.bleRegistry.getDevice(mac);
    if (!device) return c.json({ error: "Device not found" }, 404);
    return c.json(device);
  });

  // ---- Claim / Unclaim ----

  router.post("/ble/devices/:mac/claim", async (c) => {
    if (!services.bleRegistry) return c.json({ error: "BLE not configured" }, 503);
    const mac = c.req.param("mac");
    const body = await c.req.json();
    const { ownership = "home", label, room, protocol } = body;

    const device = services.bleRegistry.claimDevice(mac, ownership, {
      label,
      room,
      protocol,
    });
    if (!device) return c.json({ error: "Device not found" }, 404);
    return c.json(device);
  });

  // ---- Update device metadata ----

  router.patch("/ble/devices/:mac", async (c) => {
    if (!services.bleRegistry) return c.json({ error: "BLE not configured" }, 503);
    const mac = c.req.param("mac");
    const body = await c.req.json();
    const allowed = ["label", "room", "protocol", "ownership", "notes"] as const;
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }
    if (Object.keys(updates).length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }
    const device = services.bleRegistry.updateDevice(mac, updates);
    if (!device) return c.json({ error: "Device not found" }, 404);
    return c.json(device);
  });

  // ---- Commands ----

  router.post("/ble/devices/:mac/command", async (c) => {
    if (!services.bleBridge) return c.json({ error: "BLE bridge not configured" }, 503);
    const mac = c.req.param("mac");
    const body = await c.req.json();
    const { protocol = "generic", command, params = {} } = body;

    if (!command) return c.json({ error: "Missing 'command' field" }, 400);

    const result = await services.bleBridge.sendCommand(mac, protocol, command, params);
    return c.json(result);
  });

  // ---- Characterize ----

  router.post("/ble/devices/:mac/characterize", async (c) => {
    if (!services.bleBridge) return c.json({ error: "BLE bridge not configured" }, 503);
    const mac = c.req.param("mac");
    const body = await c.req.json().catch(() => ({}));
    const protocol = body.protocol || "generic";

    const result = await services.bleBridge.characterizeDevice(mac, protocol);
    return c.json(result);
  });

  // ---- Auto-claim rules ----

  router.get("/ble/rules", (c) => {
    if (!services.bleRegistry) return c.json({ error: "BLE not configured" }, 503);
    return c.json(services.bleRegistry.getAutoClaimRules());
  });

  router.post("/ble/rules", async (c) => {
    if (!services.bleRegistry) return c.json({ error: "BLE not configured" }, 503);
    const body = await c.req.json();
    services.bleRegistry.addAutoClaimRule(body);
    return c.json({ success: true, rules: services.bleRegistry.getAutoClaimRules() });
  });

  router.delete("/ble/rules/:id", (c) => {
    if (!services.bleRegistry) return c.json({ error: "BLE not configured" }, 503);
    const id = Number(c.req.param("id"));
    services.bleRegistry.deleteAutoClaimRule(id);
    return c.json({ success: true });
  });

  // ---- Gateway nodes ----

  router.get("/ble/nodes", (c) => {
    if (!services.bleRegistry) return c.json({ error: "BLE not configured" }, 503);
    return c.json(services.bleRegistry.getGatewayNodes());
  });

  router.put("/ble/nodes/:nodeId", async (c) => {
    if (!services.bleRegistry) return c.json({ error: "BLE not configured" }, 503);
    const nodeId = c.req.param("nodeId");
    const body = await c.req.json();
    const node = services.bleRegistry.upsertGatewayNode(nodeId, {
      room: body.room,
      floor: body.floor,
      x: body.x,
      y: body.y,
      notes: body.notes,
    });
    return c.json(node);
  });

  // ---- Stats ----

  router.get("/ble/stats", (c) => {
    if (!services.bleRegistry) return c.json({ error: "BLE not configured" }, 503);
    return c.json(services.bleRegistry.getStats());
  });

  return router;
}
