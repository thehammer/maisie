import { existsSync } from "fs";
import { join } from "path";

const OUI_URL = "https://standards-oui.ieee.org/oui/oui.csv";
const OUI_PATH = join(import.meta.dir, "../../../data/oui.csv");

let ouiMap: Map<string, string> | null = null;

export async function ensureOuiDatabase(): Promise<void> {
  if (existsSync(OUI_PATH)) {
    await loadOuiDatabase();
    return;
  }

  console.log("  Downloading IEEE OUI database...");
  const res = await fetch(OUI_URL);
  if (!res.ok) throw new Error(`Failed to download OUI database: ${res.status}`);
  await Bun.write(OUI_PATH, await res.text());
  console.log("  ✓ OUI database downloaded");
  await loadOuiDatabase();
}

async function loadOuiDatabase(): Promise<void> {
  if (ouiMap) return;

  const file = Bun.file(OUI_PATH);
  const text = await file.text();
  const lines = text.split("\n");

  ouiMap = new Map();

  // CSV format: Registry,Assignment,Organization Name,Organization Address
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Parse CSV — fields may be quoted
    const match = line.match(/^MA-[LS],([0-9A-F]{6}),"?([^"]*)"?,/i);
    if (match) {
      ouiMap.set(match[1].toUpperCase(), match[2].trim());
    }
  }

  console.log(`  ✓ OUI database loaded (${ouiMap.size} entries)`);
}

export function lookupOui(mac: string): string | null {
  if (!ouiMap) return null;

  // Normalize MAC: remove separators, take first 6 hex chars (24-bit OUI)
  const prefix = mac.replace(/[:\-\.]/g, "").substring(0, 6).toUpperCase();
  return ouiMap.get(prefix) || null;
}
