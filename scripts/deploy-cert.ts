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

const domain = process.env.DOMAIN;
if (!domain) throw new Error("DOMAIN env var required");
const CERT_DIR = process.env.CERTS_DIR || join(process.env.HOME!, `certs/config/live/${domain}`);
const cert = await Bun.file(join(CERT_DIR, "fullchain.pem")).text();
const key = await Bun.file(join(CERT_DIR, "privkey.pem")).text();

// Try via Maisie agent API first
try {
  const res = await fetch("http://localhost:3001/api/network/upload-cert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cert, key }),
  });
  const data = await res.json();
  if (res.ok) {
    console.log("✓ Cert uploaded to UDM via Maisie agent:", data);
  } else {
    console.error("✗ Agent API error:", data);
    console.log("  Falling back to direct upload...");
    await directUpload(cert, key);
  }
} catch (err) {
  console.error("✗ Agent not reachable, falling back to direct upload...");
  await directUpload(cert, key);
}

async function directUpload(cert: string, key: string) {
  const host = process.env.UNIFI_HOST;
  const username = process.env.UNIFI_USERNAME;
  const password = process.env.UNIFI_PASSWORD;
  const site = process.env.UNIFI_SITE || "default";
  const baseUrl = `https://${host}`;

  // Login
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
  }

  const cookies = (loginRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const csrfToken = loginRes.headers.get("x-csrf-token") || "";

  // Upload cert
  const formData = new FormData();
  formData.append("certfile", new Blob([cert], { type: "application/x-pem-file" }), "fullchain.pem");
  formData.append("keyfile", new Blob([key], { type: "application/x-pem-file" }), "privkey.pem");

  const uploadRes = await fetch(`${baseUrl}/proxy/network/api/s/${site}/cmd/sslcert`, {
    method: "POST",
    headers: { Cookie: cookies, "X-CSRF-Token": csrfToken },
    body: formData,
  });

  if (!uploadRes.ok) {
    throw new Error(`Cert upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  console.log("✓ Cert uploaded to UDM directly:", await uploadRes.json());
}
