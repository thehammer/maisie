import { Hono } from "hono";
import { getPlexStatus } from "../skills/media/plex-status";
import { getMediaCalendar } from "../skills/media/media-calendar";
import { getHdhrStatus } from "../skills/media/hdhr-client";
import {
  probeFile as probeMediaFile,
  cleanFile as cleanMediaFile,
  transcodeFile as transcodeMediaFile,
  scanLibrary as scanMediaLibrary,
} from "../skills/media/media-cleaner";
import type { Services } from "./types";

// Normalize a title for fuzzy audiobook library matching
// Strips author prefixes like "Andy Weir - Project Hail Mary", punctuation, articles
function normalizeTitleForAudiobook(title: string): string {
  return title
    .replace(/^[^-]+-\s*/, "")  // strip "Author - " prefix common in torrent filenames
    .replace(/\s*\(.*?\)/g, "") // strip parentheticals
    .replace(/\s*\[.*?\]/g, "") // strip brackets
    .replace(/:.*$/, "")        // strip subtitle
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\b(the|a|an)\b\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function createMediaRouter(services: Pick<Services, "db" | "plex" | "radarr" | "sonarr" | "hdhr" | "prowlarr" | "transmission" | "readarr" | "audiobookshelf">) {
  const router = new Hono();

  router.get("/plex/status", async (c) => {
    if (!services.plex) return c.json({ error: "Plex not configured" }, 503);
    try {
      const status = await getPlexStatus(services.plex!);
      return c.json(status);
    } catch (err) {
      console.error("[plex] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/plex/shows", async (c) => {
    if (!services.plex) return c.json({ error: "Plex not connected" }, 503);
    const title = c.req.query("title");
    if (!title) return c.json({ error: "title param required" }, 400);

    const section = c.req.query("section");
    try {
      if (section) {
        const shows = await services.plex!.searchShows(title, section);
        return c.json(shows);
      }
      // Search all show-type library sections
      const libraries = await services.plex!.getLibraries();
      const showSections = libraries.filter((l) => l.type === "show");
      const results: any[] = [];
      for (const lib of showSections) {
        const shows = await services.plex!.searchShows(title, lib.key);
        results.push(...shows.map((s) => ({ ...s, librarySection: lib.key, libraryTitle: lib.title })));
      }
      return c.json(results);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/plex/shows/:ratingKey/episodes", async (c) => {
    if (!services.plex) return c.json({ error: "Plex not connected" }, 503);
    try {
      const episodes = await services.plex!.getShowEpisodes(c.req.param("ratingKey"));
      return c.json(episodes);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/plex/playlists", async (c) => {
    if (!services.plex) return c.json({ error: "Plex not connected" }, 503);
    try {
      const playlists = await services.plex!.getPlaylists("video");
      return c.json(playlists);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/media/calendar", async (c) => {
    if (!services.radarr && !services.sonarr) return c.json({ error: "Neither Radarr nor Sonarr configured" }, 503);
    try {
      const calendar = await getMediaCalendar(services.radarr ?? null, services.sonarr ?? null);
      return c.json(calendar);
    } catch (err) {
      console.error("[media] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/hdhr/status", async (c) => {
    if (!services.hdhr) return c.json({ error: "HDHomeRun not configured" }, 503);
    try {
      const status = await getHdhrStatus(services.hdhr!);
      return c.json(status);
    } catch (err) {
      console.error("[hdhr] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/media/search", async (c) => {
    const q = c.req.query("q")?.trim();
    const type = c.req.query("type") || "movie"; // movie | tv
    if (!q) return c.json({ error: "q parameter required" }, 400);

    if (type === "movie") {
      if (!services.radarr) return c.json({ error: "Radarr not configured" }, 503);
      try {
        // Radarr lookup includes id > 0 for movies already in library
        const lookup = await services.radarr!.lookup(q);
        const library = lookup.filter((m: any) => m.id && m.id > 0);
        const results = lookup.map((m: any) => ({
          ...m,
          inLibrary: !!(m.id && m.id > 0),
        }));
        return c.json({ library, results });
      } catch (err) {
        console.error("[media-search] Radarr error:", err);
        return c.json({ error: String(err) }, 500);
      }
    }

    if (type === "tv") {
      if (!services.sonarr) return c.json({ error: "Sonarr not configured" }, 503);
      try {
        // Sonarr lookup doesn't include library IDs, so we just return lookup results
        // The id > 0 check doesn't work for Sonarr but we include it as a fallback
        const lookup = await services.sonarr!.lookup(q);
        const results = lookup.map((s: any) => ({
          ...s,
          inLibrary: !!(s.id && s.id > 0),
        }));
        const library = results.filter((s: any) => s.inLibrary);
        return c.json({ library, results });
      } catch (err) {
        console.error("[media-search] Sonarr error:", err);
        return c.json({ error: String(err) }, 500);
      }
    }

    return c.json({ error: "type must be 'movie' or 'tv'" }, 400);
  });

  router.get("/media/config", async (c) => {
    const type = c.req.query("type") || "movie";
    try {
      if (type === "movie") {
        if (!services.radarr) return c.json({ error: "Radarr not configured" }, 503);
        const [rootFolders, qualityProfiles] = await Promise.all([
          services.radarr!.getRootFolders(),
          services.radarr!.getQualityProfiles(),
        ]);
        return c.json({ rootFolders, qualityProfiles });
      }
      if (type === "tv") {
        if (!services.sonarr) return c.json({ error: "Sonarr not configured" }, 503);
        const [rootFolders, qualityProfiles, languageProfiles] = await Promise.all([
          services.sonarr!.getRootFolders(),
          services.sonarr!.getQualityProfiles(),
          services.sonarr!.getLanguageProfiles(),
        ]);
        return c.json({ rootFolders, qualityProfiles, languageProfiles });
      }
      return c.json({ error: "type must be 'movie' or 'tv'" }, 400);
    } catch (err) {
      console.error("[media-config] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/media/add", async (c) => {
    const body = await c.req.json();
    const { type } = body;

    if (type === "movie") {
      if (!services.radarr) return c.json({ error: "Radarr not configured" }, 503);
      const { title, tmdbId, year, qualityProfileId, rootFolderPath } = body;
      if (!title || !tmdbId || !qualityProfileId || !rootFolderPath) {
        return c.json({ error: "Missing required fields" }, 400);
      }
      try {
        const result = await services.radarr!.addMovie({
          title,
          tmdbId,
          year,
          qualityProfileId,
          rootFolderPath,
        });
        return c.json({ success: true, id: result.id, title: result.title });
      } catch (err) {
        console.error("[media-add] Radarr error:", err);
        return c.json({ error: String(err) }, 500);
      }
    }

    if (type === "tv") {
      if (!services.sonarr) return c.json({ error: "Sonarr not configured" }, 503);
      const { title, tvdbId, qualityProfileId, rootFolderPath, languageProfileId } = body;
      if (!title || !tvdbId || !qualityProfileId || !rootFolderPath) {
        return c.json({ error: "Missing required fields" }, 400);
      }
      try {
        const result = await services.sonarr!.addSeries({
          title,
          tvdbId,
          qualityProfileId,
          rootFolderPath,
          languageProfileId,
        });
        return c.json({ success: true, id: result.id, title: result.title });
      } catch (err) {
        console.error("[media-add] Sonarr error:", err);
        return c.json({ error: String(err) }, 500);
      }
    }

    return c.json({ error: "type must be 'movie' or 'tv'" }, 400);
  });

  router.post("/media/file/probe", async (c) => {
    try {
      const { filePath } = await c.req.json<{ filePath: string }>();
      if (!filePath) return c.json({ error: "filePath required" }, 400);
      const result = await probeMediaFile(filePath);
      return c.json(result);
    } catch (err) {
      console.error("[media-cleaner] Probe error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/media/file/clean", async (c) => {
    try {
      const { filePath, options } = await c.req.json<{
        filePath: string;
        options?: {
          dryRun?: boolean;
          outputPath?: string;
          keepLanguages?: string[];
          removeAttachments?: boolean;
          embedExternalSubs?: boolean;
          setDefaultAudio?: boolean;
          setDefaultSubtitle?: string;
        };
      }>();
      if (!filePath) return c.json({ error: "filePath required" }, 400);
      const result = await cleanMediaFile(filePath, options);
      return c.json(result);
    } catch (err) {
      console.error("[media-cleaner] Clean error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/media/file/transcode", async (c) => {
    try {
      const { filePath, options } = await c.req.json<{
        filePath: string;
        options?: {
          dryRun?: boolean;
          outputPath?: string;
          targetResolution?: "1080p" | "720p";
          crf?: number;
          preset?: string;
          hwAccel?: boolean;
        };
      }>();
      if (!filePath) return c.json({ error: "filePath required" }, 400);
      const result = await transcodeMediaFile(filePath, options);
      return c.json(result);
    } catch (err) {
      console.error("[media-cleaner] Transcode error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/media/library/scan", async (c) => {
    try {
      const { path, sizeThresholdGB, maxFiles } = await c.req.json<{
        path: string;
        sizeThresholdGB?: number;
        maxFiles?: number;
      }>();
      if (!path) return c.json({ error: "path required" }, 400);
      const result = await scanMediaLibrary({ path, sizeThresholdGB, maxFiles });
      return c.json(result);
    } catch (err) {
      console.error("[media-cleaner] Scan error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/audiobooks/search", async (c) => {
    if (!services.prowlarr) return c.json({ error: "Prowlarr not configured" }, 503);
    const q = c.req.query("q")?.trim();
    if (!q) return c.json({ error: "q parameter required" }, 400);

    try {
      // Run Prowlarr search and full ABS library fetch in parallel
      const [prowlarrResults, absItems] = await Promise.all([
        services.prowlarr!.searchAudiobooks(q),
        services.audiobookshelf ? services.audiobookshelf.getAllItems().catch(() => []) : Promise.resolve([]),
      ]);

      // Build a set of normalized titles from the ABS library
      const absLibraryTitles = new Set(
        absItems.map((item) => normalizeTitleForAudiobook(item.title)),
      );

      const prowlarrHost = process.env.PROWLARR_HOST || "localhost";
      const fixHost = (url: string | undefined) =>
        url ? url.replace("http://localhost:", `http://${prowlarrHost}:`) : "";

      // Resolve a usable download target. Order of preference:
      // 1. Raw magnet URI in guid — most robust, bypasses Prowlarr's proxy
      // 2. downloadUrl (a torrent-file link, usually Prowlarr proxy)
      // 3. magnetUrl (Prowlarr's magnet proxy — fragile; its encrypted `link`
      //    param can fail with "Failed to normalize provided link")
      const resolveDownload = (r: typeof prowlarrResults[number]) => {
        if (r.guid && r.guid.startsWith("magnet:")) return r.guid;
        if (r.downloadUrl) return fixHost(r.downloadUrl);
        if (r.magnetUrl) return fixHost(r.magnetUrl);
        return "";
      };

      // Interleave results by indexer so no single indexer starves the others
      // when the UI caps the display list.
      const byIndexer = new Map<string, typeof prowlarrResults>();
      for (const r of prowlarrResults) {
        const key = r.indexer || "?";
        if (!byIndexer.has(key)) byIndexer.set(key, []);
        byIndexer.get(key)!.push(r);
      }
      const interleaved: typeof prowlarrResults = [];
      let hasMore = true;
      for (let i = 0; hasMore; i++) {
        hasMore = false;
        for (const list of byIndexer.values()) {
          if (i < list.length) {
            interleaved.push(list[i]);
            hasMore = true;
          }
        }
      }

      return c.json({
        results: interleaved
          .map((r) => ({ r, url: resolveDownload(r) }))
          .filter(({ url }) => url.length > 0) // drop entries with no downloadable link
          .map(({ r, url }) => ({
            guid: r.guid,
            title: r.title,
            size: r.size,
            seeders: r.seeders,
            leechers: r.leechers,
            indexer: r.indexer,
            downloadUrl: url,
            infoUrl: r.infoUrl,
            publishDate: r.publishDate,
            inLibrary: absLibraryTitles.has(normalizeTitleForAudiobook(r.title)),
          })),
      });
    } catch (err) {
      console.error("[audiobook] Search error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/audiobooks/download", async (c) => {
    if (!services.transmission) return c.json({ error: "Transmission not configured" }, 503);
    try {
      const { downloadUrl, title } = await c.req.json<{ downloadUrl: string; title?: string }>();
      if (!downloadUrl) return c.json({ error: "downloadUrl required" }, 400);

      // Send torrent to Transmission immediately
      const result = await services.transmission!.addTorrentUrl(downloadUrl, "/data/completed/readarr");
      console.log(`[audiobook] Sent to Transmission: "${result.name}" (id: ${result.id})`);

      // In the background, try to add the book to Readarr so it can match and import
      if (services.readarr && title) {
        const searchTerm = title
          .replace(/[\[\(].*?[\]\)]/g, "") // strip [tags] and (annotations)
          .replace(/audiobook|miok|mp3|m4b/gi, "")
          .trim();
        services.readarr.ensureBookExists(searchTerm).then((r) => {
          if (r.added) {
            console.log(`[audiobook] Added to Readarr library: "${searchTerm}"`);
          } else {
            console.log(`[audiobook] Could not add to Readarr (will need manual import): ${r.error}`);
          }
        });
      }

      return c.json({ success: true, name: result.name, torrentId: result.id });
    } catch (err) {
      console.error("[audiobook] Download error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}
