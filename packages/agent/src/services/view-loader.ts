/**
 * view-loader — seeds built-in ViewDefs into the database at agent boot time.
 *
 * Views are seeded once (skip if already present) so the data is persistent and
 * can be customised via the /api/views API without being overwritten on restart.
 */

import { views } from "./schema";
import { eq } from "drizzle-orm";
import type { getDb } from "./db";

type Db = ReturnType<typeof getDb>;

interface SeedViewDef {
  name: string;
  description: string;
  sourceEntity: string;
  sourceField: string;
  sourceEndpoint: string;
  chain: string;
  component: string;
  componentProps: string;
}

/** Built-in views shipped with the platform — seeded once at first boot */
const BUILT_IN_VIEWS: SeedViewDef[] = [
  {
    name: "services-status",
    description: "Health status of all connected services",
    sourceEntity: "services",
    sourceField: "status",
    sourceEndpoint: "/api/services/status",
    chain: "[]",
    component: "service-chips",
    componentProps: "{}",
  },
];

/**
 * Seed built-in views that do not yet exist in the database.
 * Called once during agent startup, after the database is initialised.
 */
export async function seedBuiltInViews(db: Db): Promise<void> {
  for (const def of BUILT_IN_VIEWS) {
    const existing = await db
      .select({ name: views.name })
      .from(views)
      .where(eq(views.name, def.name))
      .get();
    if (!existing) {
      await db.insert(views).values({
        ...def,
        updatedAt: new Date(),
      });
      console.log(`  ✓ View seeded: ${def.name}`);
    }
  }
}
