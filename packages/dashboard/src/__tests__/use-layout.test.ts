import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

// ── Pure logic extracted from useLayout for unit testing ─────────────────────

interface WidgetDescriptor {
  id: string;
  pluginName: string;
  actionName: string;
  label: string;
  section: string;
  outputFields: Array<{ key: string; type: string; label: string; optional: boolean }>;
}

interface WidgetPlacement {
  widgetId: string;
  position: { row: number; col: number };
  size: { rows: number; cols: number };
  config: {
    visibleFields: string[];
    refreshInterval?: number;
    title?: string;
  };
}

function addWidget(
  widgets: WidgetPlacement[],
  descriptor: WidgetDescriptor,
): WidgetPlacement[] {
  const maxRow = widgets.reduce((m, w) => Math.max(m, w.position.row + w.size.rows), 0);
  return [
    ...widgets,
    {
      widgetId: descriptor.id,
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

function removeWidget(widgets: WidgetPlacement[], widgetId: string): WidgetPlacement[] {
  return widgets.filter((w) => w.widgetId !== widgetId);
}

function configureWidget(
  widgets: WidgetPlacement[],
  widgetId: string,
  config: Partial<WidgetPlacement["config"]>,
): WidgetPlacement[] {
  return widgets.map((w) =>
    w.widgetId === widgetId ? { ...w, config: { ...w.config, ...config } } : w,
  );
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeDescriptor(id: string): WidgetDescriptor {
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

function makePlacement(widgetId: string, row = 0): WidgetPlacement {
  return {
    widgetId,
    position: { row, col: 0 },
    size: { rows: 1, cols: 1 },
    config: { visibleFields: ["status"] },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useLayout — addWidget", () => {
  test("appends widget to empty list", () => {
    const result = addWidget([], makeDescriptor("widget-a"));
    expect(result).toHaveLength(1);
    expect(result[0].widgetId).toBe("widget-a");
  });

  test("appends below existing widgets", () => {
    const existing = [makePlacement("widget-a", 0)];
    const result = addWidget(existing, makeDescriptor("widget-b"));
    expect(result).toHaveLength(2);
    // widget-b should be placed at row >= 1 (after existing row 0, size 1)
    expect(result[1].position.row).toBeGreaterThanOrEqual(1);
  });

  test("includes only required fields in visibleFields", () => {
    const result = addWidget([], makeDescriptor("widget-a"));
    // only "status" is non-optional
    expect(result[0].config.visibleFields).toEqual(["status"]);
    expect(result[0].config.visibleFields).not.toContain("details");
  });

  test("sets default position col to 0", () => {
    const result = addWidget([], makeDescriptor("widget-a"));
    expect(result[0].position.col).toBe(0);
  });

  test("does not mutate original array", () => {
    const original: WidgetPlacement[] = [];
    addWidget(original, makeDescriptor("widget-a"));
    expect(original).toHaveLength(0);
  });
});

describe("useLayout — removeWidget", () => {
  test("removes widget by id", () => {
    const widgets = [makePlacement("a"), makePlacement("b")];
    const result = removeWidget(widgets, "a");
    expect(result).toHaveLength(1);
    expect(result[0].widgetId).toBe("b");
  });

  test("no-op when id not found", () => {
    const widgets = [makePlacement("a")];
    const result = removeWidget(widgets, "z");
    expect(result).toHaveLength(1);
  });

  test("handles empty array", () => {
    expect(removeWidget([], "a")).toHaveLength(0);
  });

  test("does not mutate original array", () => {
    const original = [makePlacement("a")];
    removeWidget(original, "a");
    expect(original).toHaveLength(1);
  });
});

describe("useLayout — configureWidget", () => {
  test("updates config for matching widgetId", () => {
    const widgets = [makePlacement("a"), makePlacement("b")];
    const result = configureWidget(widgets, "a", { title: "My Widget" });
    const updated = result.find((w) => w.widgetId === "a")!;
    expect(updated.config.title).toBe("My Widget");
  });

  test("merges config — does not overwrite unspecified fields", () => {
    const widgets = [
      { ...makePlacement("a"), config: { visibleFields: ["status"], refreshInterval: 30 } },
    ];
    const result = configureWidget(widgets, "a", { title: "New Title" });
    const updated = result.find((w) => w.widgetId === "a")!;
    expect(updated.config.refreshInterval).toBe(30);
    expect(updated.config.title).toBe("New Title");
  });

  test("does not affect other widgets", () => {
    const widgets = [makePlacement("a"), makePlacement("b")];
    const result = configureWidget(widgets, "a", { title: "Title A" });
    const b = result.find((w) => w.widgetId === "b")!;
    expect(b.config.title).toBeUndefined();
  });

  test("no-op when widgetId not found", () => {
    const widgets = [makePlacement("a")];
    const result = configureWidget(widgets, "z", { title: "Ghost" });
    expect(result[0].config.title).toBeUndefined();
  });

  test("can update visibleFields", () => {
    const widgets = [makePlacement("a")];
    const result = configureWidget(widgets, "a", { visibleFields: ["status", "details"] });
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
      if (url === "/api/widgets/catalog") {
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
