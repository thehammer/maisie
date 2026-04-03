/**
 * Behavioral tests for the library channels API router.
 *
 * Key invariant under test: every successful channel mutation must:
 *   1. Persist the change to the DB BEFORE calling sync
 *   2. Call sync exactly once
 *   3. Await sync and include the SyncResult in the response body
 *
 * Failed mutations (404/400) must NOT call sync.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../services/schema";
import { createLibraryChannelsRouter, type SyncResult } from "./library-channels-router";

// --- Test helpers ---

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE library_channels (
      number      TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      mode        TEXT NOT NULL,
      content     TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      icon_url    TEXT,
      created_at  TEXT NOT NULL
    )
  `);
  return drizzle(sqlite, { schema });
}

type TestDb = ReturnType<typeof createTestDb>;

interface SyncSpy {
  readonly callCount: number;
  readonly lastResult: SyncResult | null;
  sync: () => Promise<SyncResult>;
  failNext: () => void;
  reset: () => void;
}

function createSyncSpy(override?: Partial<SyncResult>): SyncSpy {
  let callCount = 0;
  let lastResult: SyncResult | null = null;
  let nextResult: SyncResult = { hdhr: true, plex: true, errors: [] };
  let failing = false;

  const spy: SyncSpy = {
    get callCount() { return callCount; },
    get lastResult() { return lastResult; },
    sync: async (): Promise<SyncResult> => {
      callCount++;
      const result = failing
        ? { hdhr: false, plex: false, errors: ["simulated failure"] }
        : { ...nextResult, ...override };
      lastResult = result;
      failing = false; // one-shot
      return result;
    },
    failNext() { failing = true; },
    reset() { callCount = 0; lastResult = null; failing = false; },
  };
  return spy;
}

const CONTENT = { type: "show" as const, title: "Golden Girls", showRatingKey: "rk_1234" };

// Build the router fresh for each test — no shared state
function makeApp(db: TestDb, spy: SyncSpy, onRenumber?: (o: string, n: string) => void) {
  return createLibraryChannelsRouter({ db, sync: spy.sync, onRenumber });
}

async function seedChannel(
  app: ReturnType<typeof makeApp>,
  number = "20001",
  name = "Golden Girls 24/7",
) {
  return app.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ number, name, mode: "marathon", content: CONTENT }),
  });
}

// --- Tests ---

describe("Library Channels Router", () => {
  let db: TestDb;
  let spy: SyncSpy;
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    db = createTestDb();
    spy = createSyncSpy();
    app = makeApp(db, spy);
  });

  // -----------------------------------------------------------------------
  describe("GET /", () => {
    test("returns empty list initially", async () => {
      const res = await app.request("/");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    test("lists all channels after creation", async () => {
      await seedChannel(app, "20001", "Channel A");
      await seedChannel(app, "20002", "Channel B");

      const res = await app.request("/");
      const channels = (await res.json()) as any[];
      expect(channels).toHaveLength(2);
      expect(channels.map((c) => c.number).sort()).toEqual(["20001", "20002"]);
    });
  });

  // -----------------------------------------------------------------------
  describe("POST / (create)", () => {
    test("returns 201 with channel data", async () => {
      const res = await seedChannel(app);
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.number).toBe("20001");
      expect(body.name).toBe("Golden Girls 24/7");
      expect(body.mode).toBe("marathon");
    });

    test("calls sync exactly once on success", async () => {
      await seedChannel(app);
      expect(spy.callCount).toBe(1);
    });

    test("response includes sync result", async () => {
      const res = await seedChannel(app);
      const body = await res.json() as any;
      expect(body.sync).toBeDefined();
      expect(body.sync.hdhr).toBe(true);
      expect(body.sync.plex).toBe(true);
      expect(body.sync.errors).toEqual([]);
    });

    test("returns 201 even when sync fails; errors reported in body", async () => {
      spy.failNext();
      const res = await seedChannel(app);
      expect(res.status).toBe(201); // DB write succeeded — still 201
      const body = await res.json() as any;
      expect(body.sync.errors).toHaveLength(1);
      expect(body.sync.hdhr).toBe(false);
    });

    test("does NOT call sync when validation fails", async () => {
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: "20001" }), // missing name, mode, content
      });
      expect(res.status).toBe(400);
      expect(spy.callCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  describe("PUT /:number (update)", () => {
    test("updates channel name and calls sync", async () => {
      await seedChannel(app);
      spy.reset();

      const res = await app.request("/20001", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Golden Girls Marathon" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(body.sync).toBeDefined();
      expect(spy.callCount).toBe(1);

      // Verify DB reflects the change
      const listRes = await app.request("/");
      const channels = (await listRes.json()) as any[];
      expect(channels[0].name).toBe("Golden Girls Marathon");
    });

    test("returns 404 for non-existent channel and does NOT call sync", async () => {
      const res = await app.request("/99999", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Ghost" }),
      });
      expect(res.status).toBe(404);
      expect(spy.callCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  describe("DELETE /:number", () => {
    test("deletes channel and calls sync", async () => {
      await seedChannel(app);
      spy.reset();

      const res = await app.request("/20001", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(body.sync).toBeDefined();
      expect(spy.callCount).toBe(1);

      // Channel must be gone from DB
      const listRes = await app.request("/");
      expect(await listRes.json()).toEqual([]);
    });

    test("returns 404 for non-existent channel and does NOT call sync", async () => {
      const res = await app.request("/99999", { method: "DELETE" });
      expect(res.status).toBe(404);
      expect(spy.callCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  describe("POST /:number/toggle", () => {
    test("toggles enabled state and calls sync", async () => {
      await seedChannel(app);
      spy.reset();

      // First toggle: enabled → disabled
      const res1 = await app.request("/20001/toggle", { method: "POST" });
      expect(res1.status).toBe(200);
      expect(spy.callCount).toBe(1);

      const listRes = await app.request("/");
      const [ch] = (await listRes.json()) as any[];
      expect(ch.enabled).toBe(false);

      // Second toggle: disabled → enabled
      spy.reset();
      await app.request("/20001/toggle", { method: "POST" });
      expect(spy.callCount).toBe(1);
    });

    test("returns 404 for non-existent channel and does NOT call sync", async () => {
      const res = await app.request("/99999/toggle", { method: "POST" });
      expect(res.status).toBe(404);
      expect(spy.callCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  describe("POST /:number/renumber", () => {
    test("renumbers channel and calls sync", async () => {
      await seedChannel(app, "20001");
      spy.reset();

      const res = await app.request("/20001/renumber", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: "20099" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.number).toBe("20099");
      expect(body.sync).toBeDefined();
      expect(spy.callCount).toBe(1);

      // Old number gone, new number present
      const listRes = await app.request("/");
      const channels = (await listRes.json()) as any[];
      expect(channels.find((c: any) => c.number === "20001")).toBeUndefined();
      expect(channels.find((c: any) => c.number === "20099")).toBeDefined();
    });

    test("returns 400 if target number is already taken, does NOT call sync", async () => {
      await seedChannel(app, "20001");
      await seedChannel(app, "20002");
      spy.reset();

      const res = await app.request("/20001/renumber", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: "20002" }),
      });
      expect(res.status).toBe(400);
      expect(spy.callCount).toBe(0);
    });

    test("returns 400 for non-existent channel, does NOT call sync", async () => {
      const res = await app.request("/99999/renumber", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: "20001" }),
      });
      expect(res.status).toBe(400);
      expect(spy.callCount).toBe(0);
    });

    test("invokes onRenumber callback with old and new numbers", async () => {
      const renamed: Array<[string, string]> = [];
      const appWithCallback = makeApp(db, spy, (o, n) => renamed.push([o, n]));
      await seedChannel(appWithCallback, "20001");
      spy.reset();

      await appWithCallback.request("/20001/renumber", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: "20055" }),
      });

      expect(renamed).toEqual([["20001", "20055"]]);
    });
  });

  // -----------------------------------------------------------------------
  describe("POST /reorder", () => {
    test("reorders channels and calls sync exactly once for the whole batch", async () => {
      await seedChannel(app, "20001", "First");
      await seedChannel(app, "20002", "Second");
      spy.reset();

      const res = await app.request("/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: [
            { oldNumber: "20001", newNumber: "20099" },
            { oldNumber: "20002", newNumber: "20001" },
          ],
        }),
      });
      expect(res.status).toBe(200);
      expect(spy.callCount).toBe(1); // batch = one sync, not two

      const listRes = await app.request("/");
      const numbers = ((await listRes.json()) as any[]).map((c) => c.number).sort();
      expect(numbers).toEqual(["20001", "20099"]);
    });

    test("returns 400 for missing order array, does NOT call sync", async () => {
      const res = await app.request("/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notOrder: [] }),
      });
      expect(res.status).toBe(400);
      expect(spy.callCount).toBe(0);
    });

    test("invokes onRenumber for both passes of the two-pass algorithm", async () => {
      const renamed: Array<[string, string]> = [];
      const appWithCallback = makeApp(db, spy, (o, n) => renamed.push([o, n]));
      await seedChannel(appWithCallback, "20001");
      await seedChannel(appWithCallback, "20002");
      spy.reset();

      await appWithCallback.request("/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: [
            { oldNumber: "20001", newNumber: "20099" },
            { oldNumber: "20002", newNumber: "20001" },
          ],
        }),
      });

      // Pass 1: both channels → _tmp_*
      expect(renamed).toContainEqual(["20001", "_tmp_20001"]);
      expect(renamed).toContainEqual(["20002", "_tmp_20002"]);
      // Pass 2: _tmp_* → final numbers
      expect(renamed).toContainEqual(["_tmp_20001", "20099"]);
      expect(renamed).toContainEqual(["_tmp_20002", "20001"]);
    });
  });

  // -----------------------------------------------------------------------
  describe("sync invariant — DB updated BEFORE sync is called", () => {
    test("create: channel exists in DB when sync fires", async () => {
      let dbStateAtSync: any[] = [];
      const capturingSpy = async (): Promise<SyncResult> => {
        dbStateAtSync = db.select().from(schema.libraryChannels).all();
        return { hdhr: true, plex: true, errors: [] };
      };
      const testApp = createLibraryChannelsRouter({ db, sync: capturingSpy });

      await testApp.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: "20001", name: "Test", mode: "marathon", content: CONTENT }),
      });

      expect(dbStateAtSync).toHaveLength(1);
      expect(dbStateAtSync[0].number).toBe("20001");
    });

    test("delete: channel absent from DB when sync fires", async () => {
      await seedChannel(app, "20001");
      spy.reset();

      let dbStateAtSync: any[] = [];
      const capturingSpy = async (): Promise<SyncResult> => {
        dbStateAtSync = db.select().from(schema.libraryChannels).all();
        return { hdhr: true, plex: true, errors: [] };
      };
      const testApp = createLibraryChannelsRouter({ db, sync: capturingSpy });

      await testApp.request("/20001", { method: "DELETE" });

      expect(dbStateAtSync).toHaveLength(0);
    });

    test("renumber: new number exists in DB when sync fires", async () => {
      await seedChannel(app, "20001");
      spy.reset();

      let numbersAtSync: string[] = [];
      const capturingSpy = async (): Promise<SyncResult> => {
        numbersAtSync = db.select().from(schema.libraryChannels).all().map((r) => r.number);
        return { hdhr: true, plex: true, errors: [] };
      };
      const testApp = createLibraryChannelsRouter({ db, sync: capturingSpy });

      await testApp.request("/20001/renumber", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: "20055" }),
      });

      expect(numbersAtSync).toContain("20055");
      expect(numbersAtSync).not.toContain("20001");
    });
  });

  // -----------------------------------------------------------------------
  describe("sync invariant — failures do not call sync", () => {
    test("all 404/400 responses skip sync", async () => {
      // DELETE non-existent
      await app.request("/99999", { method: "DELETE" });
      // PUT non-existent
      await app.request("/99999", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      });
      // toggle non-existent
      await app.request("/99999/toggle", { method: "POST" });
      // renumber non-existent
      await app.request("/99999/renumber", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: "20001" }),
      });
      // create missing fields
      await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: "20001" }),
      });
      // reorder missing array
      await app.request("/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(spy.callCount).toBe(0);
    });
  });
});
