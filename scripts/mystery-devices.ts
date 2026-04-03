import { join } from "path";

const envPath = join(import.meta.dir, "..", ".env");
const envText = await Bun.file(envPath).text();
for (const line of envText.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  process.env[trimmed.substring(0, eq)] = trimmed.substring(eq + 1);
}

import { createUniFiClientFromEnv } from "../packages/agent/src/skills/network/unifi-client";
const unifi = createUniFiClientFromEnv();
if (!unifi) { console.error("Not configured"); process.exit(1); }
await unifi.login();

const MYSTERY_MACS = [
  "ac:80:0a:68:d6:20", // Sony unnamed
  "80:99:e7:75:d9:c9", // Unknown wired
];

// Check active clients for full details
const clients = await unifi.getActiveClients();
for (const mac of MYSTERY_MACS) {
  const c = (clients as any[]).find((cl: any) => cl.mac === mac);
  if (c) {
    console.log(`=== ${mac} (active client) ===`);
    console.log(JSON.stringify({
      name: c.name,
      hostname: c.hostname,
      ip: c.ip,
      oui: c.oui,
      network: c.network,
      is_wired: c.is_wired,
      sw_mac: c.sw_mac,
      sw_port: c.sw_port,
      uptime: c.uptime ? `${(c.uptime / 3600).toFixed(1)}h` : undefined,
      last_seen: c.last_seen ? new Date(c.last_seen * 1000).toISOString() : undefined,
      first_seen: c.first_seen ? new Date(c.first_seen * 1000).toISOString() : undefined,
      tx_bytes: c.tx_bytes,
      rx_bytes: c.rx_bytes,
      wired_rate_mbps: c["wired-tx_rate"] || c.wired_rate_mbps,
    }, null, 2));
    console.log("---");
  }
}

await new Promise(r => setTimeout(r, 2000));

// Also check all users for historical info
const allUsers = await unifi.getAllUsers();
for (const mac of MYSTERY_MACS) {
  const u = (allUsers as any[]).find((ul: any) => ul.mac === mac);
  if (u) {
    console.log(`=== ${mac} (user record) ===`);
    console.log(JSON.stringify({
      name: u.name,
      hostname: u.hostname,
      oui: u.oui,
      first_seen: u.first_seen ? new Date(u.first_seen * 1000).toISOString() : undefined,
      last_seen: u.last_seen ? new Date(u.last_seen * 1000).toISOString() : undefined,
      noted: u.noted,
      note: u.note,
      use_fixedip: u.use_fixedip,
      fixed_ip: u.fixed_ip,
      network_id: u.network_id,
    }, null, 2));
    console.log("---");
  }
}

await new Promise(r => setTimeout(r, 2000));

// Get devices to map switch MACs to names
const devices = await unifi.getDevices();
const switchMap = new Map((devices as any[]).map((d: any) => [d.mac, d.name || d.hostname || d.model]));

// Show which switch/port they're on
for (const mac of MYSTERY_MACS) {
  const c = (clients as any[]).find((cl: any) => cl.mac === mac);
  if (c?.sw_mac) {
    const switchName = switchMap.get(c.sw_mac) || c.sw_mac;
    console.log(`${mac} → connected to switch "${switchName}" port ${c.sw_port}`);
  }
}
