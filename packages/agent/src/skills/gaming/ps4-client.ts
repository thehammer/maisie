import { Client } from "basic-ftp";
import { Writable } from "stream";

interface Ps4Config {
  host: string;
  port: number;
}

export interface Ps4App {
  titleId: string;
  title: string;
  version: string;
  category: string;
  contentId: string;
  sizeMb: number | null;
  storage: "internal" | "external";
}

export interface Ps4Status {
  online: boolean;
  apps: Ps4App[];
  timestamp: string;
}

// App directories to scan: internal HDD and external USB HDD
const APP_ROOTS = [
  { path: "/user/app", storage: "internal" as const },
  { path: "/mnt/ext0/user/app", storage: "external" as const },
];

// Directories where param.sfo metadata can be found
const APPMETA_ROOTS = [
  "/system_data/priv/appmeta",
  "/mnt/ext0/user/appmeta",
];

// --- param.sfo binary parser ---
// The SFO (System File Object) format stores PS4 app metadata as key-value pairs.
// Structure: header (20 bytes) → index table → key table → data table

function parseSfo(buffer: Buffer): Record<string, string | number> {
  if (buffer.length < 20) return {};

  const magic = buffer.readUInt32LE(0);
  if (magic !== 0x46535000) return {}; // "\0PSF"

  const keyTableStart = buffer.readUInt32LE(8);
  const dataTableStart = buffer.readUInt32LE(12);
  const entryCount = buffer.readUInt32LE(16);

  const result: Record<string, string | number> = {};

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = 20 + i * 16;
    if (entryOffset + 16 > buffer.length) break;

    const keyOffset = buffer.readUInt16LE(entryOffset);
    const dataFormat = buffer.readUInt16LE(entryOffset + 2);
    const dataLen = buffer.readUInt32LE(entryOffset + 4);
    const dataOffset = buffer.readUInt32LE(entryOffset + 12);

    let keyEnd = keyTableStart + keyOffset;
    while (keyEnd < buffer.length && buffer[keyEnd] !== 0) keyEnd++;
    const key = buffer.subarray(keyTableStart + keyOffset, keyEnd).toString("utf8");

    const valueStart = dataTableStart + dataOffset;
    if (dataFormat === 0x0204) {
      let strEnd = valueStart;
      const strLimit = Math.min(valueStart + dataLen, buffer.length);
      while (strEnd < strLimit && buffer[strEnd] !== 0) strEnd++;
      result[key] = buffer.subarray(valueStart, strEnd).toString("utf8");
    } else if (dataFormat === 0x0404) {
      if (valueStart + 4 <= buffer.length) {
        result[key] = buffer.readUInt32LE(valueStart);
      }
    }
  }

  return result;
}

// --- Title extraction from PKG filename and content ID ---
// When param.sfo isn't available, we extract the game title from the PKG
// filename in app.json. Multiple naming conventions exist in the wild.

// Well-known content ID game codes → human-readable titles.
// Content IDs follow the pattern: {publisher}-{titleId}_00-{gameCode}-...
const GAME_CODE_TITLES: Record<string, string> = {
  UNCHARTED4000000: "Uncharted 4: A Thief's End",
  THELASTOFUS00000: "The Last of Us Remastered",
  "00000000GODOFWAR": "God of War (2018)",
  NIOH000000000000: "Nioh",
  "0000GODOFWAR3PS4": "God of War III Remastered",
  HRZCE00000000000: "Horizon Zero Dawn: Complete Edition",
  FFVIIREMAKE00000: "Final Fantasy VII Remake",
  CODBO4THEGAME001: "Call of Duty: Black Ops 4",
  BLACKOPS3GAME000: "Call of Duty: Black Ops III",
  CODCWTHEGAME0001: "Call of Duty: Black Ops Cold War",
  CODMWTHEGAME0001: "Call of Duty: Modern Warfare (2019)",
  SOTC0000000000US: "Shadow of the Colossus",
  TITANFALL2RSPWN1: "Titanfall 2",
  FORBIDDENWESTPS4: "Horizon Forbidden West",
  SEKIROGAME000001: "Sekiro: Shadows Die Twice",
  GRAVITYRUSH20000: "Gravity Rush 2",
  GRAVITYRUSHHD000: "Gravity Rush Remastered",
  DARKSOULSHD00000: "Dark Souls Remastered",
  FINALFANTASY80NA: "Final Fantasy VIII Remastered",
  FF9FORPS42017000: "Final Fantasy IX",
  FF1PS4APPEU00001: "Final Fantasy I Pixel Remaster",
  FF2PS4APPEU00001: "Final Fantasy II Pixel Remaster",
  FF3PS4APPEU00001: "Final Fantasy III Pixel Remaster",
  FF4PS4APPEU00001: "Final Fantasy IV Pixel Remaster",
  FF5PS4APPEU00001: "Final Fantasy V Pixel Remaster",
  FF6PS4APPEU00001: "Final Fantasy VI Pixel Remaster",
  DETROIT000000001: "Detroit: Become Human",
  GTSPORT000000000: "Gran Turismo Sport",
  FIREWALL00000000: "Firewall Zero Hour",
  FIRSTLIGHTSHIP00: "inFamous First Light",
  REZINFINITE00000: "Rez Infinite",
  PLATFORMERVR00US: "Astro Bot Rescue Mission",
  STREETFIGHTER006: "Street Fighter 6",
  TMNTSRDOTEMUSIEA: "TMNT: Shredder's Revenge",
  PERSONA512345678: "Persona 5",
  CELESTEXXCELESTE: "Celeste",
  DISHONOREDGAMEUK: "Dishonored: Definitive Edition",
  DISHONOREDTWOPS4: "Dishonored 2",
  BH2R000000000001: "Resident Evil 2 Remake",
  GTAVDIGITALDOWNL: "Grand Theft Auto V",
  GTAVICECITY00001: "GTA: Vice City - The Definitive Edition",
  SHENMUEEUROPE000: "Shenmue I & II",
  SHENMUEIIUSA0000: "Shenmue II",
  SHENMUEIII0000US: "Shenmue III",
  ARMOREDCORE60000: "Armored Core VI: Fires of Rubicon",
  METR000000000000: "Mass Effect Legendary Edition",
  SGWCONTRACTS0002: "Sniper Ghost Warrior Contracts 2",
  FULLGAME00000001: "Resident Evil 4 Remake",
  PSVRDEMODISK0003: "PlayStation VR Demo Disc 3",
  PSVRDEMODISC0002: "PlayStation VR Demo Disc 2",
  SHINOBIAOV000001: "Shinobi",
  HKSILKSONGPS4000: "Hollow Knight: Silksong",
  LB2SIEA000000000: "Little Big Planet 2",
};

// Title ID → title for games with completely opaque PKG filenames
const TITLE_ID_FALLBACKS: Record<string, string> = {
  CUSA00004: "inFamous Second Son",
  CUSA00473: "LittleBigPlanet 3",
  CUSA01068: "Ratchet & Clank",
  CUSA01073: "Ratchet & Clank (2016)",
  CUSA01227: "Final Fantasy X/X-2 HD Remaster",
  CUSA01589: "Dark Souls II: Scholar of the First Sin",
  CUSA02172: "Diablo III: Reaper of Souls",
  CUSA02320: "Uncharted: The Nathan Drake Collection",
  CUSA02754: "Inside",
  CUSA03007: "Tearaway Unfolded: Soundtrack",
  CUSA05969: "Call of Duty: WWII",
  CUSA07671: "WipEout Omega Collection",
  CUSA07823: "Dragon Ball FighterZ",
  CUSA09175: "Days Gone",
  CUSA09193: "Resident Evil 2 Remake",
  CUSA10249: "The Last of Us Part II",
  CUSA10455: "PlayStation VR Demo Disc",
  CUSA11108: "Blood & Truth",
  CUSA12605: "Death Stranding",
  CUSA13490: "PlayStation VR Demo Disc 3",
  CUSA15671: "Concrete Genie VR",
  CUSA34384: "God of War Ragnarok",
  CUSA43544: "Unknown PS4 Title",
  SLES52707: "PS2 Classic",
  ULUS10084: "Monster Hunter Freedom (PSP)",
  ULUS10266: "Monster Hunter Freedom Unite (PSP)",
  ULUS10391: "Monster Hunter Portable 3rd (PSP)",
  APOL00004: "Apollo Save Tool",
  ITEM00001: "ItemzFlow",
  SAAT29385: "Save Wizard",
};

function extractTitleFromPkgUrl(url: string, titleId: string): string | null {
  const filename = url.split("/").pop() ?? "";
  const base = filename.replace(/\.pkg$/i, "");

  // 1. Try to extract content ID game code from the URL
  //    Pattern: {pub}-{titleId}_00-{GAMECODE}-A0100-V0100
  const contentIdMatch = base.match(/\w+-\w+_\d+-(\w+)-[AV]\d/);
  if (contentIdMatch) {
    const code = contentIdMatch[1];
    if (GAME_CODE_TITLES[code]) return GAME_CODE_TITLES[code];
  }

  // 2. Try [Site]-GAME TITLE [CUSA...] pattern
  const bracketTitleMatch = base.match(/\][-\s]*(.+?)\s*\[/);
  if (bracketTitleMatch) {
    const title = cleanTitle(bracketTitleMatch[1]);
    if (title.length >= 3) return title;
  }

  // 3. Try CUSAXXXXX_GAME_TITLE_FXD pattern
  const fxdMatch = base.match(/CUSA\d{5}_(.+?)_FXD/i);
  if (fxdMatch) {
    return cleanTitle(fxdMatch[1]);
  }

  // 4. Strip noise and try to extract a clean title
  let cleaned = base
    .replace(/[\[(].+?[\])]/g, " ")           // remove bracketed parts
    .replace(/\b(PS4|DUPLEX|PRELUDE|OPOISSO\d*|CyB1K|TRIFECTA|REMASTERED|LFC|ByCisso)\b/gi, " ")
    .replace(/\b(FULLGAME|GAME|Game|Base|HIGH.SPEED|HIGH-SPEED|SPSX|FXD|Update|ALLDLCs|USA)\b/gi, " ")
    .replace(/[-_]?(CUSA|EP|UP|HP)\d{4,5}[-_]\w+/gi, " ") // content ID blocks
    .replace(/\b(CUSA|PCAS|PCJS)\d{5}\b/gi, " ")           // standalone title IDs
    .replace(/[-_]?[AV]\d{4}[-_]?[AV]\d{4}/gi, " ")        // A0100-V0100
    .replace(/[-_]v?\d+\.\d+/gi, " ")                       // versions
    .replace(/[-_]?\[?FW\d+\]?/gi, " ")                     // firmware tags
    .replace(/\b\d{1,2}\.\d{2}\b/g, " ")                    // version numbers like 5.05
    .replace(/^PS4[-_]/i, "")                                // PS4_ prefix
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Remove trailing scene release noise
  cleaned = cleaned
    .replace(/\s+\d{2,3}\s+OPOISSO\d*/gi, "")
    .replace(/\s+OPOISSO\d*/gi, "")
    .replace(/\s+\d{2,3}\s+FULLGAME\b/gi, "")
    .replace(/\s+\d{2,3}\s*$/i, "")
    .replace(/\s+(by|v\d).*$/i, "")
    .replace(/\s+00\s+\w+$/i, "")
    .replace(/^[-\s]+|[-\s]+$/g, "")
    .trim();

  // Check if the cleaned title looks like a real name (not an ID or noise)
  const looksLikeNoise =
    /^(CUSA|EP|UP|HP|MH\d|ULUS|SLES|SAAT|ITEM|APOL)\d/.test(cleaned) ||
    /^[A-Z]{2,4}\s+\d{4,5}$/.test(cleaned) ||  // "RC 01073"
    /^[a-z]{2,4}\s+[a-z]{3,}$/i.test(cleaned) || // "blz jce", "ptc finfant..."
    /^TLOUSP\d/i.test(cleaned);

  if (cleaned.length >= 3 && !looksLikeNoise) {
    // If we have an authoritative fallback, prefer it over noisy filename parsing
    return TITLE_ID_FALLBACKS[titleId] ?? cleaned;
  }

  // 5. Fall back to title ID lookup table
  return TITLE_ID_FALLBACKS[titleId] ?? null;
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/[._]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    // Strip trailing noise from scene release naming
    .replace(/\s+\d{2,3}\s+OPOISSO\d*/gi, "")  // "00 OPOISSO893"
    .replace(/\s+OPOISSO\d*/gi, "")              // trailing OPOISSO
    .replace(/\s+\d{2,3}\s+FULLGAME\b/gi, "")   // "56 FULLGAME"
    .replace(/\s+\d{2}\s*$/i, "")                // trailing "00", "81"
    .replace(/\s+(by|ps4|v\d).*$/i, "")          // "by", version
    .replace(/\s+00\s+\w+$/i, "")               // "00 word"
    .replace(/\s+\d+[-\s]+\d+\s*$/i, "")        // "672 123"
    .replace(/[-\s]+$/g, "")
    .trim();
}

// --- FTP client ---

export function createPs4Client(config: Ps4Config) {
  async function withFtp<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const ftp = new Client();
    ftp.ftp.verbose = false;
    try {
      await ftp.access({
        host: config.host,
        port: config.port,
        user: "anonymous",
        password: "",
      });
      return await fn(ftp);
    } finally {
      ftp.close();
    }
  }

  async function downloadToBuffer(ftp: Client, path: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    await ftp.downloadTo(writable, path);
    return Buffer.concat(chunks);
  }

  // Try to read param.sfo from all known appmeta locations
  async function readSfo(ftp: Client, titleId: string): Promise<Record<string, string | number> | null> {
    for (const root of APPMETA_ROOTS) {
      try {
        const buf = await downloadToBuffer(ftp, `${root}/${titleId}/param.sfo`);
        const sfo = parseSfo(buf);
        if (sfo["TITLE"]) return sfo;
      } catch { /* try next */ }
    }
    return null;
  }

  // Read PKG filename from app.json and extract title + size
  async function readTitleFromAppJson(ftp: Client, appRoot: string, titleId: string): Promise<{ title: string | null; sizeMb: number | null; contentId: string }> {
    try {
      const buf = await downloadToBuffer(ftp, `${appRoot}/${titleId}/app.json`);
      const json = JSON.parse(buf.toString("utf8"));
      const piece = json?.pieces?.[0];
      const url: string = piece?.url ?? "";
      const sizeMb = piece?.fileSize ? Math.round(piece.fileSize / (1024 * 1024)) : null;
      // Extract content ID from URL (pattern: {pub}-{titleId}_00-{code}-...)
      const cidMatch = url.match(/(\w{2}\d{4}-\w+_\d+-\w+)/);
      const contentId = cidMatch ? cidMatch[1] : "";
      return { title: extractTitleFromPkgUrl(url, titleId), sizeMb, contentId };
    } catch {
      return { title: null, sizeMb: null, contentId: "" };
    }
  }

  return {
    async ping(): Promise<boolean> {
      try {
        await withFtp(async (ftp) => {
          await ftp.pwd();
        });
        return true;
      } catch {
        return false;
      }
    },

    async getInstalledApps(): Promise<Ps4App[]> {
      return withFtp(async (ftp) => {
        const apps: Ps4App[] = [];

        for (const { path: appRoot, storage } of APP_ROOTS) {
          let entries: string[];
          try {
            const listing = await ftp.list(appRoot);
            entries = listing
              .filter((e) => e.isDirectory && /^[A-Z]{4}\d{5}$/.test(e.name))
              .map((e) => e.name);
          } catch {
            continue; // root doesn't exist (e.g., no external drive)
          }

          for (const titleId of entries) {
            // Try param.sfo first (authoritative metadata)
            const sfo = await readSfo(ftp, titleId);

            // Get title + size from app.json (always useful for size, fallback for title)
            const appJson = await readTitleFromAppJson(ftp, appRoot, titleId);

            if (sfo) {
              apps.push({
                titleId,
                title: String(sfo["TITLE"]),
                version: String(sfo["APP_VER"] ?? sfo["VERSION"] ?? ""),
                category: categorizeSfoCategory(String(sfo["CATEGORY"] ?? "")),
                contentId: String(sfo["CONTENT_ID"] ?? ""),
                sizeMb: appJson.sizeMb,
                storage,
              });
            } else {
              apps.push({
                titleId,
                title: appJson.title ?? titleId,
                version: "",
                category: "unknown",
                contentId: appJson.contentId,
                sizeMb: appJson.sizeMb,
                storage,
              });
            }
          }
        }

        return apps.sort((a, b) => a.title.localeCompare(b.title));
      });
    },

    async getStatus(): Promise<Ps4Status> {
      try {
        const apps = await this.getInstalledApps();
        return {
          online: true,
          apps,
          timestamp: new Date().toISOString(),
        };
      } catch {
        return {
          online: false,
          apps: [],
          timestamp: new Date().toISOString(),
        };
      }
    },
  };
}

function categorizeSfoCategory(cat: string): string {
  const map: Record<string, string> = {
    gd: "game",
    gdc: "game-content",
    gdd: "game-demo",
    gde: "game-digital",
    gdk: "game-disk",
    gdl: "game-dlc",
    gdo: "game-digital-overlay",
    gp: "game-patch",
    ac: "app-content",
    al: "app-dlc",
    cb: "theme",
    sf: "app-system",
  };
  return map[cat.toLowerCase()] ?? (cat || "unknown");
}

export function createPs4ClientFromEnv() {
  const host = process.env.PS4_HOST;
  if (!host) return null;
  return createPs4Client({
    host,
    port: Number(process.env.PS4_FTP_PORT) || 21,
  });
}
