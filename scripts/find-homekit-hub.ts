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
const appletvs = (clients as any[]).filter((c: any) => {
  const name = (c.name || c.hostname || "").toLowerCase();
  const oui = (c.oui || "").toLowerCase();
  return name.includes("apple tv") || name.includes("appletv") || name.includes("homepod") ||
    (oui.includes("apple") && c.is_wired);
});

console.log("=== Apple TVs / HomePods (potential HomeKit hubs) ===\n");
for (const c of appletvs) {
  console.log(`  ${c.name || c.hostname} — ${c.ip} — ${c.is_wired ? "wired" : "wifi"} — Network: ${c.network}`);
}
