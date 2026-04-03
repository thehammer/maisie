// Bridge API client — all HTTP communication with Maisie agent
// Only fetches from localhost (validated + enforced by host_permissions)

const DEFAULT_BRIDGE_URL = "http://localhost:3001";

function validateBridgeUrl(url) {
  const parsed = new URL(url);
  const h = parsed.hostname;
  const isLocal = h === "localhost" || h === "127.0.0.1" || h.startsWith("192.168.");
  if (!isLocal) {
    throw new Error("Bridge URL must be localhost, 127.0.0.1, or 192.168.x.x");
  }
  return parsed.origin;
}

export async function getBridgeUrl() {
  const result = await chrome.storage.session.get("bridgeState");
  return result.bridgeState?.bridgeUrl || DEFAULT_BRIDGE_URL;
}

export async function fetchMessages(since) {
  const base = validateBridgeUrl(await getBridgeUrl());
  const url = since
    ? `${base}/api/bridge/messages?since=${encodeURIComponent(since)}`
    : `${base}/api/bridge/messages`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bridge API error: ${res.status}`);
  const { messages } = await res.json();
  return messages;
}

export async function postResult(action, success, data, error) {
  const base = validateBridgeUrl(await getBridgeUrl());
  const result = { action, success };
  if (data !== undefined) result.data = data;
  if (error) result.error = error;
  const content = success ? `[result] ${action}: ok` : `[result] ${action}: ${error}`;
  await fetch(`${base}/api/bridge/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: "browser", content, result }),
  });
}

export async function getStatus() {
  const base = validateBridgeUrl(await getBridgeUrl());
  const res = await fetch(`${base}/api/bridge/status`);
  if (!res.ok) throw new Error(`Bridge API error: ${res.status}`);
  return res.json();
}

export async function resetBridge() {
  const base = validateBridgeUrl(await getBridgeUrl());
  await fetch(`${base}/api/bridge/reset`, { method: "POST" });
}
