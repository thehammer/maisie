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

async function main() {
  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  console.log("Logged in\n");

  // Check if Iaido already exists
  const existing = await request(`/proxy/network/api/s/${site}/rest/wlanconf`);
  const found = (existing.data as any[]).find((w: any) => w.name === "Iaido");
  if (found) {
    console.log("Iaido SSID already exists:", found._id);
    return;
  }

  await new Promise(r => setTimeout(r, 2000));

  console.log("Creating Iaido SSID on IoT VLAN 20...");
  const res = await request(`/proxy/network/api/s/${site}/rest/wlanconf`, {
    method: "POST",
    body: JSON.stringify({
      name: "Iaido",
      enabled: true,
      security: "wpapsk",
      wpa_mode: "wpa2",
      wpa_enc: "ccmp",
      x_passphrase: "Sh0gun4t3",
      networkconf_id: IOT_NETWORK_ID,
      is_guest: false,
      hide_ssid: false,
      pmf_mode: "optional",
      fast_roaming_enabled: false,
      group_rekey: 3600,
      ap_group_ids: ["6803f8ccd70d8b0ccaf39286"],
    }),
  });

  const ssid = res.data?.[0];
  console.log("Created:", ssid?.name);
  console.log("ID:", ssid?._id);
  console.log("Network:", "IoT (VLAN 20)");
  console.log("Security: WPA2-PSK");
  console.log("\nIaido should now be broadcasting on all APs.");
}

main().catch(console.error);
