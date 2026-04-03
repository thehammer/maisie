import { Hono } from "hono";
import {
  listLibraryChannels,
  createLibraryChannel,
  updateLibraryChannel,
  deleteLibraryChannel,
  toggleLibraryChannel,
  renumberLibraryChannel,
  type LibraryChannelConfig,
} from "./library-channels";

type Db = ReturnType<typeof import("../../services/db").initDb>;

export interface SyncResult {
  hdhr: boolean;
  plex: boolean;
  errors: string[];
}

export interface LibraryChannelsRouterOptions {
  db: Db;
  sync: () => Promise<SyncResult>;
  /**
   * Called after a successful renumber so the caller can rename associated
   * files (e.g. icon PNGs on disk). Invoked for BOTH passes of the two-pass
   * reorder algorithm, so `oldNumber` may be a `_tmp_*` name during pass 1.
   */
  onRenumber?: (oldNumber: string, newNumber: string) => void;
}

/**
 * Creates a Hono router containing all library-channel mutation endpoints.
 * Every successful mutation awaits `sync()` before responding, so callers
 * can trust that the synthetic-hdhr lineup and Plex guide are up-to-date
 * by the time the HTTP response is sent.
 *
 * Mount at /api/library-channels:
 *   app.route("/api/library-channels", createLibraryChannelsRouter({ db, sync }))
 */
export function createLibraryChannelsRouter({
  db,
  sync,
  onRenumber,
}: LibraryChannelsRouterOptions): Hono {
  const app = new Hono();

  // --- Read ---

  app.get("/", (c) => c.json(listLibraryChannels(db)));

  // --- Mutations (each awaits sync before responding) ---

  app.post("/", async (c) => {
    const body = await c.req.json<{
      number: string;
      name: string;
      mode: string;
      content: LibraryChannelConfig;
    }>();
    if (!body.number || !body.name || !body.mode || !body.content) {
      return c.json({ error: "number, name, mode, and content are required" }, 400);
    }
    try {
      const channel = createLibraryChannel(db, body);
      const syncResult = await sync();
      return c.json({ ...channel, sync: syncResult }, 201);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // POST /reorder must be registered before POST /:number/... so Hono's
  // static-path priority kicks in and "reorder" isn't eaten as a :number param.
  app.post("/reorder", async (c) => {
    const body = await c.req.json<{ order: { oldNumber: string; newNumber: string }[] }>();
    if (!body.order || !Array.isArray(body.order)) {
      return c.json({ error: "order array required" }, 400);
    }

    // Two-pass renumber to avoid primary-key collisions when channels swap numbers.
    // Pass 1: every old number → _tmp_<oldNumber>
    for (const { oldNumber } of body.order) {
      renumberLibraryChannel(db, oldNumber, `_tmp_${oldNumber}`);
      onRenumber?.(oldNumber, `_tmp_${oldNumber}`);
    }
    // Pass 2: _tmp_<oldNumber> → final new number
    for (const { oldNumber, newNumber } of body.order) {
      renumberLibraryChannel(db, `_tmp_${oldNumber}`, newNumber);
      onRenumber?.(`_tmp_${oldNumber}`, newNumber);
    }

    const syncResult = await sync();
    return c.json({ ok: true, sync: syncResult });
  });

  app.put("/:number", async (c) => {
    const num = c.req.param("number");
    const body = await c.req.json<{ name?: string; mode?: string; content?: LibraryChannelConfig }>();
    const updated = updateLibraryChannel(db, num, body);
    if (!updated) return c.json({ error: "Channel not found" }, 404);
    const syncResult = await sync();
    return c.json({ ok: true, sync: syncResult });
  });

  app.delete("/:number", async (c) => {
    const deleted = deleteLibraryChannel(db, c.req.param("number"));
    if (!deleted) return c.json({ error: "Channel not found" }, 404);
    const syncResult = await sync();
    return c.json({ ok: true, sync: syncResult });
  });

  app.post("/:number/toggle", async (c) => {
    const toggled = toggleLibraryChannel(db, c.req.param("number"));
    if (!toggled) return c.json({ error: "Channel not found" }, 404);
    const syncResult = await sync();
    return c.json({ ok: true, sync: syncResult });
  });

  app.post("/:number/renumber", async (c) => {
    const oldNum = c.req.param("number");
    const { number: newNum } = await c.req.json<{ number: string }>();
    if (!newNum) return c.json({ error: "number required" }, 400);
    const renamed = renumberLibraryChannel(db, oldNum, newNum);
    if (!renamed) return c.json({ error: "Channel not found or number taken" }, 400);
    onRenumber?.(oldNum, newNum);
    const syncResult = await sync();
    return c.json({ ok: true, number: newNum, sync: syncResult });
  });

  return app;
}
