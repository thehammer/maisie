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

async function main() {
  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

  // Dump the FULL IoT network config
  const networks = await request(`/proxy/network/api/s/${site}/rest/networkconf`);
  const iot = networks.data.find((n: any) => n.name === "IoT");
  console.log("=== Full IoT Network Config ===");
  console.log(JSON.stringify(iot, null, 2));

  await new Promise(r => setTimeout(r, 2000));

  // Check traffic rules (newer UniFi feature)
  try {
    const traffic = await request(`/proxy/network/v2/api/site/${site}/trafficroles`);
    console.log("\n=== Traffic Roles ===");
    console.log(JSON.stringify(traffic, null, 2));
  } catch (e: any) {
    console.log("\n=== Traffic Roles: not available ===");
  }

  await new Promise(r => setTimeout(r, 2000));

  try {
    const trafficRules = await request(`/proxy/network/v2/api/site/${site}/trafficrules`);
    console.log("\n=== Traffic Rules ===");
    console.log(JSON.stringify(trafficRules, null, 2));
  } catch (e: any) {
    console.log("\n=== Traffic Rules: not available ===");
  }
}

main().catch(console.error);
