import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { join } from "path";
import { existsSync } from "fs";
import type { Services } from "./types";

export function createDashboardRouter(_services: Services) {
  const router = new Hono();

  // --- Static dashboard serving (production) ---
  const dashboardDist = join(import.meta.dir, "../../../dashboard/dist");
  if (existsSync(dashboardDist)) {
    router.use("/*", serveStatic({ root: dashboardDist, rewriteRequestPath: (p) => p }));
    // SPA fallback — serve index.html for non-API, non-asset routes
    router.get("*", serveStatic({ root: dashboardDist, rewriteRequestPath: () => "/index.html" }));
    console.log(`  ✓ Serving dashboard from ${dashboardDist}`);
  }

  return router;
}
