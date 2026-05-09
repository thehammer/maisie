import { Hono } from "hono";
import type { Services } from "./types";
import { views } from "../services/schema";
import { eq } from "drizzle-orm";

export interface ViewDef {
  name: string;
  description: string;
  source: {
    entity: string;
    field: string;
    /** Direct HTTP endpoint ViewCard fetches to get the data */
    endpoint: string;
  };
  chain: unknown[];
  component: string;
  componentProps: Record<string, unknown>;
}

function rowToViewDef(row: typeof views.$inferSelect): ViewDef {
  return {
    name: row.name,
    description: row.description,
    source: {
      entity: row.sourceEntity,
      field: row.sourceField,
      endpoint: row.sourceEndpoint,
    },
    chain: JSON.parse(row.chain) as unknown[],
    component: row.component,
    componentProps: JSON.parse(row.componentProps) as Record<string, unknown>,
  };
}

export function createViewsRouter(services: Pick<Services, "db">): Hono {
  const router = new Hono();

  /** List all registered view definitions */
  router.get("/views", async (c) => {
    const rows = await services.db.select().from(views).all();
    return c.json(rows.map(rowToViewDef));
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
    return c.json(rowToViewDef(row));
  });

  return router;
}
