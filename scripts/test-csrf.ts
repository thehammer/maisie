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
  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  // Capture cookies
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) {
    cookies = setCookie.map((c) => c.split(";")[0]);
  }

  // Capture CSRF token
  const csrf = res.headers.get("x-csrf-token");
  if (csrf) {
    csrfToken = csrf;
    console.log(`  Got CSRF token: ${csrf.substring(0, 20)}...`);
  }

  return { res, status: res.status };
}

async function main() {
  // Login
  console.log("Logging in...");
  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  console.log(`  Login status: ${login.status}`);
  console.log(`  Cookies: ${cookies.length}`);
  console.log(`  CSRF token present: ${!!csrfToken}\n`);

  // Try reading settings first
  console.log("Reading IPS settings...");
  const settingsReq = await request(`/proxy/network/api/s/${site}/rest/setting`);
  const settingsBody = await settingsReq.res.json();
  const ips = settingsBody.data.find((s: any) => s.key === "ips");
  console.log(`  Current ips_enabled: ${ips?.ips_enabled}`);
  console.log(`  Current ips_mode: ${ips?.ips_mode}`);
  console.log(`  _id: ${ips?._id}\n`);

  // Try PUT with CSRF token
  console.log("Attempting to enable IDS with CSRF token...");
  const updateReq = await request(`/proxy/network/api/s/${site}/rest/setting/ips/${ips._id}`, {
    method: "PUT",
    body: JSON.stringify({
      ips_enabled: true,
      ips_mode: "ids",
    }),
  });
  console.log(`  Update status: ${updateReq.status}`);
  if (updateReq.status === 200) {
    const body = await updateReq.res.json();
    console.log(`  Success! ips_enabled: ${body.data?.[0]?.ips_enabled}, mode: ${body.data?.[0]?.ips_mode}`);
  } else {
    const body = await updateReq.res.text();
    console.log(`  Failed: ${body}`);
  }
}

main().catch(console.error);
