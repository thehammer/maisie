import { eq } from "drizzle-orm";
import { devices } from "../../services/schema";
import { publish } from "../../services/mqtt";
import { TOPICS } from "../../topics";
import { lookupOui } from "./oui-lookup";
import type { createUniFiClient } from "./unifi-client";

type Db = ReturnType<typeof import("../../services/db").initDb>;
type UniFi = ReturnType<typeof createUniFiClient>;

export async function syncDevices(db: Db, unifi: UniFi) {
  const clients = await unifi.getActiveClients();
  const now = new Date().toISOString();

  let newCount = 0;
  let updatedCount = 0;

  for (const client of clients) {
    const existing = db
      .select()
      .from(devices)
      .where(eq(devices.mac, client.mac))
      .get();

    if (!existing) {
      // New device — prefer our OUI lookup (UniFi truncates to 8 chars)
      const oui = lookupOui(client.mac) || client.oui || null;
      db.insert(devices)
        .values({
          mac: client.mac,
          ip: client.ip,
          hostname: client.hostname || client.name || null,
          ouiManufacturer: oui,
          networkSegment: client.network || null,
          status: "new",
          firstSeen: now,
          lastSeen: now,
        })
        .run();

      publish(TOPICS.network.devices.new, {
        mac: client.mac,
        ip: client.ip,
        hostname: client.hostname || client.name,
        manufacturer: client.oui,
        network: client.network,
        timestamp: now,
      });

      newCount++;
    } else {
      // Update existing device — prefer our OUI lookup over UniFi's truncated names
      const oui = lookupOui(client.mac) || existing.ouiManufacturer || client.oui || null;
      db.update(devices)
        .set({
          ip: client.ip,
          hostname: client.hostname || client.name || existing.hostname,
          ouiManufacturer: oui,
          networkSegment: client.network || existing.networkSegment,
          lastSeen: now,
        })
        .where(eq(devices.mac, client.mac))
        .run();

      updatedCount++;
    }
  }

  // Check for missing devices (seen before but not in current client list)
  const knownDevices = db.select().from(devices).all();
  const activeMACs = new Set(clients.map((c) => c.mac));

  for (const device of knownDevices) {
    if (!activeMACs.has(device.mac) && device.status !== "blocked") {
      const lastSeen = new Date(device.lastSeen);
      const minutesAgo = (Date.now() - lastSeen.getTime()) / 60_000;

      // Only alert if device was seen recently (within last hour) and is now gone
      if (minutesAgo < 60) {
        publish(TOPICS.network.devices.missing, {
          mac: device.mac,
          ip: device.ip,
          hostname: device.hostname,
          lastSeen: device.lastSeen,
          timestamp: now,
        });
      }
    }
  }

  return { newCount, updatedCount, totalActive: clients.length };
}
