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

// Look for anything that could be the Gemstone hub - check all names, hostnames, OUIs
// Gemstone Hub2 likely uses ESP32 or Tuya chipset
const candidates = (clients as any[]).filter((c: any) => {
  const name = (c.name || "").toLowerCase();
  const hostname = (c.hostname || "").toLowerCase();
  const oui = (c.oui || "").toLowerCase();
  return name.includes("gem") || hostname.includes("gem") ||
    name.includes("tuya") || hostname.includes("tuya") ||
    name.includes("hub") || hostname.includes("hub") ||
    oui.includes("tuya") || oui.includes("espressif");
});

console.log("=== Possible Gemstone Hub candidates ===\n");
if (candidates.length === 0) {
  console.log("No obvious matches found. Listing all ESP/Tuya/unknown WiFi devices:\n");
  const unknown = (clients as any[]).filter((c: any) => {
    const oui = (c.oui || "").toLowerCase();
    const name = (c.name || c.hostname || "").toLowerCase();
    return (!c.is_wired && (oui.includes("espressi") || oui.includes("tuya") || oui === "" || oui === "unknown" || name.includes("esp") || name.includes("android")));
  });
  for (const c of unknown) {
    console.log(`  ${c.name || c.hostname || "(unnamed)"} — ${c.ip} — ${c.oui || "unknown OUI"} — MAC: ${c.mac} — SSID: ${c.essid}`);
  }
} else {
  for (const c of candidates) {
    console.log(`  ${c.name || c.hostname || "(unnamed)"} — ${c.ip} — ${c.oui || "unknown OUI"} — MAC: ${c.mac} — SSID: ${c.essid}`);
  }
}

// Also check all users (offline too)
await new Promise(r => setTimeout(r, 2000));
const allUsers = await unifi.getAllUsers();
const gemUsers = (allUsers as any[]).filter((u: any) => {
  const name = (u.name || u.hostname || "").toLowerCase();
  return name.includes("gem") || name.includes("tuya");
});
if (gemUsers.length > 0) {
  console.log("\n=== Gemstone/Tuya in all known devices ===");
  for (const u of gemUsers) {
    console.log(`  ${u.name || u.hostname || "(unnamed)"} — ${u.oui} — MAC: ${u.mac}`);
  }
}
