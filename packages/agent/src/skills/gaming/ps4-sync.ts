import { eq } from "drizzle-orm";
import { ps4Apps } from "../../services/schema";
import type { Ps4App } from "./ps4-client";

type Db = ReturnType<typeof import("../../services/db").initDb>;

export interface SyncResult {
  total: number;
  added: number;
  updated: number;
  removed: number;
}

export function syncPs4Apps(db: Db, apps: Ps4App[]): SyncResult {
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;

  const seenIds = new Set<string>();

  for (const app of apps) {
    seenIds.add(app.titleId);

    const existing = db
      .select()
      .from(ps4Apps)
      .where(eq(ps4Apps.titleId, app.titleId))
      .get();

    if (!existing) {
      db.insert(ps4Apps)
        .values({
          titleId: app.titleId,
          title: app.title,
          version: app.version,
          category: app.category,
          contentId: app.contentId,
          sizeMb: app.sizeMb,
          storage: app.storage,
          firstSeen: now,
          lastSeen: now,
          removed: 0,
        })
        .run();
      added++;
    } else {
      const changed =
        existing.title !== app.title ||
        existing.version !== app.version ||
        existing.removed === 1;

      if (changed) {
        db.update(ps4Apps)
          .set({
            title: app.title,
            version: app.version,
            category: app.category,
            contentId: app.contentId,
            sizeMb: app.sizeMb,
            storage: app.storage,
            lastSeen: now,
            removed: 0,
          })
          .where(eq(ps4Apps.titleId, app.titleId))
          .run();
        updated++;
      } else {
        db.update(ps4Apps)
          .set({ lastSeen: now })
          .where(eq(ps4Apps.titleId, app.titleId))
          .run();
      }
    }
  }

  // Mark apps no longer present as removed
  const allStored = db.select().from(ps4Apps).all();
  let removed = 0;
  for (const stored of allStored) {
    if (!seenIds.has(stored.titleId) && stored.removed === 0) {
      db.update(ps4Apps)
        .set({ removed: 1 })
        .where(eq(ps4Apps.titleId, stored.titleId))
        .run();
      removed++;
    }
  }

  return { total: apps.length, added, updated, removed };
}

export function getPs4Catalog(db: Db) {
  return db.select().from(ps4Apps).all();
}
