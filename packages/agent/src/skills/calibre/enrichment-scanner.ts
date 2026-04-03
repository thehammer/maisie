import type { CalibreBook, createCalibreClient } from "./calibre-client";
import { calibreEnrichment } from "../../services/schema";
import { eq } from "drizzle-orm";

type Db = ReturnType<typeof import("../../services/db").initDb>;
type Calibre = ReturnType<typeof createCalibreClient>;

export interface MetadataGaps {
  tags: boolean;
  identifiers: boolean;
  series: boolean;
  rating: boolean;
  description: boolean;
  author: boolean;
}

export function detectGaps(book: CalibreBook): MetadataGaps {
  return {
    tags: book.tags.length === 0,
    identifiers: Object.keys(book.identifiers).length === 0,
    series: book.series === null || book.series === "",
    rating: book.rating === 0,
    description: book.comments === null || book.comments === "" || book.comments === "<p></p>",
    author: book.authors.length === 0 || book.authors.includes("Unknown"),
  };
}

export function hasGaps(gaps: MetadataGaps): boolean {
  return Object.values(gaps).some(Boolean);
}

export function gapCount(gaps: MetadataGaps): number {
  return Object.values(gaps).filter(Boolean).length;
}

export interface ScanResult {
  totalBooks: number;
  booksWithGaps: number;
  newlyAdded: number;
  updated: number;
  gapBreakdown: Record<keyof MetadataGaps, number>;
}

export async function scanLibrary(
  db: Db,
  calibre: Calibre,
  libraryId?: string,
): Promise<ScanResult> {
  const info = await calibre.getLibraryInfo();
  const libId = libraryId || info.default_library;

  const allBooks = await calibre.getAllBooks(libId);
  const scanDate = new Date().toISOString();

  let booksWithGaps = 0;
  let newlyAdded = 0;
  let updated = 0;
  const gapBreakdown: Record<string, number> = {
    tags: 0,
    identifiers: 0,
    series: 0,
    rating: 0,
    description: 0,
    author: 0,
  };

  for (const book of allBooks) {
    const gaps = detectGaps(book);
    const gapsPresent = hasGaps(gaps);
    if (gapsPresent) booksWithGaps++;

    for (const [key, missing] of Object.entries(gaps)) {
      if (missing) gapBreakdown[key]++;
    }

    // Check if already in enrichment table
    const existing = db
      .select()
      .from(calibreEnrichment)
      .where(eq(calibreEnrichment.bookId, book.application_id))
      .get();

    if (existing) {
      // Only update if book still has gaps and hasn't been applied yet
      if (gapsPresent && existing.status !== "applied" && existing.status !== "skipped") {
        db.update(calibreEnrichment)
          .set({
            title: book.title,
            authors: JSON.stringify(book.authors),
            gaps: JSON.stringify(gaps),
            scanDate,
          })
          .where(eq(calibreEnrichment.bookId, book.application_id))
          .run();
        updated++;
      }
    } else if (gapsPresent) {
      db.insert(calibreEnrichment)
        .values({
          bookId: book.application_id,
          libraryId: libId,
          title: book.title,
          authors: JSON.stringify(book.authors),
          status: "pending",
          scanDate,
          gaps: JSON.stringify(gaps),
        })
        .run();
      newlyAdded++;
    }
  }

  return {
    totalBooks: allBooks.length,
    booksWithGaps,
    newlyAdded,
    updated,
    gapBreakdown: gapBreakdown as Record<keyof MetadataGaps, number>,
  };
}
