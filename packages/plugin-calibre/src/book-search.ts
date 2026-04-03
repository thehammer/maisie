// Search Anna's Archive for books and download them

const AA_MIRRORS = [
  "https://annas-archive.gl",
  "https://annas-archive.li",
  "https://annas-archive.se",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface AASearchResult {
  md5: string;
  title: string;
  author: string;
  publisher: string;
  year: string;
  language: string;
  fileType: string;
  fileSize: string;
  fileSizeBytes: number;
  coverUrl: string;
  detailUrl: string;
  score: number;
}

export interface AADownloadResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  error?: string;
}


function parseSizeToBytes(size: string): number {
  const match = size.match(/^([\d.]+)\s*(KB|MB|GB)$/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === "KB") return num * 1024;
  if (unit === "MB") return num * 1024 * 1024;
  if (unit === "GB") return num * 1024 * 1024 * 1024;
  return 0;
}

// Score a result — higher is better
function scoreResult(r: AASearchResult, query: string): number {
  let score = 0;

  // Format preference: epub >> mobi > azw3 > pdf > others
  const formatScores: Record<string, number> = {
    epub: 50, mobi: 30, azw3: 25, pdf: 15, fb2: 10, djvu: 5,
  };
  score += formatScores[r.fileType] || 0;

  // English language boost
  if (/english/i.test(r.language)) score += 30;

  // Has cover image
  if (r.coverUrl) score += 20;

  // Has author
  if (r.author) score += 15;

  // Has publisher
  if (r.publisher) score += 5;

  // File size sweet spot: 0.3MB–20MB is good for ebooks
  // Too small = likely corrupt or stub; too large = might be a scan/audiobook
  const bytes = r.fileSizeBytes;
  if (bytes > 300_000 && bytes < 20_000_000) {
    score += 20;
    // Prefer moderate sizes (1-10MB) slightly
    if (bytes > 1_000_000 && bytes < 10_000_000) score += 10;
  } else if (bytes > 0 && bytes <= 300_000) {
    score -= 20; // suspiciously small
  }

  // Title similarity — exact match (case-insensitive) gets a big boost
  const queryLower = query.toLowerCase().trim();
  const titleLower = r.title.toLowerCase().trim();
  if (titleLower === queryLower) {
    score += 40;
  } else if (titleLower.startsWith(queryLower) || titleLower.includes(queryLower)) {
    score += 20;
  }
  // Penalize titles with lots of extra text (subtitles, annotations)
  if (r.title.length > 80) score -= 5;

  // Newer year is slightly better (more likely to be a clean edition)
  if (r.year) {
    const yr = parseInt(r.year);
    if (yr >= 2020) score += 5;
    else if (yr >= 2010) score += 3;
  }

  return score;
}

async function fetchWithMirrors(path: string): Promise<Response | null> {
  for (const mirror of AA_MIRRORS) {
    try {
      const res = await fetch(`${mirror}${path}`, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
      });
      if (res.ok) return res;
    } catch {
      continue;
    }
  }
  return null;
}

export async function searchAnnasArchive(
  query: string,
  options: { lang?: string; ext?: string; content?: string; page?: number } = {},
): Promise<AASearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (options.lang) params.set("lang", options.lang);
  if (options.ext) params.set("ext", options.ext);
  if (options.content) params.set("content", options.content);
  if (options.page) params.set("page", String(options.page));

  const res = await fetchWithMirrors(`/search?${params}`);
  if (!res) throw new Error("All Anna's Archive mirrors unreachable");

  const html = await res.text();
  const results = parseSearchResults(html);

  // Score and sort — best matches first
  for (const r of results) {
    r.score = scoreResult(r, query);
  }
  results.sort((a, b) => b.score - a.score);

  return results;
}

function parseSearchResults(html: string): AASearchResult[] {
  const results: AASearchResult[] = [];

  // Split by result blocks: each result is a <div class="flex pt-3 pb-3 border-b ...">
  // containing one or more /md5/ links
  const blocks = html.split(/<div class="flex\s+pt-3 pb-3 border-b/);

  for (const block of blocks) {
    // Extract MD5 from the first /md5/ link
    const md5Match = block.match(/href="\/md5\/([a-f0-9]{32})"/i);
    if (!md5Match) continue;
    const md5 = md5Match[1];

    // Skip duplicates
    if (results.some((r) => r.md5 === md5)) continue;

    // Title: from js-vim-focus link text or data-content attribute
    const titleLinkMatch = block.match(/js-vim-focus[^>]*>([^<]+)</i);
    const titleDataMatch = block.match(/data-content="([^"]+)".*?text-violet/i);
    const title = (titleLinkMatch?.[1] || titleDataMatch?.[1] || "").trim();
    if (!title) continue;

    // Author: from user-edit icon link or second data-content
    const authorLinkMatch = block.match(/icon-\[mdi--user-edit\][^<]*<\/span>\s*([^<]+)/i);
    const authorDataMatch = block.match(/text-amber[^"]*"[^>]*data-content="([^"]+)"/i);
    const author = (authorLinkMatch?.[1] || authorDataMatch?.[1] || "").trim();

    // Publisher + year: from company icon span
    const pubMatch = block.match(/icon-\[mdi--company\][^<]*<\/span>\s*([^<]+)/i);
    const publisher = pubMatch ? pubMatch[1].trim() : "";

    // Metadata line: "English [en] · EPUB · 9.8MB · 2021 · ..."
    // Must match the specific div with both font-semibold and text-sm (not the title link)
    const metaMatch = block.match(/font-semibold text-sm[^>]*>([^<]*(?:·[^<]*)*)/i);
    const metaText = metaMatch ? metaMatch[1].trim() : "";
    const metaParts = metaText.split("·").map((s) => s.trim());

    let language = "";
    let fileType = "";
    let fileSize = "";
    let year = "";

    for (const part of metaParts) {
      if (/^[A-Za-z]+\s*\[[a-z]{2,3}\]$/.test(part)) {
        language = part.replace(/\s*\[.*\]/, "");
      } else if (/^(EPUB|PDF|MOBI|AZW3|DJVU|CBR|CBZ|FB2|TXT|RTF)$/i.test(part)) {
        fileType = part.toLowerCase();
      } else if (/^\d+(\.\d+)?\s*(KB|MB|GB)$/i.test(part)) {
        fileSize = part;
      } else if (/^\d{4}$/.test(part)) {
        year = part;
      }
    }

    // Cover image
    const imgMatch = block.match(/<img[^>]+src="(https?:\/\/[^"]+)"/i);
    const coverUrl = imgMatch ? imgMatch[1] : "";

    const result: AASearchResult = {
      md5,
      title,
      author,
      publisher,
      year,
      language: language || "Unknown",
      fileType: fileType || "unknown",
      fileSize,
      fileSizeBytes: parseSizeToBytes(fileSize),
      coverUrl,
      detailUrl: `/md5/${md5}`,
      score: 0,
    };
    results.push(result);
  }

  return results;
}

// Download a book file to a temp directory via Anna's Archive fast_download API
export async function downloadBook(
  md5: string,
  apiKey?: string,
): Promise<AADownloadResult> {
  if (!apiKey) {
    return { success: false, error: "AA_API_KEY not configured" };
  }

  const tmpDir = "/tmp/maisie-books";
  await Bun.spawn(["mkdir", "-p", tmpDir]).exited;

  // Try each AA mirror's fast_download API
  for (const mirror of AA_MIRRORS) {
    try {
      const res = await fetch(
        `${mirror}/dyn/api/fast_download.json?md5=${md5}&key=${apiKey}`,
        { headers: { "User-Agent": USER_AGENT } },
      );
      if (!res.ok) continue;

      const data = await res.json() as {
        download_url?: string | null;
        error?: string;
        account_fast_download_info?: { downloads_left: number };
      };

      if (data.error) {
        console.error(`[book-search] AA API error: ${data.error}`);
        return { success: false, error: `AA API: ${data.error}` };
      }

      if (!data.download_url) continue;

      const result = await downloadFile(data.download_url, tmpDir, md5);
      if (result) {
        return result;
      }
    } catch (err) {
      console.error(`[book-search] Mirror ${mirror} failed:`, err);
      continue;
    }
  }

  return { success: false, error: "All AA mirrors failed to return a download" };
}

async function downloadFile(
  url: string,
  tmpDir: string,
  md5: string,
): Promise<AADownloadResult | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/html")) return null;

    const contentDisp = res.headers.get("content-disposition") || "";
    const nameMatch = contentDisp.match(/filename="?([^";\n]+)"?/);
    const fileName = nameMatch ? decodeURIComponent(nameMatch[1]) : `${md5}.epub`;
    const filePath = `${tmpDir}/${fileName}`;
    await Bun.write(filePath, res);

    // Sanity check — file should be > 10KB (not an error page)
    const stat = Bun.file(filePath);
    if (stat.size < 10_000) {
      await Bun.spawn(["rm", "-f", filePath]).exited;
      return null;
    }

    return { success: true, filePath, fileName };
  } catch {
    return null;
  }
}
