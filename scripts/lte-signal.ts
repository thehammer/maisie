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

async function main() {
  const unifi = createUniFiClientFromEnv();
  if (!unifi) { console.error("Not configured"); process.exit(1); }
  await unifi.login();
  const devices = await unifi.getDevices();
  const lte = devices.find((d: any) => d.model === "ULTEPUS") as any;
  if (!lte) { console.log("LTE not found"); return; }

  console.log("=== LTE Signal After Reboot ===");
  console.log(`Signal:    ${lte.lte_signal}`);
  console.log(`Band:      ${lte.lte_band}`);
  console.log(`Mode:      ${lte.lte_mode}`);
  console.log(`RSSI:      ${lte.lte_rssi} dBm`);
  console.log(`RSRP:      ${lte.lte_rsrp} dBm`);
  console.log(`RSRQ:      ${lte.lte_rsrq} dB`);
  console.log(`Cell ID:   ${lte.lte_cell_id}`);
  console.log(`RX Chan:   ${lte.lte_rx_chan}`);
  console.log(`TX Chan:   ${lte.lte_tx_chan}`);
  console.log(`Operator:  ${lte.lte_networkoperator}`);
  console.log(`IP:        ${lte.lte_ip}`);
  console.log(`Ext ant:   ${lte.lte_ext_ant}`);
  console.log(`Uptime:    ${(lte.uptime / 60).toFixed(0)} minutes`);

  // Signal quality interpretation
  const rsrp = parseInt(lte.lte_rsrp);
  const rsrq = parseInt(lte.lte_rsrq);
  const rssi = parseInt(lte.lte_rssi);

  console.log("\n=== Signal Interpretation ===");
  if (rsrp >= -80) console.log(`RSRP ${rsrp}: Excellent`);
  else if (rsrp >= -90) console.log(`RSRP ${rsrp}: Good`);
  else if (rsrp >= -100) console.log(`RSRP ${rsrp}: Fair`);
  else if (rsrp >= -110) console.log(`RSRP ${rsrp}: Poor`);
  else console.log(`RSRP ${rsrp}: Very poor / cell edge`);

  if (rsrq >= -10) console.log(`RSRQ ${rsrq}: Good quality`);
  else if (rsrq >= -15) console.log(`RSRQ ${rsrq}: Fair quality`);
  else console.log(`RSRQ ${rsrq}: Poor quality`);

  // Band interpretation
  const band = lte.lte_band;
  if (band === "eutran-4") console.log("Band 4 (1700MHz AWS): Mid-range, moderate penetration");
  else if (band === "eutran-12") console.log("Band 12 (700MHz): Best range and building penetration");
  else if (band === "eutran-14") console.log("Band 14 (FirstNet 700MHz): Best range and building penetration");
  else if (band === "eutran-2") console.log("Band 2 (1900MHz PCS): Mid-range");
  else if (band === "eutran-66") console.log("Band 66 (Extended AWS): Similar to Band 4");
  else console.log(`Band: ${band}`);
}

main().catch(console.error);
