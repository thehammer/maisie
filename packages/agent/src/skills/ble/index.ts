/**
 * BLE Skill — Bluetooth Low Energy device discovery and control.
 *
 * Coordinates:
 * - Registry (SQLite) for device persistence and ownership tracking
 * - MQTT bridge for communication with the BLE gateway process
 * - Auto-claim rules for automatic device classification
 */

import { createBleRegistry } from "./registry";
import { createBleMqttBridge } from "./mqtt-bridge";
import { bleAutoClaimRules } from "../../services/schema";

type Db = ReturnType<typeof import("../../services/db").initDb>;

/** Default auto-claim rules for known device types. */
const DEFAULT_RULES = [
  {
    companyId: 0x4e53,
    namePattern: null,
    minPersistence: null,
    ownership: "home",
    label: null,
    protocol: "sleepnumber",
  },
  {
    companyId: 0x8843,
    namePattern: null,
    minPersistence: null,
    ownership: "home",
    label: null,
    protocol: "govee",
  },
  {
    companyId: 0x8803,
    namePattern: null,
    minPersistence: null,
    ownership: "home",
    label: null,
    protocol: "govee",
  },
  {
    companyId: null,
    namePattern: "Hatch*",
    minPersistence: null,
    ownership: "home",
    label: null,
    protocol: null,
  },
  {
    companyId: null,
    namePattern: "*HALO*",
    minPersistence: null,
    ownership: "home",
    label: null,
    protocol: null,
  },
  {
    companyId: 0x07fa,
    namePattern: null,
    minPersistence: null,
    ownership: "home",
    label: null,
    protocol: null,
  },
];

/** Seed default auto-claim rules if the table is empty. */
function seedAutoClaimRules(db: Db) {
  const existing = db.select().from(bleAutoClaimRules).all();
  if (existing.length > 0) return;

  const now = new Date().toISOString();
  for (const rule of DEFAULT_RULES) {
    db.insert(bleAutoClaimRules)
      .values({ ...rule, createdAt: now })
      .run();
  }
}

export function initBleSkill(db: Db) {
  // Seed default rules on first run
  seedAutoClaimRules(db);

  const registry = createBleRegistry(db);
  const bridge = createBleMqttBridge(registry);

  // Start listening for MQTT events from the gateway
  bridge.start();

  return { registry, bridge };
}
