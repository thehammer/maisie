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

// Known IoT device patterns
const iotPatterns = [
  "shelly", "ecobee", "ring", "plug", "switch", "smart", "hue", "wemo",
  "sonos", "roku", "chromecast", "nest", "arlo", "wyze", "tuya", "meross",
  "kasa", "tapo", "lifx", "nanoleaf", "homebridge", "esp", "tasmota",
  "bambu", "printer", "canon", "epson", "brother", "hp-", "xbox", "playstation",
  "nintendo", "appletv", "apple-tv", "homepod", "echo", "alexa", "google-home",
  "roomba", "irobot", "dyson", "samsung", "lg-", "vizio", "tivo", "hdhr",
  "sleepiq", "sleep-number", "tesmart", "dakboard",
];

// Known non-IoT OUIs (computers, phones, tablets)
const trustedOuis = ["apple", "intel", "dell", "lenovo", "microsoft"];

const defaultClients = (clients as any[]).filter((c: any) => c.network === "Default");
const iotClients = (clients as any[]).filter((c: any) => c.network === "IoT");

console.log(`=== Already on IoT VLAN (${iotClients.length}) ===`);
for (const c of iotClients) {
  console.log(`  ${c.name || c.hostname || "unnamed"} — ${c.ip} (${c.oui || "unknown"}) ${c.is_wired ? "wired" : "wifi"}`);
}

console.log(`\n=== On Default Network (${defaultClients.length}) ===`);

const candidates: any[] = [];
const trusted: any[] = [];

for (const c of defaultClients) {
  const name = (c.name || c.hostname || "").toLowerCase();
  const oui = (c.oui || "").toLowerCase();
  const isIot = iotPatterns.some(p => name.includes(p) || oui.includes(p));
  const isTrusted = trustedOuis.some(p => oui.includes(p)) && !isIot;

  if (isIot) {
    candidates.push(c);
  } else if (!isTrusted) {
    candidates.push(c); // Unknown devices are also candidates
  } else {
    trusted.push(c);
  }
}

console.log(`\n--- IoT Migration Candidates (${candidates.length}) ---`);
for (const c of candidates) {
  const name = c.name || c.hostname || "unnamed";
  const oui = c.oui || "unknown";
  const conn = c.is_wired ? "wired" : `wifi (${c.essid})`;
  console.log(`  ${name} — ${c.ip} — ${oui} — ${conn} — MAC: ${c.mac}`);
}

console.log(`\n--- Trusted / Stay on Default (${trusted.length}) ---`);
for (const c of trusted) {
  const name = c.name || c.hostname || "unnamed";
  const oui = c.oui || "unknown";
  const conn = c.is_wired ? "wired" : `wifi (${c.essid})`;
  console.log(`  ${name} — ${c.ip} — ${oui} — ${conn}`);
}
