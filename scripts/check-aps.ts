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

const devices = await unifi.getDevices();
const aps = (devices as any[]).filter((d: any) => d.type === "uap");

for (const ap of aps) {
  console.log(`=== ${ap.name || ap.hostname || ap.model} ===`);
  console.log(`  Model: ${ap.model}`);
  console.log(`  IP: ${ap.ip}`);
  console.log(`  State: ${ap.state === 1 ? "online" : ap.state}`);
  console.log(`  Uptime: ${(ap.uptime / 3600).toFixed(1)}h`);
  console.log(`  Clients: ${ap.num_sta || 0}`);

  if (ap.radio_table) {
    for (const radio of ap.radio_table) {
      const band = radio.radio === "ng" ? "2.4GHz" : radio.radio === "na" ? "5GHz" : radio.radio;
      console.log(`  ${band}: channel=${radio.channel}, tx_power=${radio.tx_power}, tx_power_mode=${radio.tx_power_mode}`);
      if (radio.is_disabled) console.log(`    *** DISABLED ***`);
    }
  }

  if (ap.radio_table_stats) {
    for (const rs of ap.radio_table_stats) {
      const band = rs.radio === "ng" ? "2.4GHz" : rs.radio === "na" ? "5GHz" : rs.radio;
      console.log(`  ${band} stats: satisfaction=${rs.satisfaction}, num_sta=${rs.num_sta}, channel=${rs.channel}`);
    }
  }

  console.log("");
}
