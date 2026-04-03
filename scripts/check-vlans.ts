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

// Get networks
console.log("=== NETWORKS ===");
const networks = await unifi.getNetworks();
for (const n of networks as any[]) {
  console.log(JSON.stringify({
    name: n.name,
    _id: n._id,
    purpose: n.purpose,
    vlan: n.vlan,
    subnet: n.ip_subnet,
    dhcp_enabled: n.dhcpd_enabled,
    dhcp_start: n.dhcpd_start,
    dhcp_stop: n.dhcpd_stop,
    igmp_snooping: n.igmp_snooping,
    mdns_enabled: n.mdns_enabled,
    enabled: n.enabled,
    is_nat: n.is_nat,
    networkgroup: n.networkgroup,
  }, null, 2));
  console.log("---");
}

await new Promise(r => setTimeout(r, 2000));

// Get firewall rules
console.log("\n=== FIREWALL RULES ===");
const rules = await unifi.getFirewallRules();
for (const r of rules as any[]) {
  console.log(JSON.stringify({
    name: r.name,
    _id: r._id,
    enabled: r.enabled,
    action: r.action,
    ruleset: r.ruleset,
    protocol: r.protocol,
    rule_index: r.rule_index,
    src_firewallgroup_ids: r.src_firewallgroup_ids,
    dst_firewallgroup_ids: r.dst_firewallgroup_ids,
    src_networkconf_id: r.src_networkconf_id,
    dst_networkconf_id: r.dst_networkconf_id,
    src_networkconf_type: r.src_networkconf_type,
    dst_networkconf_type: r.dst_networkconf_type,
    dst_address: r.dst_address,
    src_address: r.src_address,
    state_established: r.state_established,
    state_related: r.state_related,
  }, null, 2));
  console.log("---");
}

await new Promise(r => setTimeout(r, 2000));

// Get site settings for mDNS
console.log("\n=== MDNS / MULTICAST SETTINGS ===");
const settings = await unifi.getSiteSettings();
for (const s of settings as any[]) {
  if (s.key === "network_optimization" || s.key === "element_adopt" || s.key === "connectivity") {
    console.log(JSON.stringify(s, null, 2));
    console.log("---");
  }
}
