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

const clients = await unifi.getActiveClients();
const iot = (clients as any[]).filter((c: any) => c.network === "IoT" || c.essid === "Iaido");
const shelly = (clients as any[]).filter((c: any) => {
  const name = (c.name || c.hostname || "").toLowerCase();
  return name.includes("shelly") || name.includes("front exterior");
});

console.log("=== Clients on IoT network / Iaido SSID ===");
if (iot.length === 0) {
  console.log("(none found)");
} else {
  for (const c of iot) {
    console.log(`  ${c.name || c.hostname} — IP: ${c.ip}, MAC: ${c.mac}, SSID: ${c.essid}, Network: ${c.network}`);
  }
}

console.log("\n=== All Shelly devices ===");
for (const c of shelly) {
  console.log(`  ${c.name || c.hostname} — IP: ${c.ip}, MAC: ${c.mac}, SSID: ${c.essid}, Network: ${c.network}`);
}
