// EPG Generator — builds XMLTV by fetching real guide data from Maisie's EPG service,
// then adds camera (24h blocks) and library (marathon blocks) entries.

export interface EpgChannel {
  number: string;
  name: string;
  type: "cable" | "camera" | "library";
  callSign?: string;
  streamName?: string;
}

// Chicago market call sign → friendly name
export const OTA_NAMES: Record<string, { name: string; network: string }> = {
  WLSDT: { name: "ABC 7 Chicago", network: "ABC" },
  WBBMDT: { name: "CBS 2 Chicago", network: "CBS" },
  WMAQDT: { name: "NBC 5 Chicago", network: "NBC" },
  WFLDDT: { name: "FOX 32 Chicago", network: "FOX" },
  WTTWDT: { name: "WTTW 11 PBS", network: "PBS" },
  WGNDT: { name: "WGN 9", network: "WGN" },
  WCIUDT: { name: "WCIU 26 The U", network: "The U" },
  WPWRDT: { name: "WPWR 50 MyNet", network: "MyNetworkTV" },
};

const MAISIE_URL = process.env.MAISIE_URL || "http://maisie:3001";

interface GuideProgram {
  title: string;
  episodeTitle?: string;
  description?: string;
  startTime: number;
  endTime: number;
  episodeNumber?: string;
  filter?: string[];
  imageUrl?: string;
}

interface ChannelGuide {
  number: string;
  name: string;
  programs: GuideProgram[];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatXmltvDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  // Use local timezone offset
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const absOff = Math.abs(off);
  const tzStr = `${sign}${pad(Math.floor(absOff / 60))}${pad(absOff % 60)}`;
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())} ${tzStr}`;
}

function unixToXmltvDate(unix: number): string {
  return formatXmltvDate(new Date(unix * 1000));
}

// Fetch real guide data from Maisie's EPG service (SiliconDust data)
async function fetchGuideData(): Promise<ChannelGuide[]> {
  try {
    // Request maximum — SiliconDust free tier gives ~5-6 hours,
    // but we ask for more in case they expand or we switch to Schedules Direct
    const res = await fetch(`${MAISIE_URL}/api/tv/guide?hours=336`);
    if (!res.ok) return [];
    return (await res.json()) as ChannelGuide[];
  } catch {
    return [];
  }
}

// Cache guide data — refreshed on each XMLTV request (max every 5 min)
let guideCache: ChannelGuide[] = [];
let lastGuideFetch = 0;
const GUIDE_CACHE_TTL = 5 * 60 * 1000;

async function getGuideData(): Promise<ChannelGuide[]> {
  if (Date.now() - lastGuideFetch > GUIDE_CACHE_TTL) {
    guideCache = await fetchGuideData();
    lastGuideFetch = Date.now();
    if (guideCache.length > 0) {
      const totalProgs = guideCache.reduce((n, ch) => n + ch.programs.length, 0);
      console.log(`[epg] Refreshed guide: ${guideCache.length} channels, ${totalProgs} programs`);
    }
  }
  return guideCache;
}

function generateCableXmltv(
  channels: EpgChannel[],
  guide: ChannelGuide[],
): { channelXml: string; programmeXml: string } {
  const guideMap = new Map(guide.map((g) => [g.number, g]));
  let channelXml = "";
  let programmeXml = "";

  for (const ch of channels) {
    const info = ch.callSign ? OTA_NAMES[ch.callSign] : null;
    const displayName = info?.name || ch.name;
    const network = info?.network || ch.callSign || ch.name;

    const chGuide = guideMap.get(ch.number);
    const channelIcon = chGuide?.imageUrl;

    channelXml += `  <channel id="${ch.number}">
    <display-name>${escapeXml(displayName)}</display-name>
    <display-name>${escapeXml(network)}</display-name>${channelIcon ? `\n    <icon src="${escapeXml(channelIcon)}" />` : ""}
  </channel>\n`;
    let lastEndTime = 0;

    // Fill gap before real data — from 12h ago to first programme
    if (chGuide && chGuide.programs.length > 0) {
      const firstStart = chGuide.programs[0].startTime;
      const historyStart = new Date(Date.now() - 12 * 3600 * 1000);
      historyStart.setMinutes(0, 0, 0); // round to hour
      const historyStartSec = Math.floor(historyStart.getTime() / 1000);
      if (firstStart > historyStartSec) {
        programmeXml += `  <programme start="${formatXmltvDate(historyStart)}" stop="${unixToXmltvDate(firstStart)}" channel="${ch.number}">
    <title lang="en">${escapeXml(network)} Programming</title>
  </programme>\n`;
      }
    }

    // Emit real programme data from SiliconDust
    if (chGuide && chGuide.programs.length > 0) {
      for (const prog of chGuide.programs) {
        programmeXml += `  <programme start="${unixToXmltvDate(prog.startTime)}" stop="${unixToXmltvDate(prog.endTime)}" channel="${ch.number}">
    <title lang="en">${escapeXml(prog.title)}</title>`;
        if (prog.episodeTitle) {
          programmeXml += `\n    <sub-title lang="en">${escapeXml(prog.episodeTitle)}</sub-title>`;
        }
        if (prog.description) {
          programmeXml += `\n    <desc lang="en">${escapeXml(prog.description)}</desc>`;
        }
        if (prog.episodeNumber) {
          programmeXml += `\n    <episode-num system="onscreen">${escapeXml(prog.episodeNumber)}</episode-num>`;
        }
        if (prog.filter && prog.filter.length > 0) {
          for (const cat of prog.filter) {
            programmeXml += `\n    <category lang="en">${escapeXml(cat)}</category>`;
          }
        }
        if (prog.imageUrl) {
          programmeXml += `\n    <icon src="${escapeXml(prog.imageUrl)}" />`;
        }
        programmeXml += `\n  </programme>\n`;
        if (prog.endTime > lastEndTime) lastEndTime = prog.endTime;
      }
    }

    // Fill remaining time with generic blocks (after real data ends)
    const fillStart = new Date(lastEndTime > 0 ? lastEndTime * 1000 : Date.now());
    if (lastEndTime === 0) fillStart.setHours(0, 0, 0, 0);
    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);
    endDate.setDate(endDate.getDate() + 14);

    while (fillStart < endDate) {
      const blockEnd = new Date(fillStart);
      blockEnd.setHours(blockEnd.getHours() + 6);
      if (blockEnd > endDate) blockEnd.setTime(endDate.getTime());
      programmeXml += `  <programme start="${formatXmltvDate(fillStart)}" stop="${formatXmltvDate(blockEnd)}" channel="${ch.number}">
    <title lang="en">${escapeXml(network)} Programming</title>
  </programme>\n`;
      fillStart.setTime(blockEnd.getTime());
    }
  }

  return { channelXml, programmeXml };
}

function generateCameraXmltv(
  channels: EpgChannel[],
  icons: Record<string, string> = {},
): { channelXml: string; programmeXml: string } {
  let channelXml = "";
  let programmeXml = "";

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (const ch of channels) {
    const xmlName = escapeXml(ch.name);
    const icon = icons[ch.number];
    channelXml += `  <channel id="${ch.number}">
    <display-name>${xmlName}</display-name>${icon ? `\n    <icon src="${escapeXml(icon)}" />` : ""}
  </channel>\n`;

    // 24h block from midnight to midnight, 14 days
    for (let d = 0; d < 14; d++) {
      const start = new Date(now);
      start.setDate(start.getDate() + d);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const snapshotUrl = ch.streamName
        ? `http://${process.env.LAN_IP || "localhost"}:1984/api/frame.jpeg?src=${ch.streamName}`
        : undefined;
      programmeXml += `  <programme start="${formatXmltvDate(start)}" stop="${formatXmltvDate(end)}" channel="${ch.number}">
    <title lang="en">${xmlName} Live</title>${snapshotUrl ? `\n    <icon src="${escapeXml(snapshotUrl)}" />` : ""}
    <category lang="en">Security</category>
  </programme>\n`;
    }
  }

  return { channelXml, programmeXml };
}

interface LibraryScheduleEntry {
  title: string;
  showTitle?: string;
  episodeTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  startTime: number;
  endTime: number;
  imageUrl?: string;
}

interface LibraryScheduleResult {
  contentType: string; // "show" or "playlist"
  schedule: LibraryScheduleEntry[];
}

// Fetch episode schedule from Maisie for a library channel
async function fetchLibrarySchedule(
  channelNumber: string,
  days: number,
): Promise<LibraryScheduleResult> {
  try {
    const res = await fetch(
      `${MAISIE_URL}/api/library-channels/${channelNumber}/schedule?days=${days}`,
    );
    if (!res.ok) return { contentType: "show", schedule: [] };
    const data = (await res.json()) as {
      channel: { number: string; name: string; mode: string; contentType?: string };
      schedule: LibraryScheduleEntry[];
    };
    return {
      contentType: data.channel.contentType || "show",
      schedule: data.schedule || [],
    };
  } catch {
    return { contentType: "show", schedule: [] };
  }
}

async function generateLibraryXmltv(
  channels: EpgChannel[],
  icons: Record<string, string> = {},
): Promise<{ channelXml: string; programmeXml: string }> {
  let channelXml = "";
  let programmeXml = "";

  for (const ch of channels) {
    const xmlName = escapeXml(ch.name);
    const icon = icons[ch.number];
    channelXml += `  <channel id="${ch.number}">
    <display-name>${xmlName}</display-name>${icon ? `\n    <icon src="${escapeXml(icon)}" />` : ""}
  </channel>\n`;

    const { contentType, schedule } = await fetchLibrarySchedule(ch.number, 14);
    const isPlaylist = contentType === "playlist";

    if (schedule.length > 0) {
      for (const entry of schedule) {
        const isMovie = entry.seasonNumber === 0 && entry.episodeNumber === 0;

        // Shows (marathon): episode title as main title
        // Playlists: "Show - Episode" for TV, movie title for movies
        if (isPlaylist || isMovie) {
          // For playlist TV episodes, prefix with show name
          const displayTitle = (!isMovie && entry.showTitle)
            ? `${entry.showTitle} - ${entry.title}`
            : entry.title;
          programmeXml += `  <programme start="${unixToXmltvDate(entry.startTime)}" stop="${unixToXmltvDate(entry.endTime)}" channel="${ch.number}">
    <title lang="en">${escapeXml(displayTitle)}</title>`;
          if (!isMovie) {
            programmeXml += `\n    <episode-num system="onscreen">${escapeXml(entry.episodeTitle)}</episode-num>`;
          }
          if (entry.imageUrl) {
            programmeXml += `\n    <icon src="${escapeXml(entry.imageUrl)}" />`;
          }
          programmeXml += `\n    <category lang="en">${isMovie ? "Movie" : "Series"}</category>
  </programme>\n`;
        } else {
          // Marathon show — episode title is the main title
          programmeXml += `  <programme start="${unixToXmltvDate(entry.startTime)}" stop="${unixToXmltvDate(entry.endTime)}" channel="${ch.number}">
    <title lang="en">${escapeXml(entry.title)}</title>
    <episode-num system="onscreen">${escapeXml(entry.episodeTitle)}</episode-num>${entry.imageUrl ? `\n    <icon src="${escapeXml(entry.imageUrl)}" />` : ""}
    <category lang="en">Entertainment</category>
  </programme>\n`;
        }
      }
    } else {
      // Fallback: 24h marathon blocks
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      for (let d = 0; d < 2; d++) {
        const start = new Date(now);
        start.setDate(start.getDate() + d);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        programmeXml += `  <programme start="${formatXmltvDate(start)}" stop="${formatXmltvDate(end)}" channel="${ch.number}">
    <title lang="en">${xmlName} Marathon</title>
    <category lang="en">Entertainment</category>
  </programme>\n`;
      }
    }
  }

  return { channelXml, programmeXml };
}

// Fetch channel icon URLs from Maisie
async function fetchChannelIcons(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${MAISIE_URL}/api/library-channels/icons`);
    if (!res.ok) return {};
    return (await res.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

// Fetch all channel icons (camera, library, etc.) from disk-based icons
async function fetchAllChannelIcons(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${MAISIE_URL}/api/channel-icons`);
    if (!res.ok) return {};
    return (await res.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function generateXmltv(channels: EpgChannel[]): Promise<string> {
  const cableChannels = channels.filter((c) => c.type === "cable");
  const cameraChannels = channels.filter((c) => c.type === "camera");
  const libChannels = channels.filter((c) => c.type === "library");

  const [guide, icons, allIcons] = await Promise.all([getGuideData(), fetchChannelIcons(), fetchAllChannelIcons()]);
  const cable = generateCableXmltv(cableChannels, guide);
  const camera = generateCameraXmltv(cameraChannels, allIcons);
  const library = await generateLibraryXmltv(libChannels, icons);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="maisie-synthetic-hdhr">
${cable.channelXml}${camera.channelXml}${library.channelXml}${cable.programmeXml}${camera.programmeXml}${library.programmeXml}</tv>`;
}
