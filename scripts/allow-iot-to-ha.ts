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

const host = process.env.UNIFI_HOST;
const username = process.env.UNIFI_USERNAME;
const password = process.env.UNIFI_PASSWORD;
const site = process.env.UNIFI_SITE || "default";
const baseUrl = `https://${host}`;

let cookies: string[] = [];
let csrfToken: string | null = null;

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: cookies.join("; "),
  };
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) cookies = setCookie.map((c) => c.split(";")[0]);
  const csrf = res.headers.get("x-csrf-token");
  if (csrf) csrfToken = csrf;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

const IOT_NETWORK_ID = process.env.UNIFI_IOT_NETWORK_ID || "";
const HA_IP = process.env.HA_HOST || "";

async function main() {
  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  console.log("Logged in\n");

  // Check existing rules
  const existing = await request(`/proxy/network/api/s/${site}/rest/firewallrule`);
  const existingNames = (existing.data as any[]).map((r: any) => r.name);
  console.log("Existing rules:", existingNames.join(", "));

  await new Promise(r => setTimeout(r, 2000));

  // Allow IoT → HA (for CoIoT push updates, mDNS, HomeKit, etc.)
  // Must have lower rule_index than the block rule (20011) to be evaluated first
  const ruleName = "IoT - Allow to Home Assistant";
  if (existingNames.includes(ruleName)) {
    console.log(`\nRule "${ruleName}" already exists, skipping`);
  } else {
    console.log(`\nCreating: ${ruleName}`);
    const res = await request(`/proxy/network/api/s/${site}/rest/firewallrule`, {
      method: "POST",
      body: JSON.stringify({
        name: ruleName,
        enabled: true,
        action: "accept",
        ruleset: "LAN_IN",
        protocol: "all",
        protocol_match_excepted: false,
        rule_index: 20009,
        src_networkconf_id: IOT_NETWORK_ID,
        src_networkconf_type: "NETv4",
        dst_networkconf_type: "NETv4",
        dst_address: HA_IP,
        state_established: false,
        state_related: false,
        state_new: true,
        state_invalid: false,
      }),
    });
    console.log("  Created:", res.data?.[0]?.name, "- ID:", res.data?.[0]?._id);
  }

  // Verify all rules in order
  await new Promise(r => setTimeout(r, 2000));
  const allRules = await request(`/proxy/network/api/s/${site}/rest/firewallrule`);
  console.log("\n=== Firewall rules (sorted by index) ===");
  const sorted = (allRules.data as any[]).sort((a: any, b: any) => a.rule_index - b.rule_index);
  for (const r of sorted) {
    console.log(`  [${r.rule_index}] ${r.name} — ${r.action} — ${r.enabled ? "enabled" : "disabled"}`);
  }
}

main().catch(console.error);
