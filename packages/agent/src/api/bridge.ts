import { Hono } from "hono";
import { BridgeService } from "../services/bridge";
import { publish } from "../services/mqtt";
import type { Services } from "./types";

export function createBridgeRouter(_services: Pick<Services, "db">) {
  const router = new Hono();

  const bridge = new BridgeService(publish);

  router.post("/bridge/messages", async (c) => {
    try {
      const { from, content, command, result } = await c.req.json();
      if (!from || !content) {
        return c.json({ error: "from and content are required" }, 400);
      }
      if (from !== "code" && from !== "browser") {
        return c.json({ error: "from must be 'code' or 'browser'" }, 400);
      }
      const msg = bridge.send(from, content, { command, result });
      return c.json(msg, 201);
    } catch (err) {
      console.error("[bridge] Error sending message:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/bridge/messages", (c) => {
    const since = c.req.query("since");
    const messages = bridge.getMessages(since || undefined);
    return c.json({ messages });
  });

  router.get("/bridge/status", (c) => {
    return c.json(bridge.getStatus());
  });

  router.post("/bridge/reset", (c) => {
    bridge.reset();
    return c.json({ ok: true });
  });

  return router;
}
