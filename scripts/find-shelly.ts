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

// Get all clients and look for Shelly devices
const clients = await unifi.getActiveClients();
const shellys = (clients as any[]).filter((c: any) => {
  const name = (c.name || c.hostname || "").toLowerCase();
  const oui = (c.oui || "").toLowerCase();
  return name.includes("shelly") || oui.includes("shelly") || name.includes("front");
});

console.log(`Found ${shellys.length} Shelly/front matches:\n`);
for (const c of shellys) {
  console.log(JSON.stringify({
    name: c.name,
    hostname: c.hostname,
    mac: c.mac,
    ip: c.ip,
    oui: c.oui,
    network: c.network,
    is_wired: c.is_wired,
    network_id: c.network_id,
  }, null, 2));
  console.log("---");
}

// Also check all users (including offline) for Shelly
await new Promise(r => setTimeout(r, 2000));
const allUsers = await unifi.getAllUsers();
const shellyUsers = (allUsers as any[]).filter((c: any) => {
  const name = (c.name || c.hostname || "").toLowerCase();
  const oui = (c.oui || "").toLowerCase();
  return name.includes("shelly") || oui.includes("shelly") || name.includes("front");
});

if (shellyUsers.length > shellys.length) {
  console.log(`\nAll known Shelly/front devices (including offline):\n`);
  for (const c of shellyUsers) {
    console.log(JSON.stringify({
      name: c.name,
      hostname: c.hostname,
      mac: c.mac,
      oui: c.oui,
      network_id: c.network_id,
    }, null, 2));
    console.log("---");
  }
}
