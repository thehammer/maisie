import { Hono } from "hono";
import type { Services } from "./types";

export function createPlexImageRouter(services: Pick<Services, "plex">) {
  const router = new Hono();

  router.get("/plex/image/*", async (c) => {
    if (!services.plex) return c.json({ error: "Plex not configured" }, 503);
    try {
      const thumbPath = "/" + c.req.path.replace("/api/plex/image/", "");
      const res = await services.plex!.proxyImage(thumbPath);
      if (!res.ok) return c.json({ error: "Image not found" }, 404);
      return new Response(res.body, {
        headers: {
          "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}
