// TODO: AiClient will eventually import from a shared @maisie/ai package once the AI
// layer is extracted from the agent. For now we import the type directly from the agent.
import type { AiClient } from "../../../agent/src/services/ai";
import type { createCalibreClient } from "../client";

// TODO: Db type will move to a shared package once the DB layer is extracted.
type Db = ReturnType<typeof import("../../../agent/src/services/db").initDb>;
type Calibre = ReturnType<typeof createCalibreClient>;

import { calibreEnrichment } from "../../../agent/src/services/schema";
import { eq, and, isNull } from "drizzle-orm";
import { lookupBook } from "./lookup";
import { classifyGenre, detectSeries } from "./classifier";
import type { MetadataGaps } from "./scanner";

export interface PipelineOptions {
  batchSize?: number;
  skipLookup?: boolean;
  skipClassify?: boolean;
}

export interface PipelineResult {
  processed: number;
  lookupSuccess: number;
  classified: number;
  errors: number;
}

export async function runLookups(
  db: Db,
  options: { batchSize?: number } = {},
): Promise<{ processed: number; found: number; errors: number }> {
  const batchSize = options.batchSize || 10;

  const pending = db
    .select()
    .from(calibreEnrichment)
    .where(
      and(
        eq(calibreEnrichment.status, "pending"),
        isNull(calibreEnrichment.proposedChanges),
      ),
    )
    .limit(batchSize)
    .all();

  let found = 0;
  let errors = 0;

  for (const row of pending) {
    try {
      const authors = row.authors ? JSON.parse(row.authors) : [];
      const result = await lookupBook(row.bookId, row.title || "", authors);

      if (result && Object.keys(result.changes).length > 0) {
        db.update(calibreEnrichment)
          .set({
            proposedChanges: JSON.stringify(result.changes),
            changeSource: result.source,
            confidence: result.confidence,
            status: "enriched",
          })
          .where(eq(calibreEnrichment.bookId, row.bookId))
          .run();
        found++;
      } else {
        // Mark as enriched even with no results so we don't re-process
        db.update(calibreEnrichment)
          .set({ status: "enriched", changeSource: "none" })
          .where(eq(calibreEnrichment.bookId, row.bookId))
          .run();
      }
    } catch (err) {
      console.error(`[enrichment] Lookup error for book ${row.bookId}:`, err);
      db.update(calibreEnrichment)
        .set({ status: "error", errorMessage: String(err) })
        .where(eq(calibreEnrichment.bookId, row.bookId))
        .run();
      errors++;
    }
  }

  return { processed: pending.length, found, errors };
}

export async function runClassification(
  db: Db,
  claude: AiClient,
  calibre: Calibre,
  options: { batchSize?: number } = {},
): Promise<{ processed: number; classified: number; errors: number }> {
  const batchSize = options.batchSize || 20;

  // Get enriched books that still need tags
  const enriched = db
    .select()
    .from(calibreEnrichment)
    .where(eq(calibreEnrichment.status, "enriched"))
    .limit(batchSize)
    .all();

  let classified = 0;
  let errors = 0;

  // Build author → titles index for series detection
  const authorTitles = new Map<string, string[]>();
  const allEnriched = db.select().from(calibreEnrichment).all();
  for (const row of allEnriched) {
    const authors = row.authors ? JSON.parse(row.authors) : [];
    for (const author of authors) {
      if (!authorTitles.has(author)) authorTitles.set(author, []);
      authorTitles.get(author)!.push(row.title || "");
    }
  }

  for (const row of enriched) {
    try {
      const authors: string[] = row.authors ? JSON.parse(row.authors) : [];
      const gaps: MetadataGaps = row.gaps ? JSON.parse(row.gaps) : {};
      const existing = row.proposedChanges ? JSON.parse(row.proposedChanges) : {};

      let changed = false;

      // Classify genre if tags are missing
      if (gaps.tags && (!existing.tags || existing.tags.length === 0)) {
        // Get description from existing proposals or from Calibre
        let description: string | undefined;
        if (existing.description) {
          description = existing.description;
        } else {
          try {
            const info = await calibre.getLibraryInfo();
            const book = await calibre.getBook(row.bookId, row.libraryId || info.default_library);
            description = book.comments || undefined;
          } catch {}
        }

        const result = await classifyGenre(claude, row.title || "", authors, description);
        if (result.tags.length > 0) {
          existing.tags = result.tags;
          changed = true;
        }
      }

      // Detect series if missing
      if (gaps.series && !existing.series) {
        const otherTitles = authors
          .flatMap((a) => authorTitles.get(a) || [])
          .filter((t) => t !== row.title);

        if (otherTitles.length > 1) {
          const result = await detectSeries(claude, row.title || "", authors, otherTitles);
          if (result) {
            existing.series = result.series;
            existing.seriesIndex = result.seriesIndex;
            changed = true;
          }
        }
      }

      if (changed) {
        const newSource = row.changeSource === "none" ? "claude" : `${row.changeSource}+claude`;
        db.update(calibreEnrichment)
          .set({
            proposedChanges: JSON.stringify(existing),
            changeSource: newSource,
            confidence: Math.max(row.confidence || 0, 0.65),
            status: "enriched",
          })
          .where(eq(calibreEnrichment.bookId, row.bookId))
          .run();
        classified++;
      }
    } catch (err) {
      console.error(`[enrichment] Classification error for book ${row.bookId}:`, err);
      db.update(calibreEnrichment)
        .set({ errorMessage: String(err) })
        .where(eq(calibreEnrichment.bookId, row.bookId))
        .run();
      errors++;
    }
  }

  return { processed: enriched.length, classified, errors };
}

export async function runPipeline(
  db: Db,
  claude: AiClient,
  calibre: Calibre,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const batchSize = options.batchSize || 10;
  let lookupSuccess = 0;
  let classifiedCount = 0;
  let totalErrors = 0;

  // Step 1: External lookups
  if (!options.skipLookup) {
    const lookupResult = await runLookups(db, { batchSize });
    lookupSuccess = lookupResult.found;
    totalErrors += lookupResult.errors;
  }

  // Step 2: Claude classification
  if (!options.skipClassify) {
    const classifyResult = await runClassification(db, claude, calibre, { batchSize });
    classifiedCount = classifyResult.classified;
    totalErrors += classifyResult.errors;
  }

  return {
    processed: batchSize,
    lookupSuccess,
    classified: classifiedCount,
    errors: totalErrors,
  };
}
