import { join } from "path";

// Load .env manually using Bun's file API
const envPath = join(import.meta.dir, "..", ".env");
const envText = await Bun.file(envPath).text();
for (const line of envText.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.substring(0, eq);
  const val = trimmed.substring(eq + 1);
  process.env[key] = val;
}

import { createUniFiClientFromEnv } from "../packages/agent/src/skills/network/unifi-client";
import { lookupOui, ensureOuiDatabase } from "../packages/agent/src/skills/network/oui-lookup";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  await ensureOuiDatabase();
  const unifi = createUniFiClientFromEnv();
  if (!unifi) { console.error("UniFi not configured"); process.exit(1); }

  await unifi.login();
  console.log("Logged in to UDM Pro\n");

  // 1. Active clients
  console.log("Fetching active clients...");
  const clients = await unifi.getActiveClients();
  console.log(`  ${clients.length} active clients\n`);
  await sleep(2000);

  // 2. Infrastructure devices
  console.log("Fetching infrastructure devices...");
  const devices = await unifi.getDevices();
  console.log(`  ${devices.length} infrastructure devices\n`);
  await sleep(2000);

  // 3. Health
  console.log("Fetching health...");
  const health = await unifi.getHealth();
  await sleep(2000);

  // 4. Networks/VLANs
  console.log("Fetching networks...");
  const networks = await unifi.getNetworks();
  console.log(`  ${networks.length} networks\n`);
  await sleep(2000);

  // 5. Firewall rules
  console.log("Fetching firewall rules...");
  const fwRules = await unifi.getFirewallRules();
  console.log(`  ${fwRules.length} firewall rules\n`);
  await sleep(2000);

  // 6. Port forwards
  console.log("Fetching port forwards...");
  const portForwards = await unifi.getPortForwards();
  console.log(`  ${portForwards.length} port forwards\n`);
  await sleep(2000);

  // 7. Site settings (IPS/IDS, etc.)
  console.log("Fetching site settings...");
  const settings = await unifi.getSiteSettings();
  await sleep(2000);

  // 8. WiFi networks
  console.log("Fetching WiFi networks...");
  const wlans = await unifi.getWlanConf();
  console.log(`  ${wlans.length} WiFi networks\n`);
  await sleep(2000);

  // 9. Routing
  console.log("Fetching routing...");
  const routing = await unifi.getRouting();
  console.log(`  ${routing.length} routes\n`);
  await sleep(2000);

  // 10. Sysinfo
  console.log("Fetching sysinfo...");
  const sysinfo = await unifi.getFullSysinfo();
  await sleep(1000);

  console.log("All data collected. Analyzing...\n");
  console.log("=".repeat(60));

  // === ANALYSIS ===

  // --- WAN ---
  const wan = health.find((h: any) => h.subsystem === "wan");
  console.log("\n## WAN");
  console.log(`  Status: ${wan?.status}`);
  console.log(`  IP: ${wan?.wan_ip}`);
  console.log(`  Gateways: ${(wan?.gateways || []).join(", ")}`);
  console.log(`  ISP: ${(wan as any)?.isp_name || "unknown"}`);
  console.log(`  Download: ${(wan as any)?.xput_down || "?"} Mbps`);
  console.log(`  Upload: ${(wan as any)?.xput_up || "?"} Mbps`);

  // --- Networks/VLANs ---
  console.log("\n## Networks / VLANs");
  for (const n of networks) {
    const clientCount = clients.filter((c: any) => c.network === n.name || c.network_id === n._id).length;
    console.log(`  ${n.name} | VLAN ${n.vlan || "none"} | purpose: ${n.purpose} | subnet: ${n.ip_subnet || "n/a"} | ${clientCount} active clients | DHCP: ${n.dhcpd_enabled ? "on" : "off"} | DNS: ${n.dhcpd_dns_1 || "default"}`);
  }

  // --- WiFi ---
  console.log("\n## WiFi Networks (SSIDs)");
  for (const w of wlans) {
    console.log(`  ${w.name} | enabled: ${w.enabled} | security: ${w.security} | band: ${w.wlan_band || "auto"} | hidden: ${w.hide_ssid || false} | guest: ${w.is_guest || false}`);
    if (w.mac_filter_enabled) console.log(`    MAC filter: ${w.mac_filter_policy} (${w.mac_filter_list?.length || 0} entries)`);
    if (w.fast_roaming_enabled) console.log(`    Fast roaming (802.11r): enabled`);
    if (w.bss_transition) console.log(`    BSS transition (802.11v): enabled`);
  }

  // --- IPS/IDS ---
  console.log("\n## Security Settings");
  const ips = settings.find((s: any) => s.key === "ips");
  if (ips) {
    console.log(`  IPS/IDS enabled: ${ips.ips_enabled || false}`);
    console.log(`  IPS mode: ${ips.ips_mode || "n/a"}`);
    if (ips.dns_filtering) console.log(`  DNS filtering: ${JSON.stringify(ips.dns_filtering)}`);
    if (ips.honeypot_enabled) console.log(`  Honeypot: enabled`);
  } else {
    console.log("  IPS settings not found");
  }

  const threatMgmt = settings.find((s: any) => s.key === "threat_management");
  if (threatMgmt) {
    console.log(`  Threat management enabled: ${threatMgmt.enabled || false}`);
    console.log(`  Mode: ${threatMgmt.mode || "n/a"}`);
  }

  const dpiSetting = settings.find((s: any) => s.key === "dpi");
  if (dpiSetting) {
    console.log(`  DPI: ${dpiSetting.enabled ? "enabled" : "disabled"}`);
  }

  // Dump all setting keys for visibility
  console.log(`\n  All site setting keys: ${settings.map((s: any) => s.key).join(", ")}`);

  // --- Firewall ---
  console.log("\n## Firewall Rules");
  if (fwRules.length === 0) {
    console.log("  No custom firewall rules");
  }
  for (const r of fwRules) {
    const state = r.enabled !== false ? "" : " [DISABLED]";
    console.log(`  ${r.name || r._id} | ${r.action} | ruleset: ${r.ruleset} | proto: ${r.protocol || "all"} | src: ${r.src_networkconf_id || r.src_address || "any"} → dst: ${r.dst_networkconf_id || r.dst_address || "any"}${state}`);
  }

  // --- Port Forwards ---
  console.log("\n## Port Forwards");
  if (portForwards.length === 0) {
    console.log("  No port forwards");
  }
  for (const pf of portForwards) {
    const state = pf.enabled !== false ? "" : " [DISABLED]";
    console.log(`  ${pf.name || "unnamed"} | ${pf.proto || "tcp"}:${pf.dst_port} → ${pf.fwd}:${pf.fwd_port}${state}`);
  }

  // --- Routing ---
  console.log("\n## Static Routes");
  if (routing.length === 0) {
    console.log("  No static routes");
  }
  for (const r of routing) {
    console.log(`  ${r.name || "unnamed"} | ${r.type} | ${r.static_route_network || "?"} via ${r.static_route_nexthop || r.interface || "?"}${r.enabled === false ? " [DISABLED]" : ""}`);
  }

  // --- AP Analysis ---
  console.log("\n## Access Points");
  const aps = devices.filter((d: any) => d.type === "uap");
  for (const ap of aps) {
    const apClients = clients.filter((c: any) => c.ap_mac === ap.mac);
    const cpu = (ap as any)["system-stats"]?.cpu || "?";
    const mem = (ap as any)["system-stats"]?.mem || "?";
    const channels = (ap as any).radio_table?.map((r: any) => `${r.radio}:ch${r.channel}@${r.tx_power}dBm`).join(", ") || "?";
    console.log(`  ${ap.name || ap.mac} | ${ap.model} | fw ${ap.version} | ${ap.state === 1 ? "online" : "OFFLINE"} | CPU: ${cpu}% | RAM: ${mem}% | ${apClients.length} clients`);
    console.log(`    Channels: ${channels}`);
    if ((ap as any).uptime) console.log(`    Uptime: ${((ap as any).uptime / 86400).toFixed(1)} days`);
  }

  // --- Switch Analysis ---
  console.log("\n## Switches");
  const switches = devices.filter((d: any) => d.type === "usw");
  for (const sw of switches) {
    const state = sw.state === 1 ? "online" : "OFFLINE";
    const portCount = (sw as any).port_table?.length || 0;
    const usedPorts = (sw as any).port_table?.filter((p: any) => p.up).length || 0;
    console.log(`  ${sw.name || sw.mac} | ${sw.model} | ${state} | ports: ${usedPorts}/${portCount} | fw ${sw.version}`);
    if ((sw as any).uptime) console.log(`    Uptime: ${((sw as any).uptime / 86400).toFixed(1)} days`);
  }

  // --- Gateway ---
  console.log("\n## Gateway");
  const gw = devices.find((d: any) => d.type === "ugw" || d.type === "udm");
  if (gw) {
    const cpu = (gw as any)["system-stats"]?.cpu || "?";
    const mem = (gw as any)["system-stats"]?.mem || "?";
    const temp = (gw as any).temperatures?.find((t: any) => t.name === "CPU")?.value || "?";
    console.log(`  ${gw.name || gw.mac} | ${gw.model} | fw ${gw.version}`);
    console.log(`  CPU: ${cpu}% | RAM: ${mem}% | Temp: ${temp}°C`);
    if ((gw as any).uptime) console.log(`  Uptime: ${((gw as any).uptime / 86400).toFixed(1)} days`);
    if ((gw as any).wan1) {
      const w1 = (gw as any).wan1;
      console.log(`  WAN1: ${w1.type || "?"} | IP: ${w1.ip} | speed: ${w1.speed || "?"}Mbps | full_duplex: ${w1.full_duplex}`);
    }
    if ((gw as any).wan2) {
      const w2 = (gw as any).wan2;
      console.log(`  WAN2: ${w2.type || "?"} | IP: ${w2.ip || "none"} | speed: ${w2.speed || "?"}Mbps`);
    }
  }

  // --- Client Analysis ---
  console.log("\n## Client Analysis");

  // Completely unidentified
  const unknown = clients.filter((c: any) => {
    const hasName = c.hostname || c.name;
    const hasOui = c.oui || lookupOui(c.mac);
    return !hasName && !hasOui;
  });
  console.log(`\n  Completely unidentified (no hostname, no OUI): ${unknown.length}`);
  for (const c of unknown) {
    console.log(`    ${c.mac} | ${c.ip} | wired: ${c.is_wired} | network: ${c.network || "default"}`);
  }

  // Randomized MACs
  const randomMac = clients.filter((c: any) => {
    const firstByte = parseInt(c.mac.substring(0, 2), 16);
    return (firstByte & 0x02) !== 0;
  });
  console.log(`\n  Randomized MAC addresses: ${randomMac.length}`);
  for (const c of randomMac) {
    const oui = lookupOui(c.mac) || c.oui || "?";
    console.log(`    ${c.mac} | ${c.ip} | ${c.hostname || c.name || "no name"} | OUI: ${oui} | wired: ${c.is_wired}`);
  }

  // IoT on main network
  const iotPatterns = /ecobee|roku|firestick|echo|alexa|nest|ring|wyze|plug|bulb|hue|sonos|roomba|klipsch|lgweb|shelly|espressif|tuya|wemo|lifx|nanoleaf|tp-link|smart.*plug|iot/i;
  const iotOnMain = clients.filter((c: any) => {
    const name = (c.hostname || c.name || "") + " " + (c.oui || lookupOui(c.mac) || "");
    return iotPatterns.test(name) && (!c.network || c.network === "Default" || c.network === "LAN");
  });
  console.log(`\n  IoT devices on main network: ${iotOnMain.length}`);
  for (const c of iotOnMain) {
    const oui = lookupOui(c.mac) || c.oui || "?";
    console.log(`    ${c.mac} | ${c.ip} | ${c.hostname || c.name || "no name"} | OUI: ${oui}`);
  }

  // Weak WiFi signals
  const weakSignal = clients.filter((c: any) => c.rssi !== undefined && c.rssi < 25 && !c.is_wired);
  console.log(`\n  Weak signal clients (RSSI < 25): ${weakSignal.length}`);
  for (const c of weakSignal.sort((a: any, b: any) => a.rssi - b.rssi)) {
    const apName = aps.find((ap: any) => ap.mac === c.ap_mac)?.name || "?";
    console.log(`    RSSI ${c.rssi} | ${c.hostname || c.name || c.mac} | AP: ${apName} | ch ${c.channel || "?"}`);
  }

  // Top bandwidth
  const highBw = clients
    .filter((c: any) => c.tx_bytes !== undefined)
    .sort((a: any, b: any) => ((b.tx_bytes || 0) + (b.rx_bytes || 0)) - ((a.tx_bytes || 0) + (a.rx_bytes || 0)))
    .slice(0, 10);
  console.log(`\n  Top 10 bandwidth consumers (session):`);
  for (const c of highBw) {
    const total = ((c.tx_bytes || 0) + (c.rx_bytes || 0)) / 1e9;
    const up = (c.tx_bytes || 0) / 1e9;
    const down = (c.rx_bytes || 0) / 1e9;
    console.log(`    ${(c.hostname || c.name || c.mac).padEnd(30)} | ${total.toFixed(1)} GB (↑${up.toFixed(1)} ↓${down.toFixed(1)})`);
  }

  // --- Sysinfo ---
  console.log("\n## UDM Sysinfo");
  if (Array.isArray(sysinfo) && sysinfo.length > 0) {
    const sys = sysinfo[0];
    console.log(`  Hostname: ${sys.hostname}`);
    console.log(`  Version: ${sys.version}`);
    console.log(`  Uptime: ${sys.uptime ? (sys.uptime / 86400).toFixed(1) + " days" : "?"}`);
    if (sys.update_available) console.log(`  ⚠ FIRMWARE UPDATE AVAILABLE`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Assessment complete.");
}

main().catch(console.error);
