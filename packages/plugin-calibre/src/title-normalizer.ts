// Clean up dirty Calibre titles for better lookup matching

export function normalizeTitle(title: string): string {
  let t = title;

  // Replace underscores with spaces: A_Fire_in_the_Flesh_Kobo → A Fire in the Flesh Kobo
  t = t.replace(/_/g, " ");

  // Strip store suffixes: "... Kobo", "... Amazon", "... Kindle"
  t = t.replace(/\s+(Kobo|Amazon|Kindle|Nook|Audible)$/i, "");

  // Strip numbered prefixes: "13. DEAD FALL by Brad Thor" → "DEAD FALL"
  t = t.replace(/^\d+\.\s+/, "");

  // Strip "by Author Name" suffix (only when preceded by the actual title in ALL CAPS or normal case)
  t = t.replace(/\s+by\s+[A-Z][a-zA-Z\s.]+$/, "");

  // Strip parenthesized ISBNs: "(9781982185848)"
  t = t.replace(/\s*\(\d{10,13}\)\s*/g, "");

  // Strip parenthesized series info: "(Alex Cross)", "(Orphan X)", "(A Court of Thorns and Roses)"
  // But keep the main title
  t = t.replace(/\s*\([^)]*(?:Series|Book|Novel|Part|Trilogy|Diaries|Vol)[^)]*\)/gi, "");
  t = t.replace(/\s*\([^)]*(?:Alex Cross|Joe Pickett|Michael Bennett|Crescent City|Beartown|Legends & Lattes|Song of Ice|Ruinous Love|UCMH|Rose Hill|Campus|Knockemout|Maybe Someday|Court of Thorns|Dragon Heart|Temperance Brennan|Scarpetta)[^)]*\)/gi, "");

  // Strip subtitle marketing fluff after colon
  const fluffPatterns = [
    /:\s*An? (?:absolutely )?(?:addictive|gripping|darkest|dark) .*$/i,
    /:\s*A (?:Brother's Best Friend|Dark Academia) .*$/i,
  ];
  for (const pattern of fluffPatterns) {
    t = t.replace(pattern, "");
  }

  // Strip "-- A Novel", ": A Novel", "(A Novel)", ": a Novel"
  t = t.replace(/\s*[-–—]+\s*A Novel$/i, "");
  t = t.replace(/:\s*[Aa] Novel$/i, "");
  t = t.replace(/\s*\(A Novel\)/i, "");

  // Strip "-- The ..., Book N"
  t = t.replace(/\s*[-–—]+\s*The [^,]+,\s*Book \d+$/i, "");

  // Strip "with 2nd Epilogue" etc
  t = t.replace(/\s+with \d+(?:st|nd|rd|th) Epilogue$/i, "");

  // Strip "(year)" at end: "- Alex Cross Series 30 (2022)"
  t = t.replace(/\s*\(\d{4}\)\s*$/, "");

  // Strip "- Series Name Series N" pattern
  t = t.replace(/\s*-\s*[A-Z][a-zA-Z\s]+ Series \d+$/, "");

  // Fix "Crescent: City House of Flame and Shadow" → "House of Flame and Shadow"
  // This is a specific known garble — the series name got merged into the title
  if (t === "Crescent: City House of Flame and Shadow") {
    t = "House of Flame and Shadow";
  }

  // Normalize double dashes
  t = t.replace(/\s*[-–—]{2,}\s*/g, ": ");

  // Normalize extra spaces around colons
  t = t.replace(/\s*:\s*/g, ": ").trim();

  // Collapse multiple spaces
  t = t.replace(/\s+/g, " ").trim();

  return t;
}

// Extract series info from parenthesized text that we stripped
export function extractSeriesFromTitle(title: string): { series?: string; index?: number } | null {
  // "(Series Name Book N)"
  const bookMatch = title.match(/\(([^)]+)\s+Book\s+(\d+)\)/i);
  if (bookMatch) return { series: bookMatch[1].trim(), index: Number(bookMatch[2]) };

  // "(Series Name part N)"
  const partMatch = title.match(/\(([^)]+)\s+part\s+(\w+)\)/i);
  if (partMatch) {
    const idx = partMatch[2].toLowerCase() === "two" ? 2 : partMatch[2].toLowerCase() === "three" ? 3 : Number(partMatch[2]) || 1;
    return { series: partMatch[1].trim(), index: idx };
  }

  // "Series Name Series N (year)"
  const seriesMatch = title.match(/-\s*([A-Z][a-zA-Z\s]+) Series (\d+)/);
  if (seriesMatch) return { series: seriesMatch[1].trim(), index: Number(seriesMatch[2]) };

  // "(Beartown Series)", "(Alex Cross)"
  const namedMatch = title.match(/\(([^)]+(?:Series|Cross|Pickett|Bennett))[^)]*\)/i);
  if (namedMatch) return { series: namedMatch[1].replace(/\s*Series\s*$/, "").trim() };

  return null;
}
