// TODO: Db type will move to a shared package once the DB layer is extracted.
type Db = ReturnType<typeof import("../../../agent/src/services/db").initDb>;

import { calibreEnrichment, calibreAuthorMap } from "../../../agent/src/services/schema";
import { eq } from "drizzle-orm";
import type { CalibreExec } from "../exec";

interface ProposedChanges {
  tags?: string[];
  isbn?: string;
  series?: string;
  seriesIndex?: number;
  description?: string;
  authors?: string[];
}

export interface ApplyResult {
  bookId: number;
  success: boolean;
  fieldsApplied: string[];
  error?: string;
}

export async function applyEnrichment(
  db: Db,
  exec: CalibreExec,
  bookId: number,
): Promise<ApplyResult> {
  const row = db
    .select()
    .from(calibreEnrichment)
    .where(eq(calibreEnrichment.bookId, bookId))
    .get();

  if (!row) return { bookId, success: false, fieldsApplied: [], error: "Not found" };
  if (row.status !== "reviewed" && row.status !== "enriched") {
    return { bookId, success: false, fieldsApplied: [], error: `Invalid status: ${row.status}` };
  }

  const changes: ProposedChanges = row.proposedChanges ? JSON.parse(row.proposedChanges) : {};
  if (Object.keys(changes).length === 0) {
    return { bookId, success: false, fieldsApplied: [], error: "No changes to apply" };
  }

  const fields: Record<string, string> = {};
  const fieldsApplied: string[] = [];

  if (changes.tags && changes.tags.length > 0) {
    fields.tags = changes.tags.join(",");
    fieldsApplied.push("tags");
  }

  if (changes.isbn) {
    fields.identifiers = `isbn:${changes.isbn}`;
    fieldsApplied.push("identifiers");
  }

  if (changes.series) {
    fields.series = changes.series;
    if (changes.seriesIndex !== undefined) {
      fields.series_index = String(changes.seriesIndex);
    }
    fieldsApplied.push("series");
  }

  // Skip descriptions for now — long text with special chars is fragile over SSH
  // if (changes.description) {
  //   fields.comments = changes.description;
  //   fieldsApplied.push("description");
  // }

  if (changes.authors && changes.authors.length > 0) {
    fields.authors = changes.authors.join(" & ");
    fieldsApplied.push("authors");
  }

  try {
    await exec.setMetadata(bookId, fields);
    db.update(calibreEnrichment)
      .set({
        status: "applied",
        appliedAt: new Date().toISOString(),
      })
      .where(eq(calibreEnrichment.bookId, bookId))
      .run();
    return { bookId, success: true, fieldsApplied };
  } catch (err) {
    const errorMsg = String(err);
    db.update(calibreEnrichment)
      .set({ status: "error", errorMessage: errorMsg })
      .where(eq(calibreEnrichment.bookId, bookId))
      .run();
    return { bookId, success: false, fieldsApplied: [], error: errorMsg };
  }
}

export async function applyAllReviewed(
  db: Db,
  exec: CalibreExec,
): Promise<{ applied: number; errors: number; results: ApplyResult[] }> {
  const reviewed = db
    .select()
    .from(calibreEnrichment)
    .where(eq(calibreEnrichment.status, "reviewed"))
    .all();

  const results: ApplyResult[] = [];
  let applied = 0;
  let errors = 0;

  for (const row of reviewed) {
    const result = await applyEnrichment(db, exec, row.bookId);
    results.push(result);
    if (result.success) applied++;
    else errors++;
  }

  return { applied, errors, results };
}

export async function applyAuthorMerge(
  db: Db,
  exec: CalibreExec,
  variant: string,
  canonical: string,
): Promise<{ booksUpdated: number; errors: number }> {
  // Find all books with this author variant
  const allBooks = db.select().from(calibreEnrichment).all();
  let booksUpdated = 0;
  let errors = 0;

  for (const row of allBooks) {
    const authors: string[] = row.authors ? JSON.parse(row.authors) : [];
    if (!authors.includes(variant)) continue;

    const newAuthors = authors.map((a) => (a === variant ? canonical : a));

    try {
      await exec.setMetadata(row.bookId, { authors: newAuthors.join(" & ") });
      booksUpdated++;
    } catch (err) {
      console.error(`[enrichment] Author merge error for book ${row.bookId}:`, err);
      errors++;
    }
  }

  // Update the author map
  const existing = db
    .select()
    .from(calibreAuthorMap)
    .where(eq(calibreAuthorMap.variant, variant))
    .get();

  if (existing) {
    db.update(calibreAuthorMap)
      .set({ canonical })
      .where(eq(calibreAuthorMap.variant, variant))
      .run();
  } else {
    db.insert(calibreAuthorMap)
      .values({ variant, canonical })
      .run();
  }

  return { booksUpdated, errors };
}
