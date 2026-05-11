/**
 * BLE Device Registry — manages the lifecycle of discovered BLE devices.
 *
 * Listens to MQTT events from the BLE gateway and maintains the SQLite
 * device registry. Applies auto-claim rules to automatically classify
 * known device types as "home".
 */

import { eq, desc, and, gte, like } from "drizzle-orm";
import { bleDevices, bleAutoClaimRules, bleGatewayNodes } from "../../services/schema";
import { publish } from "../../services/mqtt";
import { TOPICS } from "../../topics";
import type { BleDevice, BleDeviceOwnership } from "@maisie/shared";

type Db = ReturnType<typeof import("../../services/db").initDb>;

export function createBleRegistry(db: Db) {
  /**
   * Process a device discovery event from the gateway.
   * Inserts new devices or updates existing ones.
   */
  function handleDiscovery(payload: {
    mac: string;
    name: string | null;
    companyId: number | null;
    companyName: string | null;
    rssi: number;
    persistence: number;
    seenCount: number;
    totalScans: number;
    serviceUuids: string[];
    gatewayNode: string;
    firstSeen: string;
    lastSeen: string;
  }) {
    const now = new Date().toISOString();
    const existing = db
      .select()
      .from(bleDevices)
      .where(eq(bleDevices.mac, payload.mac))
      .get();

    // Merge per-node RSSI map and derive estimated room
    const existingNodeRssi: Record<string, number> = JSON.parse(existing?.nodeRssi || "{}");
    existingNodeRssi[payload.gatewayNode] = payload.rssi;
    const nodeRssiJson = JSON.stringify(existingNodeRssi);
    const estimatedRoom = deriveRoom(db, existingNodeRssi);

    if (!existing) {
      // Check auto-claim rules
      const ownership = matchAutoClaimRule(payload.companyId, payload.name);

      db.insert(bleDevices)
        .values({
          mac: payload.mac,
          name: payload.name,
          companyId: payload.companyId,
          companyName: payload.companyName,
          rssi: payload.rssi,
          persistence: payload.persistence,
          seenCount: payload.seenCount,
          totalScans: payload.totalScans,
          ownership: ownership?.ownership ?? "unknown",
          label: ownership?.label ?? null,
          protocol: ownership?.protocol ?? null,
          services: JSON.stringify(payload.serviceUuids),
          capabilities: "{}",
          gatewayNode: payload.gatewayNode,
          nodeRssi: nodeRssiJson,
          estimatedRoom,
          firstSeen: payload.firstSeen || now,
          lastSeen: payload.lastSeen || now,
        })
        .run();
    } else {
      // Update existing device
      db.update(bleDevices)
        .set({
          name: payload.name || existing.name,
          companyId: payload.companyId ?? existing.companyId,
          companyName: payload.companyName || existing.companyName,
          rssi: payload.rssi,
          persistence: payload.persistence,
          seenCount: payload.seenCount,
          totalScans: payload.totalScans,
          gatewayNode: payload.gatewayNode,
          nodeRssi: nodeRssiJson,
          estimatedRoom,
          lastSeen: payload.lastSeen || now,
          services: JSON.stringify([
            ...new Set([
              ...JSON.parse(existing.services || "[]"),
              ...payload.serviceUuids,
            ]),
          ]),
        })
        .where(eq(bleDevices.mac, payload.mac))
        .run();
    }
  }

  /**
   * Batch update from the gateway's periodic full state dump.
   */
  function handleBatchUpdate(devices: Array<Parameters<typeof handleDiscovery>[0]>) {
    for (const d of devices) {
      handleDiscovery(d);
    }
  }

  /**
   * Check auto-claim rules for a newly discovered device.
   */
  function matchAutoClaimRule(
    companyId: number | null,
    name: string | null
  ): { ownership: string; label: string | null; protocol: string | null } | null {
    const rules = db.select().from(bleAutoClaimRules).all();

    for (const rule of rules) {
      // Match by company ID
      if (rule.companyId !== null && companyId === rule.companyId) {
        return {
          ownership: rule.ownership || "home",
          label: rule.label,
          protocol: rule.protocol,
        };
      }

      // Match by name pattern (simple glob: * at start/end)
      if (rule.namePattern && name) {
        const pattern = rule.namePattern;
        const nameLower = name.toLowerCase();
        const patternLower = pattern.toLowerCase();

        if (patternLower.startsWith("*") && patternLower.endsWith("*")) {
          if (nameLower.includes(patternLower.slice(1, -1))) return match(rule);
        } else if (patternLower.endsWith("*")) {
          if (nameLower.startsWith(patternLower.slice(0, -1))) return match(rule);
        } else if (patternLower.startsWith("*")) {
          if (nameLower.endsWith(patternLower.slice(1))) return match(rule);
        } else {
          if (nameLower === patternLower) return match(rule);
        }
      }
    }

    return null;
  }

  /**
   * Derive estimated room from per-node RSSI map.
   * Uses the node with the strongest signal whose room is configured.
   */
  function deriveRoom(db: Db, nodeRssi: Record<string, number>): string | null {
    if (Object.keys(nodeRssi).length === 0) return null;
    const nodes = db.select().from(bleGatewayNodes).where(eq(bleGatewayNodes.active, true)).all();
    const nodeRoomMap: Record<string, string | null> = {};
    for (const n of nodes) nodeRoomMap[n.nodeId] = n.room;

    // Find the node with strongest RSSI that has a room assigned
    let bestNode: string | null = null;
    let bestRssi = -Infinity;
    for (const [nodeId, rssi] of Object.entries(nodeRssi)) {
      if (rssi > bestRssi && nodeRoomMap[nodeId]) {
        bestRssi = rssi;
        bestNode = nodeId;
      }
    }
    return bestNode ? (nodeRoomMap[bestNode] ?? null) : null;
  }

  function match(rule: typeof bleAutoClaimRules.$inferSelect) {
    return {
      ownership: rule.ownership || "home",
      label: rule.label,
      protocol: rule.protocol,
    };
  }

  // ---- Query methods ----

  function getAllDevices(): typeof bleDevices.$inferSelect[] {
    return db.select().from(bleDevices).orderBy(desc(bleDevices.persistence)).all();
  }

  function getHomeDevices(): typeof bleDevices.$inferSelect[] {
    return db
      .select()
      .from(bleDevices)
      .where(eq(bleDevices.ownership, "home"))
      .orderBy(desc(bleDevices.persistence))
      .all();
  }

  function getDevice(mac: string): typeof bleDevices.$inferSelect | undefined {
    return db.select().from(bleDevices).where(eq(bleDevices.mac, mac)).get();
  }

  function getDevicesByOwnership(ownership: BleDeviceOwnership) {
    return db
      .select()
      .from(bleDevices)
      .where(eq(bleDevices.ownership, ownership))
      .orderBy(desc(bleDevices.persistence))
      .all();
  }

  // ---- Mutation methods ----

  function claimDevice(
    mac: string,
    ownership: BleDeviceOwnership,
    opts?: { label?: string; room?: string; protocol?: string }
  ) {
    const updates: Record<string, unknown> = { ownership };
    if (opts?.label) updates.label = opts.label;
    if (opts?.room) updates.room = opts.room;
    if (opts?.protocol) updates.protocol = opts.protocol;

    db.update(bleDevices).set(updates).where(eq(bleDevices.mac, mac)).run();
    return db.select().from(bleDevices).where(eq(bleDevices.mac, mac)).get();
  }

  function updateDevice(mac: string, updates: Partial<typeof bleDevices.$inferInsert>) {
    db.update(bleDevices).set(updates).where(eq(bleDevices.mac, mac)).run();
    return db.select().from(bleDevices).where(eq(bleDevices.mac, mac)).get();
  }

  function setCapabilities(mac: string, capabilities: Record<string, string[]>) {
    db.update(bleDevices)
      .set({ capabilities: JSON.stringify(capabilities) })
      .where(eq(bleDevices.mac, mac))
      .run();
  }

  // ---- Auto-claim rules ----

  function getAutoClaimRules() {
    return db.select().from(bleAutoClaimRules).all();
  }

  function addAutoClaimRule(rule: {
    companyId?: number;
    namePattern?: string;
    minPersistence?: number;
    ownership?: string;
    label?: string;
    protocol?: string;
  }) {
    return db
      .insert(bleAutoClaimRules)
      .values({
        companyId: rule.companyId ?? null,
        namePattern: rule.namePattern ?? null,
        minPersistence: rule.minPersistence ?? null,
        ownership: rule.ownership ?? "home",
        label: rule.label ?? null,
        protocol: rule.protocol ?? null,
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  function deleteAutoClaimRule(id: number) {
    db.delete(bleAutoClaimRules).where(eq(bleAutoClaimRules.id, id)).run();
  }

  // ---- Gateway nodes ----

  function getGatewayNodes() {
    return db.select().from(bleGatewayNodes).all();
  }

  function upsertGatewayNode(nodeId: string, opts: {
    room?: string;
    floor?: number;
    x?: number;
    y?: number;
    notes?: string;
  }) {
    const now = new Date().toISOString();
    const existing = db.select().from(bleGatewayNodes).where(eq(bleGatewayNodes.nodeId, nodeId)).get();
    if (!existing) {
      db.insert(bleGatewayNodes).values({
        nodeId,
        room: opts.room ?? null,
        floor: opts.floor ?? 0,
        x: opts.x ?? null,
        y: opts.y ?? null,
        active: true,
        lastSeen: now,
        notes: opts.notes ?? null,
      }).run();
    } else {
      db.update(bleGatewayNodes).set({
        ...opts,
        lastSeen: now,
      }).where(eq(bleGatewayNodes.nodeId, nodeId)).run();
    }
    return db.select().from(bleGatewayNodes).where(eq(bleGatewayNodes.nodeId, nodeId)).get();
  }

  function touchGatewayNode(nodeId: string) {
    const now = new Date().toISOString();
    const existing = db.select().from(bleGatewayNodes).where(eq(bleGatewayNodes.nodeId, nodeId)).get();
    if (existing) {
      db.update(bleGatewayNodes).set({ lastSeen: now }).where(eq(bleGatewayNodes.nodeId, nodeId)).run();
    } else {
      db.insert(bleGatewayNodes).values({
        nodeId, room: null, floor: 0, x: null, y: null,
        active: true, lastSeen: now, notes: null,
      }).run();
    }
  }

  // ---- Stats ----

  function getStats() {
    const all = db.select().from(bleDevices).all();
    const home = all.filter((d) => d.ownership === "home");
    const neighbor = all.filter((d) => d.ownership === "neighbor");
    const unknown = all.filter((d) => d.ownership === "unknown");

    return {
      total: all.length,
      home: home.length,
      neighbor: neighbor.length,
      unknown: unknown.length,
      protocols: [...new Set(home.filter((d) => d.protocol).map((d) => d.protocol))],
    };
  }

  return {
    handleDiscovery,
    handleBatchUpdate,
    getAllDevices,
    getHomeDevices,
    getDevice,
    getDevicesByOwnership,
    claimDevice,
    updateDevice,
    setCapabilities,
    getAutoClaimRules,
    addAutoClaimRule,
    deleteAutoClaimRule,
    getGatewayNodes,
    upsertGatewayNode,
    touchGatewayNode,
    getStats,
  };
}
