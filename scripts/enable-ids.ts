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

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies.join("; "),
      ...options.headers,
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) {
    cookies = setCookie.map((c) => c.split(";")[0]);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${res.statusText} — ${body}`);
  }
  return res.json();
}

async function main() {
  // Login
  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  console.log("Logged in\n");

  // Get current IPS settings
  const settingsRes = await request(`/proxy/network/api/s/${site}/rest/setting`);
  const allSettings = settingsRes.data;
  const ips = allSettings.find((s: any) => s.key === "ips");

  if (!ips) {
    console.error("IPS settings not found!");
    return;
  }

  console.log("Current IPS settings:");
  console.log(`  ips_enabled: ${ips.ips_enabled}`);
  console.log(`  ips_mode: ${ips.ips_mode}`);
  console.log(`  dns_filtering: ${JSON.stringify(ips.dns_filtering)}`);
  console.log(`  honeypot_enabled: ${ips.honeypot_enabled}`);
  console.log(`  _id: ${ips._id}\n`);

  // Enable IDS mode (detect only, no blocking)
  console.log("Enabling IDS (detect-only mode)...");
  const updateRes = await request(`/proxy/network/api/s/${site}/rest/setting/ips/${ips._id}`, {
    method: "PUT",
    body: JSON.stringify({
      ips_enabled: true,
      ips_mode: "ids",
    }),
  });

  console.log("Response:", JSON.stringify(updateRes.data?.[0]?.ips_enabled));
  console.log("Mode:", JSON.stringify(updateRes.data?.[0]?.ips_mode));
  console.log("\nIDS enabled successfully. The UDM will now detect and log threats without blocking.");
}

main().catch(console.error);
