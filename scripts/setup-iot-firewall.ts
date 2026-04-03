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
  // Login
  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  console.log("Logged in\n");

  // Check existing rules first
  const existing = await request(`/proxy/network/api/s/${site}/rest/firewallrule`);
  const existingNames = (existing.data as any[]).map((r: any) => r.name);
  console.log("Existing rules:", existingNames.join(", "));
  console.log("");

  await new Promise(r => setTimeout(r, 2000));

  // Rule 1: Allow established/related from IoT
  // This ensures responses to connections initiated FROM Main TO IoT can flow back
  const rule1Name = "IoT - Allow Established/Related";
  if (existingNames.includes(rule1Name)) {
    console.log(`Rule "${rule1Name}" already exists, skipping`);
  } else {
    console.log(`Creating: ${rule1Name}`);
    const res1 = await request(`/proxy/network/api/s/${site}/rest/firewallrule`, {
      method: "POST",
      body: JSON.stringify({
        name: rule1Name,
        enabled: true,
        action: "accept",
        ruleset: "LAN_IN",
        protocol: "all",
        protocol_match_excepted: false,
        rule_index: 20010,
        src_networkconf_id: IOT_NETWORK_ID,
        src_networkconf_type: "NETv4",
        dst_networkconf_type: "NETv4",
        state_established: true,
        state_related: true,
        state_new: false,
        state_invalid: false,
      }),
    });
    console.log("  Created:", res1.data?.[0]?.name, "- ID:", res1.data?.[0]?._id);
  }

  await new Promise(r => setTimeout(r, 2000));

  // Rule 2: Block IoT from initiating connections to Main network
  const rule2Name = "IoT - Block to Main";
  if (existingNames.includes(rule2Name)) {
    console.log(`Rule "${rule2Name}" already exists, skipping`);
  } else {
    console.log(`Creating: ${rule2Name}`);
    const res2 = await request(`/proxy/network/api/s/${site}/rest/firewallrule`, {
      method: "POST",
      body: JSON.stringify({
        name: rule2Name,
        enabled: true,
        action: "drop",
        ruleset: "LAN_IN",
        protocol: "all",
        protocol_match_excepted: false,
        rule_index: 20011,
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
    console.log("  Created:", res2.data?.[0]?.name, "- ID:", res2.data?.[0]?._id);
  }

  console.log("\n=== Summary ===");
  console.log("Rule 1 (index 2000): Allow established/related FROM IoT — so responses flow back");
  console.log("Rule 2 (index 2001): Drop NEW connections FROM IoT TO Main — blocks IoT-initiated access");
  console.log("Main → IoT: ALLOWED (no rule blocks it)");
  console.log("IoT → Internet: ALLOWED (no rule blocks it)");
  console.log("mDNS: Already enabled on both networks for HomeKit/Bonjour discovery");
  console.log("\nReady to test by moving one device to the IoT network.");
}

main().catch(console.error);
