import { Hono } from "hono";
import type { Services } from "./types";

export function createHealthRouter(_services: Pick<Services, "db">) {
  const router = new Hono();

  router.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  return router;
}
