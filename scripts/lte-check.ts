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
  if (!unifi) { console.error("UniFi not configured"); process.exit(1); }
  await unifi.login();

  // Get full device details for the LTE device
  const devices = await unifi.getDevices();
  const lte = devices.find((d: any) => d.model === "ULTEPUS" || d.name?.includes("AT&T"));

  if (!lte) {
    console.log("LTE device not found");
    return;
  }

  // Dump everything about the LTE device
  console.log("=== LTE Device Full Details ===");
  console.log(JSON.stringify(lte, null, 2));
}

main().catch(console.error);
