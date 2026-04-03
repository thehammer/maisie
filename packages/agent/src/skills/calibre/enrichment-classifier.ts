import type { AiClient } from "../../services/ai";
import { z } from "zod";

const CONTROLLED_TAGS = [
  "Thriller", "Mystery", "Romance", "Fantasy", "Science Fiction", "Horror",
  "Historical Fiction", "Literary Fiction", "Young Adult", "Crime", "Suspense",
  "Adventure", "Biography", "Self-Help", "Memoir", "True Crime", "Dystopian",
  "Paranormal", "Urban Fantasy", "Epic Fantasy", "Military Fiction",
  "Espionage", "Psychological Thriller", "Cozy Mystery", "Hard-Boiled",
  "Romantic Suspense", "Space Opera", "Cyberpunk", "Steampunk",
  "Contemporary Fiction", "Classic Literature", "Humor", "Satire",
  "Philosophy", "History", "Science", "Technology", "Business",
  "Nonfiction", "Fiction", "Poetry", "Drama",
];

export interface ClassifyResult {
  tags: string[];
  confidence: number;
}

export async function classifyGenre(
  claude: AiClient,
  title: string,
  authors: string[],
  description?: string,
  existingTags?: string[],
): Promise<ClassifyResult> {
  const existing = existingTags?.length ? `\nExisting tags: ${existingTags.join(", ")}` : "";
  const desc = description ? `\nDescription: ${description.slice(0, 500)}` : "";

  const result = await claude.generate({
    schema: z.object({ tags: z.array(z.string()).max(5) }),
    schemaName: "GenreClassification",
    model: "claude-haiku-4-5",
    system: `You classify books into genre tags. Available tags: ${CONTROLLED_TAGS.join(", ")}. Return 1-5 tags that best fit the book.`,
    messages: [
      {
        role: "user",
        content: `Title: ${title}\nAuthor: ${authors.join(", ")}${desc}${existing}`,
      },
    ],
    maxTokens: 100,
    temperature: 0,
  });

  return {
    tags: result.tags,
    confidence: description ? 0.85 : 0.65,
  };
}

export interface SeriesResult {
  series: string;
  seriesIndex: number;
  confidence: number;
}

export async function detectSeries(
  claude: AiClient,
  title: string,
  authors: string[],
  otherTitles: string[],
): Promise<SeriesResult | null> {
  if (otherTitles.length === 0) return null;

  const result = await claude.generate({
    schema: z.object({
      series: z.string().nullable(),
      index: z.number().nullable(),
    }),
    schemaName: "SeriesDetection",
    model: "claude-haiku-4-5",
    system: `You detect if a book belongs to a series. Given a book title and other titles by the same author, determine if the book is part of a series. If yes, return the series name and index. If no, return null for both fields.`,
    messages: [
      {
        role: "user",
        content: `Book: "${title}" by ${authors.join(", ")}\n\nOther books by this author:\n${otherTitles.slice(0, 20).map((t) => `- ${t}`).join("\n")}`,
      },
    ],
    maxTokens: 100,
    temperature: 0,
  });

  if (result.series) {
    return {
      series: result.series,
      seriesIndex: result.index ?? 1,
      confidence: 0.7,
    };
  }

  return null;
}

export interface AmbiguousMatchResult {
  bestMatchIndex: number;
  confidence: number;
  reasoning: string;
}

export async function resolveAmbiguousMatch(
  claude: AiClient,
  title: string,
  authors: string[],
  candidates: { title: string; authors: string; description?: string }[],
): Promise<AmbiguousMatchResult | null> {
  const result = await claude.generate({
    schema: z.object({
      index: z.number().nullable(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
    }),
    schemaName: "AmbiguousMatchResolution",
    model: "claude-sonnet-4-6",
    system: `You match books to the best candidate from search results. index is 0-based. If no good match exists, set index to null.`,
    messages: [
      {
        role: "user",
        content: `Looking for: "${title}" by ${authors.join(", ")}\n\nCandidates:\n${candidates.map((c, i) => `${i}. "${c.title}" by ${c.authors}${c.description ? ` — ${c.description.slice(0, 100)}` : ""}`).join("\n")}`,
      },
    ],
    maxTokens: 200,
    temperature: 0,
  });

  if (result.index !== null && typeof result.index === "number") {
    return {
      bestMatchIndex: result.index,
      confidence: result.confidence,
      reasoning: result.reasoning,
    };
  }

  return null;
}
