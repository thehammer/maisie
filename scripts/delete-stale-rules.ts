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

const STALE_RULES = [
  { id: "60bd47515131870466aed6dd", name: "NAS VPN Only Accept us6721 UDP" },
  { id: "60bd47f35131870466aed708", name: "NAS VPN Only Reject" },
  { id: "60be27e25131870466aefc87", name: "Tokyo VPN us8391" },
  { id: "60be28275131870466aefc88", name: "Tokyo VPN Reject" },
];

async function main() {
  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  console.log("Logged in\n");

  for (const rule of STALE_RULES) {
    console.log(`Deleting: ${rule.name} (${rule.id})`);
    try {
      await request(`/proxy/network/api/s/${site}/rest/firewallrule/${rule.id}`, {
        method: "DELETE",
      });
      console.log("  Deleted\n");
    } catch (e: any) {
      console.log(`  Error: ${e.message}\n`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // Verify
  const remaining = await request(`/proxy/network/api/s/${site}/rest/firewallrule`);
  console.log("=== Remaining firewall rules ===");
  for (const r of remaining.data) {
    console.log(`  ${r.name} — ${r.enabled ? "enabled" : "disabled"} — ${r.action}`);
  }
}

main().catch(console.error);
