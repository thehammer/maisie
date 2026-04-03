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

// Device list loaded from config/wired-devices.json (gitignored — contains personal MACs).
// Copy config/wired-devices.example.json to config/wired-devices.json and fill in your device MACs.
const devicesPath = join(import.meta.dir, "..", "config", "wired-devices.json");
const devicesFile = Bun.file(devicesPath);
if (!(await devicesFile.exists())) {
  console.error("config/wired-devices.json not found — copy config/wired-devices.example.json and fill in your device MACs");
  process.exit(1);
}
const WIRED_IOT: Array<{ name: string; mac: string }> = await devicesFile.json();

const unifi = createUniFiClientFromEnv();
if (!unifi) { console.error("UniFi not configured"); process.exit(1); }
await unifi.login();

const clients = await unifi.getActiveClients();

await new Promise(r => setTimeout(r, 2000));

const devices = await unifi.getDevices();
const switchMap = new Map((devices as any[]).map((d: any) => [d.mac, d.name || d.hostname || d.model]));

console.log("Wired IoT devices — switch port assignments:\n");
for (const dev of WIRED_IOT) {
  const c = (clients as any[]).find((cl: any) => cl.mac === dev.mac);
  if (c) {
    const switchName = switchMap.get(c.sw_mac) || c.sw_mac;
    console.log(`${dev.name}`);
    console.log(`  IP: ${c.ip} | Switch: ${switchName} | Port: ${c.sw_port}`);
    console.log(`  → Change port ${c.sw_port} on "${switchName}" to IoT network`);
    console.log("");
  } else {
    console.log(`${dev.name} — NOT ONLINE`);
    console.log("");
  }
}
