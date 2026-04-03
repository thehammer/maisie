import type { createUniFiClient } from "./unifi-client";
import { lookupOui } from "./oui-lookup";
import { devices } from "../../services/schema";

type Db = ReturnType<typeof import("../../services/db").initDb>;
type UniFi = ReturnType<typeof createUniFiClient>;

interface AuditReport {
  timestamp: string;
  summary: {
    totalDevices: number;
    byStatus: Record<string, number>;
    byNetwork: Record<string, number>;
    byManufacturer: Record<string, number>;
  };
  networkHealth: {
    wan: { status: string; ip?: string };
    aps: { name: string; status: string; clients: number; load?: number }[];
    switches: { name: string; status: string; ports?: number }[];
  };
  vlans: {
    name: string;
    id: string;
    purpose?: string;
    deviceCount: number;
  }[];
  firewallRules: {
    name: string;
    action: string;
    enabled: boolean;
    src: string;
    dst: string;
  }[];
  clientHealth: {
    weakSignal: { mac: string; hostname: string | null; signal: number; ap: string }[];
    unidentified: { mac: string; ip: string | null; hostname: string | null; network: string | null }[];
  };
  recommendations: string[];
}

export async function runNetworkAudit(db: Db, unifi: UniFi): Promise<AuditReport> {
  // Pull data sequentially to avoid overwhelming the UDM
  const clients = await unifi.getActiveClients();
  const infraDevices = await unifi.getDevices();
  const health = await unifi.getHealth();
  const networks = await unifi.getNetworks();
  const firewallRules = await unifi.getFirewallRules();

  // Enrich inventory with OUI data
  const allDevices = db.select().from(devices).all();
  const byStatus: Record<string, number> = {};
  const byNetwork: Record<string, number> = {};
  const byManufacturer: Record<string, number> = {};

  for (const d of allDevices) {
    byStatus[d.status || "unknown"] = (byStatus[d.status || "unknown"] || 0) + 1;

    const net = d.networkSegment || "unassigned";
    byNetwork[net] = (byNetwork[net] || 0) + 1;

    const mfr = d.ouiManufacturer || lookupOui(d.mac) || "Unknown";
    byManufacturer[mfr] = (byManufacturer[mfr] || 0) + 1;
  }

  // Network health
  const wanHealth = health.find((h: any) => h.subsystem === "wan");
  const wlanHealth = health.find((h: any) => h.subsystem === "wlan");

  const aps = infraDevices
    .filter((d: any) => d.type === "uap")
    .map((ap: any) => ({
      name: ap.name || ap.mac,
      status: ap.state === 1 ? "online" : "offline",
      clients: clients.filter((c: any) => c.ap_mac === ap.mac).length,
      load: ap["system-stats"]?.cpu ? Number(ap["system-stats"].cpu) : undefined,
    }));

  const switches = infraDevices
    .filter((d: any) => d.type === "usw")
    .map((sw: any) => ({
      name: sw.name || sw.mac,
      status: sw.state === 1 ? "online" : "offline",
      ports: sw.port_table?.length,
    }));

  // VLAN/network info
  const vlans = networks.map((n: any) => ({
    name: n.name,
    id: n.vlan || n._id,
    purpose: n.purpose,
    deviceCount: clients.filter((c: any) => c.network === n.name || c.network_id === n._id).length,
  }));

  // Firewall rules
  const fwRules = firewallRules.map((r: any) => ({
    name: r.name || r._id,
    action: r.action,
    enabled: r.enabled ?? true,
    src: r.src_networkconf_id || r.src_address || "any",
    dst: r.dst_networkconf_id || r.dst_address || "any",
  }));

  // Client health analysis
  const weakSignal = clients
    .filter((c: any) => c.rssi !== undefined && c.rssi < 20)
    .map((c: any) => ({
      mac: c.mac,
      hostname: c.hostname || c.name || null,
      signal: c.rssi,
      ap: aps.find((ap: any) => ap.name && clients.some((cl: any) => cl.ap_mac && cl.mac === c.mac))?.name || "unknown",
    }));

  const unidentified = allDevices
    .filter((d) => {
      const mfr = d.ouiManufacturer || lookupOui(d.mac);
      return !mfr && !d.hostname;
    })
    .map((d) => ({
      mac: d.mac,
      ip: d.ip,
      hostname: d.hostname,
      network: d.networkSegment,
    }));

  // Build recommendations
  const recommendations: string[] = [];

  // Check for devices on main network that look like IoT
  const iotKeywords = /tv|roku|firestick|echo|alexa|nest|ring|wyze|plug|bulb|hue|sonos|roomba|klipsch|lgweb/i;
  const mainNetDevices = clients.filter((c: any) => {
    const name = c.hostname || c.name || "";
    return iotKeywords.test(name) && (c.network === "Default" || c.network === "LAN" || !c.network);
  });
  if (mainNetDevices.length > 0) {
    recommendations.push(
      `${mainNetDevices.length} IoT-like device(s) on main network — consider moving to an IoT VLAN: ${mainNetDevices.map((c: any) => c.hostname || c.name || c.mac).join(", ")}`,
    );
  }

  // Check for weak signals
  if (weakSignal.length > 0) {
    recommendations.push(
      `${weakSignal.length} client(s) with weak WiFi signal (RSSI < 20). May need AP repositioning or additional coverage.`,
    );
  }

  // Check for unidentified devices
  if (unidentified.length > 0) {
    recommendations.push(
      `${unidentified.length} device(s) with no hostname and unknown manufacturer — investigate and label these.`,
    );
  }

  // Check AP load balance
  if (aps.length > 1) {
    const maxClients = Math.max(...aps.map((a) => a.clients));
    const minClients = Math.min(...aps.map((a) => a.clients));
    if (maxClients > minClients * 3 && maxClients > 10) {
      recommendations.push(
        `AP load imbalance: busiest AP has ${maxClients} clients, quietest has ${minClients}. Consider adjusting radio power or band steering.`,
      );
    }
  }

  // Check if IoT VLAN exists
  const hasIotVlan = networks.some((n: any) =>
    /iot/i.test(n.name),
  );
  if (!hasIotVlan) {
    recommendations.push(
      "No IoT VLAN detected. Creating a dedicated IoT network with client isolation improves security.",
    );
  }

  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalDevices: allDevices.length,
      byStatus,
      byNetwork,
      byManufacturer,
    },
    networkHealth: {
      wan: {
        status: wanHealth?.status || "unknown",
        ip: wanHealth?.wan_ip,
      },
      aps,
      switches,
    },
    vlans,
    firewallRules: fwRules,
    clientHealth: { weakSignal, unidentified },
    recommendations,
  };
}

export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [];

  lines.push("# Maisie Network Audit Report");
  lines.push(`Generated: ${report.timestamp}\n`);

  // Summary
  lines.push("## Summary");
  lines.push(`- **Total devices:** ${report.summary.totalDevices}`);
  lines.push(`- **By status:** ${Object.entries(report.summary.byStatus).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  lines.push("");

  // Devices by network
  lines.push("## Devices by Network");
  for (const [net, count] of Object.entries(report.summary.byNetwork).sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${net}:** ${count} devices`);
  }
  lines.push("");

  // Top manufacturers
  lines.push("## Top Manufacturers");
  const mfrEntries = Object.entries(report.summary.byManufacturer).sort((a, b) => b[1] - a[1]);
  for (const [mfr, count] of mfrEntries.slice(0, 15)) {
    lines.push(`- **${mfr}:** ${count}`);
  }
  if (mfrEntries.length > 15) lines.push(`- ... and ${mfrEntries.length - 15} more`);
  lines.push("");

  // Network health
  lines.push("## Network Health");
  lines.push(`- **WAN:** ${report.networkHealth.wan.status}${report.networkHealth.wan.ip ? ` (${report.networkHealth.wan.ip})` : ""}`);
  lines.push("");

  if (report.networkHealth.aps.length > 0) {
    lines.push("### Access Points");
    for (const ap of report.networkHealth.aps) {
      lines.push(`- **${ap.name}:** ${ap.status} — ${ap.clients} clients${ap.load !== undefined ? ` — CPU: ${ap.load}%` : ""}`);
    }
    lines.push("");
  }

  if (report.networkHealth.switches.length > 0) {
    lines.push("### Switches");
    for (const sw of report.networkHealth.switches) {
      lines.push(`- **${sw.name}:** ${sw.status}${sw.ports ? ` — ${sw.ports} ports` : ""}`);
    }
    lines.push("");
  }

  // VLANs
  if (report.vlans.length > 0) {
    lines.push("## Networks / VLANs");
    for (const v of report.vlans) {
      lines.push(`- **${v.name}** (${v.purpose || "network"}): ${v.deviceCount} active clients`);
    }
    lines.push("");
  }

  // Firewall rules
  if (report.firewallRules.length > 0) {
    lines.push("## Firewall Rules");
    for (const r of report.firewallRules) {
      const state = r.enabled ? "" : " [DISABLED]";
      lines.push(`- **${r.name}:** ${r.action} — src: ${r.src} → dst: ${r.dst}${state}`);
    }
    lines.push("");
  }

  // Client health
  if (report.clientHealth.weakSignal.length > 0) {
    lines.push("## Weak Signal Clients");
    for (const c of report.clientHealth.weakSignal) {
      lines.push(`- **${c.hostname || c.mac}:** RSSI ${c.signal}`);
    }
    lines.push("");
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push("## Recommendations");
    for (const r of report.recommendations) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
