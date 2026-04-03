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

const SSIDS = [
  { id: "5c8aa8bec17d802ee3be7b03", name: "Bushido" },
  { id: "6021b6e2c17d803a7ab524a6", name: "Kendo" },
  { id: "69add949565094bd75bd24e5", name: "Iaido" },
];

async function main() {
  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  console.log("Logged in\n");

  for (const ssid of SSIDS) {
    console.log(`Updating ${ssid.name}...`);

    // 802.11r fast roaming
    try {
      const res = await request(`/proxy/network/api/s/${site}/rest/wlanconf/${ssid.id}`, {
        method: "PUT",
        body: JSON.stringify({
          fast_roaming_enabled: true,
        }),
      });
      const updated = res.data?.[0];
      console.log(`  fast_roaming_enabled: ${updated?.fast_roaming_enabled}`);
    } catch (e: any) {
      console.log(`  Fast roaming error: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 2000));

    // WPA3 transition mode via pmf_mode + wpa3 support
    try {
      const res = await request(`/proxy/network/api/s/${site}/rest/wlanconf/${ssid.id}`, {
        method: "PUT",
        body: JSON.stringify({
          wpa_mode: "wpa2",
          pmf_mode: "optional",
          wpa3_support: true,
          wpa3_transition: true,
        }),
      });
      const updated = res.data?.[0];
      console.log(`  wpa3_support: ${updated?.wpa3_support}`);
      console.log(`  wpa3_transition: ${updated?.wpa3_transition}`);
      console.log(`  pmf_mode: ${updated?.pmf_mode}`);
      console.log(`  Done\n`);
    } catch (e: any) {
      console.log(`  WPA3 error: ${e.message}\n`);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // Verify
  console.log("=== Verification ===");
  const wlans = await request(`/proxy/network/api/s/${site}/rest/wlanconf`);
  for (const w of wlans.data) {
    console.log(`${w.name}: wpa_mode=${w.wpa_mode}, fast_roaming=${w.fast_roaming_enabled}`);
  }
}

main().catch(console.error);
