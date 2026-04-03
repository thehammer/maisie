import type { CalibreBook } from "./client";

// TODO: Db type will move to a shared package once the DB layer is extracted.
type Db = ReturnType<typeof import("../../agent/src/services/db").initDb>;

import { calibreAuthorMap } from "../../agent/src/services/schema";
import { eq } from "drizzle-orm";

export interface AuthorVariant {
  variant: string;
  canonical: string;
  bookCount: number;
}

// "Patterson, James" → "James Patterson"
function invertedToNatural(name: string): string {
  const parts = name.split(",").map((s) => s.trim());
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
  return name;
}

// Normalize for comparison: lowercase, strip periods/accents, collapse whitespace
function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectAuthorVariants(books: CalibreBook[]): AuthorVariant[] {
  // Collect all author names and their counts
  const authorCounts = new Map<string, number>();
  for (const book of books) {
    for (const author of book.authors) {
      authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
    }
  }

  // Group by normalized key
  const groups = new Map<string, { names: Map<string, number> }>();
  for (const [author, count] of authorCounts) {
    const key = normalizeKey(invertedToNatural(author));
    if (!groups.has(key)) {
      groups.set(key, { names: new Map() });
    }
    groups.get(key)!.names.set(author, count);
  }

  const variants: AuthorVariant[] = [];

  for (const group of groups.values()) {
    if (group.names.size <= 1) continue;

    // Pick canonical: prefer natural order ("First Last") and most-used
    let canonical = "";
    let maxCount = 0;
    for (const [name, count] of group.names) {
      const isNatural = !name.includes(",");
      if (!canonical || (isNatural && count >= maxCount) || count > maxCount) {
        canonical = name;
        maxCount = count;
      }
    }

    for (const [name, count] of group.names) {
      if (name !== canonical) {
        variants.push({ variant: name, canonical, bookCount: count });
      }
    }
  }

  return variants;
}

export function saveAuthorMap(db: Db, variants: AuthorVariant[]): number {
  let saved = 0;
  for (const v of variants) {
    const existing = db
      .select()
      .from(calibreAuthorMap)
      .where(eq(calibreAuthorMap.variant, v.variant))
      .get();

    if (!existing) {
      db.insert(calibreAuthorMap)
        .values({ variant: v.variant, canonical: v.canonical })
        .run();
      saved++;
    }
  }
  return saved;
}

export function getAuthorMap(db: Db): { variant: string; canonical: string }[] {
  return db.select().from(calibreAuthorMap).all();
}
