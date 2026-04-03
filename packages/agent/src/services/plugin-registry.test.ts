import { describe, test, expect, mock, spyOn } from "bun:test";
import { validatePlugin, discoverPlugins } from "./plugin-registry";
import type { MaisiePlugin } from "@maisie/shared";

// Minimal valid plugin fixture
function makePlugin(overrides: Partial<MaisiePlugin> = {}): MaisiePlugin {
  return {
    name: "test-plugin",
    version: "0.1.0",
    description: "A test plugin",
    capabilities: [],
    envVars: [],
    actions: [],
    events: [],
    async init() {},
    async shutdown() {},
    async healthCheck() {
      return { status: "healthy", lastCheck: new Date() };
    },
    ...overrides,
  };
}

describe("validatePlugin", () => {
  test("accepts a valid plugin object", () => {
    expect(validatePlugin(makePlugin())).toBe(true);
  });

  test("accepts a plugin with capabilities", () => {
    expect(validatePlugin(makePlugin({ capabilities: ["network", "camera"] as any }))).toBe(true);
  });

  test("rejects null", () => {
    expect(validatePlugin(null)).toBe(false);
  });

  test("rejects a plain object", () => {
    expect(validatePlugin({})).toBe(false);
  });

  test("rejects when name is missing", () => {
    const p = makePlugin() as any;
    delete p.name;
    expect(validatePlugin(p)).toBe(false);
  });

  test("rejects when version is missing", () => {
    const p = makePlugin() as any;
    delete p.version;
    expect(validatePlugin(p)).toBe(false);
  });

  test("rejects when init is not a function", () => {
    expect(validatePlugin({ ...makePlugin(), init: "not-a-function" } as any)).toBe(false);
  });

  test("rejects when shutdown is not a function", () => {
    expect(validatePlugin({ ...makePlugin(), shutdown: "not-a-function" } as any)).toBe(false);
  });

  test("rejects when healthCheck is not a function", () => {
    expect(validatePlugin({ ...makePlugin(), healthCheck: "not-a-function" } as any)).toBe(false);
  });

  test("rejects when actions is not an array", () => {
    expect(validatePlugin({ ...makePlugin(), actions: {} } as any)).toBe(false);
  });

  test("rejects when events is not an array", () => {
    expect(validatePlugin({ ...makePlugin(), events: null } as any)).toBe(false);
  });
});

describe("discoverPlugins", () => {
  test("returns workspace source entries for matching packages", async () => {
    // discoverPlugins reads from the filesystem — use the actual test fixtures
    // by pointing at a temp directory structure we construct inline via mock
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const root = mkdtempSync(join(tmpdir(), "maisie-test-"));

    try {
      // Create a root package.json with workspaces
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ workspaces: ["packages/*"] }),
      );

      // Create a valid plugin package
      const pkgDir = join(root, "packages", "plugin-test");
      mkdirSync(pkgDir, { recursive: true });
      mkdirSync(join(pkgDir, "src"), { recursive: true });

      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@test/plugin-test",
          main: "src/index.ts",
          maisie: { plugin: true, capabilities: [] },
        }),
      );

      // Write a valid plugin entry point
      writeFileSync(
        join(pkgDir, "src", "index.ts"),
        `export default {
          name: 'test-plugin',
          version: '0.1.0',
          description: 'Test',
          capabilities: [],
          envVars: [],
          actions: [],
          events: [],
          async init() {},
          async shutdown() {},
          async healthCheck() { return { status: 'healthy', lastCheck: new Date() } },
        }`,
      );

      const entries = await discoverPlugins(root);
      const found = entries.find((e) => e.packageName === "@test/plugin-test");
      expect(found).toBeDefined();
      expect(found?.source).toBe("workspace");
      expect(found?.plugin.name).toBe("test-plugin");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("skips packages without maisie.plugin=true", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const root = mkdtempSync(join(tmpdir(), "maisie-test-"));

    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ workspaces: ["packages/*"] }),
      );

      const pkgDir = join(root, "packages", "not-a-plugin");
      mkdirSync(pkgDir, { recursive: true });

      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@test/not-a-plugin",
          maisie: { plugin: false, capabilities: [] },
        }),
      );

      const entries = await discoverPlugins(root);
      expect(entries.find((e) => e.packageName === "@test/not-a-plugin")).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("skips packages with no maisie key", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const root = mkdtempSync(join(tmpdir(), "maisie-test-"));

    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ workspaces: ["packages/*"] }),
      );

      const pkgDir = join(root, "packages", "ordinary-pkg");
      mkdirSync(pkgDir, { recursive: true });

      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "@test/ordinary-pkg" }),
      );

      const entries = await discoverPlugins(root);
      expect(entries.find((e) => e.packageName === "@test/ordinary-pkg")).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns empty array when no plugins found", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const root = mkdtempSync(join(tmpdir(), "maisie-test-"));

    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: [] }));
      const entries = await discoverPlugins(root);
      expect(entries).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("workspace entry takes precedence over node_modules entry with same name", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const root = mkdtempSync(join(tmpdir(), "maisie-test-"));

    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ workspaces: ["packages/*"] }),
      );

      // Workspace version
      const pkgDir = join(root, "packages", "plugin-dup");
      mkdirSync(join(pkgDir, "src"), { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@maisie/plugin-dup",
          main: "src/index.ts",
          maisie: { plugin: true, capabilities: [] },
        }),
      );
      writeFileSync(
        join(pkgDir, "src", "index.ts"),
        `export default {
          name: 'dup-workspace',
          version: '0.1.0',
          description: 'Workspace version',
          capabilities: [],
          envVars: [],
          actions: [],
          events: [],
          async init() {},
          async shutdown() {},
          async healthCheck() { return { status: 'healthy', lastCheck: new Date() } },
        }`,
      );

      // node_modules version
      const nmDir = join(root, "node_modules", "@maisie", "plugin-dup");
      mkdirSync(join(nmDir, "src"), { recursive: true });
      writeFileSync(
        join(nmDir, "package.json"),
        JSON.stringify({
          name: "@maisie/plugin-dup",
          main: "src/index.ts",
          maisie: { plugin: true, capabilities: [] },
        }),
      );
      writeFileSync(
        join(nmDir, "src", "index.ts"),
        `export default {
          name: 'dup-node-modules',
          version: '0.1.0',
          description: 'node_modules version',
          capabilities: [],
          envVars: [],
          actions: [],
          events: [],
          async init() {},
          async shutdown() {},
          async healthCheck() { return { status: 'healthy', lastCheck: new Date() } },
        }`,
      );

      const entries = await discoverPlugins(root);
      const dups = entries.filter((e) => e.packageName === "@maisie/plugin-dup");
      expect(dups).toHaveLength(1);
      expect(dups[0].source).toBe("workspace");
      expect(dups[0].plugin.name).toBe("dup-workspace");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
