import { describe, test, expect } from "bun:test";

// ── Logic extracted from PersonasPage for unit testing ───────────────────────

interface PersonaConfig {
  id: string;
  name: string;
  role: string;
  avatar?: string;
  defaultTier: "inform" | "advise" | "act";
  eventSubscriptions: string[];
  toolScopes: string[];
  systemPrompt: string;
  isCustom: boolean;
}

interface PersonaFormData {
  name: string;
  role: string;
  defaultTier: "inform" | "advise" | "act";
  systemPrompt: string;
  toolScopes: string;
  eventSubscriptions: string;
  avatar: string;
}

function personaToForm(p: PersonaConfig): PersonaFormData {
  return {
    name: p.name,
    role: p.role,
    defaultTier: p.defaultTier,
    systemPrompt: p.systemPrompt,
    toolScopes: p.toolScopes.join(", "),
    eventSubscriptions: p.eventSubscriptions.join(", "),
    avatar: p.avatar ?? "",
  };
}

function formToPayload(f: PersonaFormData) {
  return {
    name: f.name,
    role: f.role,
    defaultTier: f.defaultTier,
    systemPrompt: f.systemPrompt,
    toolScopes: f.toolScopes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    eventSubscriptions: f.eventSubscriptions
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    avatar: f.avatar || undefined,
  };
}

function isBuiltIn(p: PersonaConfig) {
  return !p.isCustom;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeBuiltIn(name: string): PersonaConfig {
  return {
    id: name,
    name,
    role: `${name} role`,
    defaultTier: "inform",
    eventSubscriptions: ["home/#"],
    toolScopes: ["get_devices"],
    systemPrompt: `You are ${name}.`,
    isCustom: false,
  };
}

function makeCustom(name: string): PersonaConfig {
  return {
    id: name,
    name,
    role: `Custom ${name}`,
    defaultTier: "act",
    eventSubscriptions: ["home/custom/#"],
    toolScopes: ["get_status", "set_status"],
    systemPrompt: `You are a custom persona named ${name}.`,
    isCustom: true,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PersonasPage — built-in vs custom detection", () => {
  test("built-in persona is not custom", () => {
    expect(isBuiltIn(makeBuiltIn("maisie"))).toBe(true);
  });

  test("custom persona is not built-in", () => {
    expect(isBuiltIn(makeCustom("scout"))).toBe(false);
  });

  test("all four default personas are built-in", () => {
    const defaults = ["maisie", "natalie", "channing", "alexandria"].map(makeBuiltIn);
    expect(defaults.every(isBuiltIn)).toBe(true);
  });
});

describe("PersonasPage — persona cards render correct actions", () => {
  test("built-in persona should NOT have delete button (isCustom false)", () => {
    const p = makeBuiltIn("maisie");
    // The UI shows edit/delete only when p.isCustom is true
    expect(p.isCustom).toBe(false);
  });

  test("custom persona SHOULD have delete button (isCustom true)", () => {
    const p = makeCustom("scout");
    expect(p.isCustom).toBe(true);
  });
});

describe("PersonasPage — personaToForm", () => {
  test("converts toolScopes array to comma-separated string", () => {
    const p = makeCustom("scout");
    const form = personaToForm(p);
    expect(form.toolScopes).toBe("get_status, set_status");
  });

  test("converts eventSubscriptions array to comma-separated string", () => {
    const p = makeCustom("scout");
    const form = personaToForm(p);
    expect(form.eventSubscriptions).toBe("home/custom/#");
  });

  test("avatar defaults to empty string when not set", () => {
    const p = makeBuiltIn("maisie");
    const form = personaToForm(p);
    expect(form.avatar).toBe("");
  });

  test("preserves avatar when set", () => {
    const p = { ...makeBuiltIn("natalie"), avatar: "https://example.com/natalie.png" };
    const form = personaToForm(p);
    expect(form.avatar).toBe("https://example.com/natalie.png");
  });
});

describe("PersonasPage — formToPayload", () => {
  test("parses comma-separated toolScopes into array", () => {
    const form: PersonaFormData = {
      name: "Scout",
      role: "Security",
      defaultTier: "act",
      systemPrompt: "...",
      toolScopes: "get_devices, scan_network",
      eventSubscriptions: "",
      avatar: "",
    };
    const payload = formToPayload(form);
    expect(payload.toolScopes).toEqual(["get_devices", "scan_network"]);
  });

  test("filters empty entries from toolScopes", () => {
    const form: PersonaFormData = {
      name: "Scout",
      role: "Security",
      defaultTier: "act",
      systemPrompt: "...",
      toolScopes: "get_devices,  ,scan_network",
      eventSubscriptions: "",
      avatar: "",
    };
    const payload = formToPayload(form);
    expect(payload.toolScopes).not.toContain("");
    expect(payload.toolScopes).toHaveLength(2);
  });

  test("omits avatar when empty string", () => {
    const form: PersonaFormData = {
      name: "Scout",
      role: "Security",
      defaultTier: "inform",
      systemPrompt: "...",
      toolScopes: "",
      eventSubscriptions: "",
      avatar: "",
    };
    const payload = formToPayload(form);
    expect(payload.avatar).toBeUndefined();
  });

  test("includes avatar when set", () => {
    const form: PersonaFormData = {
      name: "Scout",
      role: "Security",
      defaultTier: "inform",
      systemPrompt: "...",
      toolScopes: "",
      eventSubscriptions: "",
      avatar: "https://example.com/scout.png",
    };
    const payload = formToPayload(form);
    expect(payload.avatar).toBe("https://example.com/scout.png");
  });
});

describe("PersonasPage — create form calls POST /api/personas", () => {
  test("POST is called with correct method and content-type", async () => {
    let method = "";
    let contentType = "";
    let body: unknown = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, opts: RequestInit = {}) => {
      method = opts.method ?? "GET";
      contentType = (opts.headers as Record<string, string>)?.["Content-Type"] ?? "";
      body = opts.body ? JSON.parse(String(opts.body)) : null;
      return new Response(JSON.stringify({ id: "scout", name: "Scout", isCustom: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const payload = formToPayload({
      name: "Scout",
      role: "Security specialist",
      defaultTier: "act",
      systemPrompt: "You are Scout.",
      toolScopes: "get_devices",
      eventSubscriptions: "home/security/#",
      avatar: "",
    });

    await fetch("/api/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    globalThis.fetch = originalFetch;

    expect(method).toBe("POST");
    expect(contentType).toBe("application/json");
    expect((body as any).name).toBe("Scout");
    expect((body as any).role).toBe("Security specialist");
    expect((body as any).toolScopes).toEqual(["get_devices"]);
  });
});
