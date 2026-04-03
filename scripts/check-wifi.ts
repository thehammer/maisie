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

const wlans = await unifi.getWlanConf();
for (const w of wlans as any[]) {
  console.log(JSON.stringify({
    name: w.name,
    _id: w._id,
    enabled: w.enabled,
    security: w.security,
    wpa_mode: w.wpa_mode,
    wpa_enc: w.wpa_enc,
    networkconf_id: w.networkconf_id,
    is_guest: w.is_guest,
    hide_ssid: w.hide_ssid,
    band: w.wlanband,
    pmf_mode: w.pmf_mode,
    fast_roaming_enabled: w.fast_roaming_enabled,
    group_rekey: w.group_rekey,
    ap_group_ids: w.ap_group_ids,
  }, null, 2));
  console.log("---");
}
