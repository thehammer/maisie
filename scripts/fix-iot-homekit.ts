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

const IOT_NETWORK_ID = "5ed389ddc17d801ee36907ad";
const DEFAULT_NETWORK_ID = "5c8aa8bec17d802ee3be7a96";

async function main() {
  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  console.log("Logged in\n");

  // Delete the narrow HA-only rule and replace with a broader one
  const existing = await request(`/proxy/network/api/s/${site}/rest/firewallrule`);
  const haRule = (existing.data as any[]).find((r: any) => r.name === "IoT - Allow to Home Assistant");

  if (haRule) {
    console.log("Deleting narrow HA-only rule...");
    await request(`/proxy/network/api/s/${site}/rest/firewallrule/${haRule._id}`, {
      method: "DELETE",
    });
    console.log("  Deleted\n");
  }

  await new Promise(r => setTimeout(r, 2000));

  // Create a broader rule: Allow IoT to initiate to Main network for
  // HomeKit (HAP), mDNS, CoIoT, and other smart home protocols
  // This is more permissive but necessary for IoT devices to work with
  // HomeKit hubs (Apple TVs) and Home Assistant on the main network
  const ruleName = "IoT - Allow to Main (smart home)";
  const existingNames = (existing.data as any[]).map((r: any) => r.name);

  if (existingNames.includes(ruleName)) {
    console.log(`Rule "${ruleName}" already exists`);
  } else {
    console.log(`Creating: ${ruleName}`);
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
        dst_networkconf_id: DEFAULT_NETWORK_ID,
        dst_networkconf_type: "NETv4",
        state_established: false,
        state_related: false,
        state_new: true,
        state_invalid: false,
      }),
    });
    console.log("  Created:", res.data?.[0]?.name, "- ID:", res.data?.[0]?._id);
  }

  // Verify
  await new Promise(r => setTimeout(r, 2000));
  const allRules = await request(`/proxy/network/api/s/${site}/rest/firewallrule`);
  console.log("\n=== Firewall rules (sorted by index) ===");
  const sorted = (allRules.data as any[]).sort((a: any, b: any) => a.rule_index - b.rule_index);
  for (const r of sorted) {
    console.log(`  [${r.rule_index}] ${r.name} — ${r.action} — ${r.enabled ? "enabled" : "disabled"}`);
  }
}

main().catch(console.error);
