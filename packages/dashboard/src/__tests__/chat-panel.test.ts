import { describe, test, expect } from "bun:test";

// Extracted logic from ChatPanel — tested in isolation

const MENTION_RE = /@(natalie|channing|alexandria|maisie)\b/i;

function detectMention(text: string): string | undefined {
  const m = text.match(MENTION_RE);
  return m ? m[1].toLowerCase() : undefined;
}

const PERSONA_COLORS: Record<string, string> = {
  maisie: "var(--accent)",
  natalie: "#38bdf8",
  channing: "#c084fc",
  alexandria: "#fbbf24",
};

function personaColor(name: string): string {
  return PERSONA_COLORS[name.toLowerCase()] ?? "var(--accent)";
}

function parseSseChunks(raw: string): string[] {
  const lines = raw.split("\n");
  const chunks: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6);
    if (data !== "[DONE]") chunks.push(data);
  }
  return chunks;
}

describe("ChatPanel — detectMention", () => {
  test("returns undefined when no mention present", () => {
    expect(detectMention("hello maisie how are you")).toBeUndefined();
  });

  test("detects @natalie", () => {
    expect(detectMention("@natalie what's the wifi like?")).toBe("natalie");
  });

  test("detects @channing case-insensitively", () => {
    expect(detectMention("@Channing show me TV")).toBe("channing");
  });

  test("detects @alexandria", () => {
    expect(detectMention("@alexandria find me a book")).toBe("alexandria");
  });

  test("detects @maisie", () => {
    expect(detectMention("@maisie what's the status?")).toBe("maisie");
  });

  test("picks up first mention in text", () => {
    expect(detectMention("@natalie and @channing both?")).toBe("natalie");
  });

  test("requires @ prefix — bare name returns undefined", () => {
    expect(detectMention("natalie check devices")).toBeUndefined();
  });
});

describe("ChatPanel — personaColor", () => {
  test("maisie returns accent", () => {
    expect(personaColor("maisie")).toBe("var(--accent)");
  });

  test("natalie returns blue", () => {
    expect(personaColor("natalie")).toBe("#38bdf8");
  });

  test("channing returns purple", () => {
    expect(personaColor("channing")).toBe("#c084fc");
  });

  test("alexandria returns amber", () => {
    expect(personaColor("alexandria")).toBe("#fbbf24");
  });

  test("unknown persona falls back to accent", () => {
    expect(personaColor("unknown-bot")).toBe("var(--accent)");
  });

  test("case insensitive lookup", () => {
    expect(personaColor("NATALIE")).toBe("#38bdf8");
  });
});

describe("ChatPanel — SSE chunk parsing", () => {
  test("extracts text from data lines", () => {
    const raw = "data: Hello\n\ndata:  world\n\n";
    expect(parseSseChunks(raw)).toEqual(["Hello", " world"]);
  });

  test("skips [DONE] sentinel", () => {
    const raw = "data: chunk\n\ndata: [DONE]\n\n";
    expect(parseSseChunks(raw)).toEqual(["chunk"]);
  });

  test("ignores non-data lines", () => {
    const raw = "event: message\ndata: text\n\n";
    expect(parseSseChunks(raw)).toEqual(["text"]);
  });

  test("handles empty stream", () => {
    expect(parseSseChunks("")).toEqual([]);
  });

  test("handles stream with only [DONE]", () => {
    expect(parseSseChunks("data: [DONE]\n\n")).toEqual([]);
  });

  test("accumulates multiple chunks correctly", () => {
    const chunks = ["Hello", ", ", "world", "!"];
    const raw = chunks.map((c) => `data: ${c}\n\n`).join("");
    expect(parseSseChunks(raw).join("")).toBe("Hello, world!");
  });
});
