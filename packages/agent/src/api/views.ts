import { Hono } from "hono";
import type { Services } from "./types";
import { views } from "../services/schema";
import { eq } from "drizzle-orm";

/**
 * ViewCard-compatible shape returned by the views REST API.
 *
 * `source.endpoint` is the direct HTTP path ViewCard fetches for entity data.
 * It is stored in the view's `source` JSON column alongside `entity` and `field`.
 */
export interface ViewCardDef {
  name: string;
  description: string;
  source: {
    entity: string;
    field?: string;
    /** Direct endpoint ViewCard fetches to get the raw data (e.g. '/api/services/status') */
    endpoint?: string;
  };
  chain: unknown[];
  component: string;
  componentProps: Record<string, unknown>;
}

function rowToViewCardDef(row: typeof views.$inferSelect): ViewCardDef {
  const source = row.source as { entity: string; field?: string; endpoint?: string };
  return {
    name: row.name,
    description: row.description ?? "",
    source,
    chain: Array.isArray(row.chain) ? row.chain : [],
    component: row.component,
    componentProps: (row.componentProps ?? {}) as Record<string, unknown>,
  };
}

export function createViewsRouter(services: Pick<Services, "db">): Hono {
  const router = new Hono();

  /** List all registered view definitions */
  router.get("/views", async (c) => {
    const rows = await services.db.select().from(views).all();
    return c.json(rows.map(rowToViewCardDef));
  });

  /** Get a single view definition by name */
  router.get("/views/:name", async (c) => {
    const name = c.req.param("name");
    const row = await services.db
      .select()
      .from(views)
      .where(eq(views.name, name))
      .get();
    if (!row) return c.json({ error: `View not found: ${name}` }, 404);
    return c.json(rowToViewCardDef(row));
  });

  return router;
}
