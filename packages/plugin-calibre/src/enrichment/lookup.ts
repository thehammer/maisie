interface ProposedChanges {
  tags?: string[];
  isbn?: string;
  series?: string;
  seriesIndex?: number;
  description?: string;
}

interface LookupResult {
  source: "openlibrary" | "googlebooks";
  tags: string[];
  isbn?: string;
  series?: string;
  seriesIndex?: number;
  description?: string;
  confidence: number;
}

// --- Open Library ---

async function searchOpenLibrary(title: string, author: string): Promise<LookupResult | null> {
  const params = new URLSearchParams({
    title,
    author,
    limit: "3",
    fields: "title,author_name,subject,isbn,first_sentence,key",
  });
  const res = await fetch(`https://openlibrary.org/search.json?${params}`);
  if (!res.ok) return null;

  const data = (await res.json()) as any;
  if (!data.docs || data.docs.length === 0) return null;

  const doc = data.docs[0];
  const titleSimilarity = fuzzyMatch(title, doc.title || "");
  if (titleSimilarity < 0.5) return null;

  const tags = (doc.subject || [])
    .filter((s: string) => !isNoiseTag(s))
    .slice(0, 10)
    .map((s: string) => normalizeTag(s))
    .filter(Boolean);
  // Prefer ISBN-13 over ISBN-10
  const isbn = doc.isbn?.find((i: string) => i.length === 13) || doc.isbn?.[0] || undefined;

  let series: string | undefined;
  let seriesIndex: number | undefined;
  // Open Library sometimes has series info in the seed field or other locations
  // We'll rely more on Claude for series detection

  return {
    source: "openlibrary",
    tags,
    isbn,
    series,
    seriesIndex,
    description: undefined, // Open Library descriptions require a separate API call
    confidence: titleSimilarity,
  };
}

// --- Google Books ---

async function searchGoogleBooks(title: string, author: string): Promise<LookupResult | null> {
  const q = `intitle:${title} inauthor:${author}`;
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=3`);
  if (!res.ok) return null;

  const data = (await res.json()) as any;
  if (!data.items || data.items.length === 0) return null;

  const item = data.items[0].volumeInfo;
  const titleSimilarity = fuzzyMatch(title, item.title || "");
  if (titleSimilarity < 0.4) return null;

  const tags = (item.categories || []).map((c: string) => normalizeTag(c)).filter(Boolean);
  const isbn = item.industryIdentifiers?.find((id: any) => id.type === "ISBN_13")?.identifier
    || item.industryIdentifiers?.find((id: any) => id.type === "ISBN_10")?.identifier;

  return {
    source: "googlebooks",
    tags,
    isbn,
    description: item.description || undefined,
    confidence: titleSimilarity,
  };
}

// --- Tag normalization ---

const TAG_MAP: Record<string, string> = {
  thrillers: "Thriller",
  thriller: "Thriller",
  "mystery & detective": "Mystery",
  "mystery and detective": "Mystery",
  mysteries: "Mystery",
  mystery: "Mystery",
  romance: "Romance",
  "science fiction": "Science Fiction",
  "sci-fi": "Science Fiction",
  fantasy: "Fantasy",
  horror: "Horror",
  "historical fiction": "Historical Fiction",
  "literary fiction": "Literary Fiction",
  "young adult": "Young Adult",
  "young adult fiction": "Young Adult",
  crime: "Crime",
  suspense: "Suspense",
  adventure: "Adventure",
  biography: "Biography",
  "biography & autobiography": "Biography",
  "self-help": "Self-Help",
  "self help": "Self-Help",
  fiction: "Fiction",
  "general fiction": "Fiction",
  nonfiction: "Nonfiction",
  "non-fiction": "Nonfiction",
};

function isNoiseTag(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.startsWith("nyt:") ||
    lower.startsWith("collectionid:") ||
    lower.startsWith("reading level") ||
    lower.includes("fiction,") || // OL-specific compound tags like "Fiction, General"
    lower.includes(", fiction") || // OL reverse compound like "Hollywood, Fiction"
    lower === "new york times bestseller" ||
    lower === "new york times reviewed" ||
    lower === "large type books" ||
    lower === "large print books" ||
    lower === "accessible book" ||
    lower === "protected daisy" ||
    lower === "lending library" ||
    lower === "in library" ||
    lower === "printdisabled" ||
    lower === "overdrive" ||
    lower.length > 50
  );
}

function normalizeTag(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (TAG_MAP[lower]) return TAG_MAP[lower];
  // Capitalize first letter of each word
  return raw
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// --- Fuzzy match ---

function fuzzyMatch(a: string, b: string): number {
  const na = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nb = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (na === nb) return 1.0;
  if (na.length === 0 || nb.length === 0) return 0;

  // Longest common subsequence ratio
  const m = na.length;
  const n = nb.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = na[i - 1] === nb[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (2 * dp[m][n]) / (m + n);
}

// --- Merge logic ---

function mergeResults(results: LookupResult[]): { changes: ProposedChanges; source: string; confidence: number } {
  const allTags = new Set<string>();
  let isbn: string | undefined;
  let description: string | undefined;
  let series: string | undefined;
  let seriesIndex: number | undefined;
  let maxConfidence = 0;
  const sources: string[] = [];

  for (const r of results) {
    sources.push(r.source);
    maxConfidence = Math.max(maxConfidence, r.confidence);
    for (const tag of r.tags) allTags.add(tag);
    // Prefer Open Library ISBN
    if (r.isbn && !isbn) isbn = r.isbn;
    // Prefer longer description
    if (r.description && (!description || r.description.length > description.length)) {
      description = r.description;
    }
    if (r.series && !series) {
      series = r.series;
      seriesIndex = r.seriesIndex;
    }
  }

  const changes: ProposedChanges = {};
  if (allTags.size > 0) changes.tags = [...allTags];
  if (isbn) changes.isbn = isbn;
  if (description) changes.description = description;
  if (series) {
    changes.series = series;
    changes.seriesIndex = seriesIndex;
  }

  return {
    changes,
    source: sources.length > 1 ? "merged" : sources[0],
    confidence: maxConfidence,
  };
}

// --- Rate limiter ---

let lastOpenLibraryCall = 0;
const OL_MIN_INTERVAL = 3000; // 3 seconds between calls

async function rateLimitedOL(title: string, author: string): Promise<LookupResult | null> {
  const now = Date.now();
  const wait = OL_MIN_INTERVAL - (now - lastOpenLibraryCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastOpenLibraryCall = Date.now();
  return searchOpenLibrary(title, author);
}

// --- Public API ---

export interface LookupOutput {
  bookId: number;
  changes: ProposedChanges;
  source: string;
  confidence: number;
}

export async function lookupBook(
  bookId: number,
  title: string,
  authors: string[],
): Promise<LookupOutput | null> {
  const author = authors[0] || "";
  const results: LookupResult[] = [];

  try {
    const ol = await rateLimitedOL(title, author);
    if (ol) results.push(ol);
  } catch (err) {
    console.error(`[enrichment] Open Library error for "${title}":`, err);
  }

  try {
    const gb = await searchGoogleBooks(title, author);
    if (gb) results.push(gb);
  } catch (err) {
    console.error(`[enrichment] Google Books error for "${title}":`, err);
  }

  if (results.length === 0) return null;

  const merged = mergeResults(results);
  if (Object.keys(merged.changes).length === 0) return null;

  return {
    bookId,
    changes: merged.changes,
    source: merged.source,
    confidence: merged.confidence,
  };
}
