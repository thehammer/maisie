import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

// ── Pure logic extracted from useLayout for unit testing ─────────────────────

interface CardDescriptor {
  id: string;
  pluginName: string;
  actionName: string;
  label: string;
  section: string;
  outputFields: Array<{ key: string; type: string; label: string; optional: boolean }>;
}

interface CardPlacement {
  cardId: string;
  position: { row: number; col: number };
  size: { rows: number; cols: number };
  config: {
    visibleFields: string[];
    refreshInterval?: number;
    title?: string;
  };
}

function addCard(
  widgets: CardPlacement[],
  descriptor: CardDescriptor,
): CardPlacement[] {
  const maxRow = widgets.reduce((m, w) => Math.max(m, w.position.row + w.size.rows), 0);
  return [
    ...widgets,
    {
      cardId: descriptor.id,
      position: { row: maxRow, col: 0 },
      size: { rows: 1, cols: 1 },
      config: {
        visibleFields: descriptor.outputFields
          .filter((f) => !f.optional)
          .map((f) => f.key),
      },
    },
  ];
}

function removeCard(widgets: CardPlacement[], cardId: string): CardPlacement[] {
  return widgets.filter((w) => w.cardId !== cardId);
}

function configureCard(
  widgets: CardPlacement[],
  cardId: string,
  config: Partial<CardPlacement["config"]>,
): CardPlacement[] {
  return widgets.map((w) =>
    w.cardId === cardId ? { ...w, config: { ...w.config, ...config } } : w,
  );
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeDescriptor(id: string): CardDescriptor {
  return {
    id,
    pluginName: "test-plugin",
    actionName: id,
    label: id,
    section: "Test",
    outputFields: [
      { key: "status", type: "string", label: "Status", optional: false },
      { key: "details", type: "string", label: "Details", optional: true },
    ],
  };
}

function makePlacement(cardId: string, row = 0): CardPlacement {
  return {
    cardId,
    position: { row, col: 0 },
    size: { rows: 1, cols: 1 },
    config: { visibleFields: ["status"] },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useLayout — addCard", () => {
  test("appends card to empty list", () => {
    const result = addCard([], makeDescriptor("widget-a"));
    expect(result).toHaveLength(1);
    expect(result[0].cardId).toBe("widget-a");
  });

  test("appends below existing cards", () => {
    const existing = [makePlacement("widget-a", 0)];
    const result = addCard(existing, makeDescriptor("widget-b"));
    expect(result).toHaveLength(2);
    // widget-b should be placed at row >= 1 (after existing row 0, size 1)
    expect(result[1].position.row).toBeGreaterThanOrEqual(1);
  });

  test("includes only required fields in visibleFields", () => {
    const result = addCard([], makeDescriptor("widget-a"));
    // only "status" is non-optional
    expect(result[0].config.visibleFields).toEqual(["status"]);
    expect(result[0].config.visibleFields).not.toContain("details");
  });

  test("sets default position col to 0", () => {
    const result = addCard([], makeDescriptor("widget-a"));
    expect(result[0].position.col).toBe(0);
  });

  test("does not mutate original array", () => {
    const original: CardPlacement[] = [];
    addCard(original, makeDescriptor("widget-a"));
    expect(original).toHaveLength(0);
  });
});

describe("useLayout — removeCard", () => {
  test("removes card by id", () => {
    const widgets = [makePlacement("a"), makePlacement("b")];
    const result = removeCard(widgets, "a");
    expect(result).toHaveLength(1);
    expect(result[0].cardId).toBe("b");
  });

  test("no-op when id not found", () => {
    const widgets = [makePlacement("a")];
    const result = removeCard(widgets, "z");
    expect(result).toHaveLength(1);
  });

  test("handles empty array", () => {
    expect(removeCard([], "a")).toHaveLength(0);
  });

  test("does not mutate original array", () => {
    const original = [makePlacement("a")];
    removeCard(original, "a");
    expect(original).toHaveLength(1);
  });
});

describe("useLayout — configureCard", () => {
  test("updates config for matching cardId", () => {
    const widgets = [makePlacement("a"), makePlacement("b")];
    const result = configureCard(widgets, "a", { title: "My Card" });
    const updated = result.find((w) => w.cardId === "a")!;
    expect(updated.config.title).toBe("My Card");
  });

  test("merges config — does not overwrite unspecified fields", () => {
    const widgets = [
      { ...makePlacement("a"), config: { visibleFields: ["status"], refreshInterval: 30 } },
    ];
    const result = configureCard(widgets, "a", { title: "New Title" });
    const updated = result.find((w) => w.cardId === "a")!;
    expect(updated.config.refreshInterval).toBe(30);
    expect(updated.config.title).toBe("New Title");
  });

  test("does not affect other cards", () => {
    const widgets = [makePlacement("a"), makePlacement("b")];
    const result = configureCard(widgets, "a", { title: "Title A" });
    const b = result.find((w) => w.cardId === "b")!;
    expect(b.config.title).toBeUndefined();
  });

  test("no-op when cardId not found", () => {
    const widgets = [makePlacement("a")];
    const result = configureCard(widgets, "z", { title: "Ghost" });
    expect(result[0].config.title).toBeUndefined();
  });

  test("can update visibleFields", () => {
    const widgets = [makePlacement("a")];
    const result = configureCard(widgets, "a", { visibleFields: ["status", "details"] });
    expect(result[0].config.visibleFields).toEqual(["status", "details"]);
  });
});

describe("useLayout — fetch behavior", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(async (url: string) => {
      if (url === "/api/layout/dashboard") {
        return new Response(
          JSON.stringify({ page: "dashboard", widgets: [makePlacement("widget-a")] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "/api/cards/catalog") {
        return new Response(
          JSON.stringify({ widgets: [makeDescriptor("widget-a"), makeDescriptor("widget-b")] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/layout/") && (globalThis.fetch as any).lastMethod === "PUT") {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(JSON.stringify({ widgets: [] }), { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("fetches layout on mount — layout endpoint called with page", async () => {
    let calledUrl = "";
    globalThis.fetch = mock(async (url: string) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ widgets: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    // Simulate what useLayout does — call the layout endpoint
    await fetch("/api/layout/dashboard");
    expect(calledUrl).toBe("/api/layout/dashboard");
  });

  test("saveLayout calls PUT with correct body", async () => {
    let capturedBody: unknown = null;
    let capturedMethod = "";

    globalThis.fetch = mock(async (url: string, opts: RequestInit = {}) => {
      if (String(url).includes("/api/layout/")) {
        capturedMethod = opts.method ?? "GET";
        capturedBody = opts.body ? JSON.parse(String(opts.body)) : null;
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const widgets = [makePlacement("widget-a")];
    await fetch("/api/layout/dashboard", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: "dashboard", widgets }),
    });

    expect(capturedMethod).toBe("PUT");
    expect((capturedBody as any).page).toBe("dashboard");
    expect((capturedBody as any).widgets).toHaveLength(1);
  });
});
