import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getCalibreStatus } from "../skills/calibre/calibre-client";
import { scanLibrary } from "../skills/calibre/enrichment-scanner";
import { detectAuthorVariants, saveAuthorMap, getAuthorMap } from "../skills/calibre/author-normalizer";
import { runLookups, runClassification, runPipeline } from "../skills/calibre/enrichment-pipeline";
import { applyEnrichment, applyAllReviewed, applyAuthorMerge } from "../skills/calibre/enrichment-applier";
import { calibreEnrichment } from "../services/schema";
import { searchAnnasArchive, downloadBook } from "../skills/calibre/book-search";
import type { Services } from "./types";

export function createCalibreRouter(services: Pick<Services, "db" | "calibre" | "claude" | "calibreExec">) {
  const { db } = services;
  const router = new Hono();

  router.get("/calibre/status", async (c) => {
    if (!services.calibre) return c.json({ error: "Calibre not configured" }, 503);
    try {
      const status = await getCalibreStatus(services.calibre!);
      return c.json(status);
    } catch (err) {
      console.error("[calibre] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/calibre/books", async (c) => {
    if (!services.calibre) return c.json({ error: "Calibre not configured" }, 503);
    try {
      const library = c.req.query("library") || "";
      const query = c.req.query("q") || "";
      const num = Number(c.req.query("num")) || 50;
      const offset = Number(c.req.query("offset")) || 0;
      const sort = c.req.query("sort") || "timestamp";
      const order = c.req.query("order") || "desc";

      // Resolve library ID
      const info = await services.calibre!.getLibraryInfo();
      const libraryId = library || info.default_library;

      const search = await services.calibre!.search(libraryId, query, num, offset, sort, order);
      const books = search.book_ids.length > 0
        ? await services.calibre!.getBooks(search.book_ids, libraryId)
        : {};

      return c.json({
        books: search.book_ids.map((id) => books[String(id)]),
        total: search.total_num,
        offset: search.offset,
        library: libraryId,
      });
    } catch (err) {
      console.error("[calibre] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/calibre/book/:id", async (c) => {
    if (!services.calibre) return c.json({ error: "Calibre not configured" }, 503);
    try {
      const id = Number(c.req.param("id"));
      const info = await services.calibre!.getLibraryInfo();
      const libraryId = c.req.query("library") || info.default_library;
      const book = await services.calibre!.getBook(id, libraryId);
      return c.json(book);
    } catch (err) {
      console.error("[calibre] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/calibre/cover/:id", async (c) => {
    if (!services.calibre) return c.json({ error: "Calibre not configured" }, 503);
    try {
      const id = Number(c.req.param("id"));
      const info = await services.calibre!.getLibraryInfo();
      const libraryId = c.req.query("library") || info.default_library;
      const url = services.calibre!.getCoverUrl(id, libraryId);
      const res = await fetch(url);
      if (!res.ok) return c.json({ error: "Cover not found" }, 404);
      return new Response(res.body, {
        headers: {
          "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- Calibre Enrichment ---

  router.get("/calibre/enrichment/status", (c) => {
    const rows = db.select().from(calibreEnrichment).all();
    const stats = {
      total: rows.length,
      pending: 0,
      enriched: 0,
      reviewed: 0,
      applied: 0,
      skipped: 0,
      error: 0,
      gapBreakdown: { tags: 0, identifiers: 0, series: 0, rating: 0, description: 0, author: 0 },
    };

    for (const row of rows) {
      const status = row.status as keyof typeof stats;
      if (status in stats && typeof stats[status] === "number") {
        (stats as any)[status]++;
      }
      if (row.gaps) {
        const gaps = JSON.parse(row.gaps);
        for (const [key, val] of Object.entries(gaps)) {
          if (val && key in stats.gapBreakdown) {
            (stats.gapBreakdown as any)[key]++;
          }
        }
      }
    }

    return c.json(stats);
  });

  router.get("/calibre/enrichment/queue", (c) => {
    const status = c.req.query("status") || "";
    const limit = Number(c.req.query("limit")) || 50;
    const offset = Number(c.req.query("offset")) || 0;

    let rows = db.select().from(calibreEnrichment).all();

    if (status) {
      rows = rows.filter((r) => r.status === status);
    }

    const total = rows.length;
    const page = rows.slice(offset, offset + limit).map((row) => ({
      bookId: row.bookId,
      libraryId: row.libraryId,
      title: row.title,
      authors: row.authors ? JSON.parse(row.authors) : [],
      status: row.status,
      scanDate: row.scanDate,
      gaps: row.gaps ? JSON.parse(row.gaps) : {},
      proposedChanges: row.proposedChanges ? JSON.parse(row.proposedChanges) : null,
      changeSource: row.changeSource,
      confidence: row.confidence,
      reviewedAt: row.reviewedAt,
      appliedAt: row.appliedAt,
      errorMessage: row.errorMessage,
    }));

    return c.json({ items: page, total, offset, limit });
  });

  router.post("/calibre/enrichment/scan", async (c) => {
    if (!services.calibre) return c.json({ error: "Calibre not configured" }, 503);
    try {
      const result = await scanLibrary(db, services.calibre!);
      return c.json(result);
    } catch (err) {
      console.error("[enrichment] Scan error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/calibre/enrichment/lookup", async (c) => {
    try {
      const { batchSize } = await c.req.json<{ batchSize?: number }>().catch(() => ({} as { batchSize?: number }));
      const result = await runLookups(db, { batchSize });
      return c.json(result);
    } catch (err) {
      console.error("[enrichment] Lookup error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/calibre/enrichment/classify", async (c) => {
    if (!services.claude) return c.json({ error: "Anthropic not configured" }, 503);
    if (!services.calibre) return c.json({ error: "Calibre not configured" }, 503);
    try {
      const { batchSize } = await c.req.json<{ batchSize?: number }>().catch(() => ({} as { batchSize?: number }));
      const result = await runClassification(db, services.claude!, services.calibre!, { batchSize });
      return c.json(result);
    } catch (err) {
      console.error("[enrichment] Classify error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/calibre/enrichment/review/:id", async (c) => {
    try {
      const bookId = Number(c.req.param("id"));
      const { action, changes } = await c.req.json<{
        action: "approve" | "reject" | "edit";
        changes?: Record<string, unknown>;
      }>();

      const row = db
        .select()
        .from(calibreEnrichment)
        .where(eq(calibreEnrichment.bookId, bookId))
        .get();

      if (!row) return c.json({ error: "Not found" }, 404);

      if (action === "reject") {
        db.update(calibreEnrichment)
          .set({ status: "skipped", reviewedAt: new Date().toISOString() })
          .where(eq(calibreEnrichment.bookId, bookId))
          .run();
      } else if (action === "approve") {
        db.update(calibreEnrichment)
          .set({ status: "reviewed", reviewedAt: new Date().toISOString() })
          .where(eq(calibreEnrichment.bookId, bookId))
          .run();
      } else if (action === "edit" && changes) {
        db.update(calibreEnrichment)
          .set({
            proposedChanges: JSON.stringify(changes),
            status: "reviewed",
            reviewedAt: new Date().toISOString(),
          })
          .where(eq(calibreEnrichment.bookId, bookId))
          .run();
      }

      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/calibre/enrichment/apply", async (c) => {
    if (!services.calibreExec) return c.json({ error: "Calibre exec not configured" }, 503);
    try {
      const result = await applyAllReviewed(db, services.calibreExec!);
      return c.json(result);
    } catch (err) {
      console.error("[enrichment] Apply error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/calibre/enrichment/apply/:id", async (c) => {
    if (!services.calibreExec) return c.json({ error: "Calibre exec not configured" }, 503);
    try {
      const bookId = Number(c.req.param("id"));
      const result = await applyEnrichment(db, services.calibreExec!, bookId);
      return c.json(result);
    } catch (err) {
      console.error("[enrichment] Apply error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/calibre/enrichment/authors", async (c) => {
    if (!services.calibre) return c.json({ error: "Calibre not configured" }, 503);
    try {
      const info = await services.calibre!.getLibraryInfo();
      const allBooks = await services.calibre!.getAllBooks(info.default_library);
      const variants = detectAuthorVariants(allBooks);
      const saved = saveAuthorMap(db, variants);
      const map = getAuthorMap(db);
      return c.json({ variants, savedNew: saved, map });
    } catch (err) {
      console.error("[enrichment] Author scan error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/calibre/enrichment/authors/merge", async (c) => {
    if (!services.calibreExec) return c.json({ error: "Calibre exec not configured" }, 503);
    try {
      const { variant, canonical } = await c.req.json<{ variant: string; canonical: string }>();
      if (!variant || !canonical) return c.json({ error: "variant and canonical required" }, 400);
      const result = await applyAuthorMerge(db, services.calibreExec!, variant, canonical);
      return c.json(result);
    } catch (err) {
      console.error("[enrichment] Author merge error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- Book Search (Calibre + Anna's Archive) ---

  router.get("/books/search", async (c) => {
    const q = c.req.query("q") || "";
    if (!q) return c.json({ error: "Query required" }, 400);

    const source = c.req.query("source") || "all"; // "calibre", "aa", or "all"
    const ext = c.req.query("ext") || ""; // epub, pdf, etc.
    const lang = c.req.query("lang") || "";
    const content = c.req.query("content") || ""; // "audiobook" for audiobooks

    const response: {
      calibre: unknown[];
      annasArchive: unknown[];
    } = { calibre: [], annasArchive: [] };

    // Search Calibre first
    if (source !== "aa" && services.calibre) {
      try {
        const info = await services.calibre!.getLibraryInfo();
        const libraryId = info.default_library;
        const search = await services.calibre!.search(libraryId, q, 20, 0, "timestamp", "desc");
        if (search.book_ids.length > 0) {
          const books = await services.calibre!.getBooks(search.book_ids, libraryId);
          response.calibre = search.book_ids.map((id) => books[String(id)]).filter(Boolean);
        }
      } catch (err) {
        console.error("[book-search] Calibre search error:", err);
      }
    }

    // Search Anna's Archive
    if (source !== "calibre") {
      try {
        const results = await searchAnnasArchive(q, { lang, ext: ext || undefined, content: content || undefined });
        response.annasArchive = results;
      } catch (err) {
        console.error("[book-search] AA search error:", err);
      }
    }

    return c.json(response);
  });

  router.post("/books/download", async (c) => {
    if (!services.calibreExec) return c.json({ error: "Calibre exec not configured" }, 503);
    try {
      const { md5 } = await c.req.json<{ md5: string }>();
      if (!md5) return c.json({ error: "md5 required" }, 400);

      const apiKey = process.env.AA_API_KEY || "";

      // Download the book file
      const download = await downloadBook(md5, apiKey || undefined);
      if (!download.success || !download.filePath) {
        return c.json({ error: download.error || "Download failed" }, 500);
      }

      // Add to Calibre via calibredb add
      const result = await services.calibreExec!.addBook(download.filePath);

      // Clean up local temp file
      try { await Bun.spawn(["rm", "-f", download.filePath]).exited; } catch {}

      return c.json({
        success: true,
        bookId: result.bookId,
        fileName: download.fileName,
        output: result.output,
      });
    } catch (err) {
      console.error("[book-search] Download error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}
