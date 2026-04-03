import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { BridgeService } from "./bridge";

function createTestApp() {
  const app = new Hono();
  const bridge = new BridgeService();

  app.post("/api/bridge/messages", async (c) => {
    const body = await c.req.json();
    const { from, content, command, result } = body;
    if (!from || !content) {
      return c.json({ error: "from and content are required" }, 400);
    }
    if (from !== "code" && from !== "browser") {
      return c.json({ error: "from must be 'code' or 'browser'" }, 400);
    }
    const msg = bridge.send(from, content, { command, result });
    return c.json(msg, 201);
  });

  app.get("/api/bridge/messages", (c) => {
    const since = c.req.query("since");
    const messages = bridge.getMessages(since || undefined);
    return c.json({ messages });
  });

  app.get("/api/bridge/status", (c) => {
    return c.json(bridge.getStatus());
  });

  app.post("/api/bridge/reset", (c) => {
    bridge.reset();
    return c.json({ ok: true });
  });

  return app;
}

describe("Bridge API", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
  });

  describe("POST /api/bridge/messages", () => {
    test("returns 201 with valid message", async () => {
      const res = await app.request("/api/bridge/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "code", content: "hello" }),
      });

      expect(res.status).toBe(201);
      const msg = await res.json();
      expect(msg.from).toBe("code");
      expect(msg.content).toBe("hello");
      expect(msg.id).toBeDefined();
      expect(msg.timestamp).toBeDefined();
    });

    test("returns 400 when from is missing", async () => {
      const res = await app.request("/api/bridge/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      });

      expect(res.status).toBe(400);
    });

    test("returns 400 when content is missing", async () => {
      const res = await app.request("/api/bridge/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "code" }),
      });

      expect(res.status).toBe(400);
    });

    test("returns 400 for invalid participant", async () => {
      const res = await app.request("/api/bridge/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "hacker", content: "hello" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("code");
      expect(body.error).toContain("browser");
    });
  });

  describe("GET /api/bridge/messages", () => {
    test("returns empty messages initially", async () => {
      const res = await app.request("/api/bridge/messages");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toEqual([]);
    });

    test("returns all sent messages", async () => {
      await app.request("/api/bridge/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "code", content: "first" }),
      });
      await app.request("/api/bridge/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "browser", content: "second" }),
      });

      const res = await app.request("/api/bridge/messages");
      const body = await res.json();

      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].content).toBe("first");
      expect(body.messages[1].content).toBe("second");
    });

    test("filters by since parameter", async () => {
      await app.request("/api/bridge/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "code", content: "old" }),
      });

      await Bun.sleep(5);
      const cutoff = new Date().toISOString();
      await Bun.sleep(5);

      await app.request("/api/bridge/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "browser", content: "new" }),
      });

      const res = await app.request(`/api/bridge/messages?since=${cutoff}`);
      const body = await res.json();

      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].content).toBe("new");
    });
  });

  describe("GET /api/bridge/status", () => {
    test("returns zero state initially", async () => {
      const res = await app.request("/api/bridge/status");
      const body = await res.json();

      expect(body.messageCount).toBe(0);
      expect(body.lastActivity).toBeNull();
    });

    test("reflects message count after sends", async () => {
      await app.request("/api/bridge/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "code", content: "hello" }),
      });

      const res = await app.request("/api/bridge/status");
      const body = await res.json();

      expect(body.messageCount).toBe(1);
      expect(body.lastActivity).toBeDefined();
    });
  });

  describe("command/result protocol", () => {
    test("POST with command returns message with command field", async () => {
      const res = await app.request("/api/bridge/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "code",
          content: "[cmd] navigate",
          command: { action: "navigate", url: "http://example.com" },
        }),
      });

      expect(res.status).toBe(201);
      const msg = await res.json();
      expect(msg.command).toBeDefined();
      expect(msg.command.action).toBe("navigate");
      expect(msg.command.url).toBe("http://example.com");
    });

    test("POST with result returns message with result field", async () => {
      const res = await app.request("/api/bridge/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "browser",
          content: "[result] screenshot",
          result: { action: "screenshot", success: true, data: "base64png" },
        }),
      });

      expect(res.status).toBe(201);
      const msg = await res.json();
      expect(msg.result.action).toBe("screenshot");
      expect(msg.result.success).toBe(true);
      expect(msg.result.data).toBe("base64png");
    });

    test("GET returns messages with command/result fields", async () => {
      await app.request("/api/bridge/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "code",
          content: "[cmd] click",
          command: { action: "click", selector: "#btn" },
        }),
      });

      const res = await app.request("/api/bridge/messages");
      const body = await res.json();

      expect(body.messages[0].command.action).toBe("click");
      expect(body.messages[0].command.selector).toBe("#btn");
    });
  });

  describe("POST /api/bridge/reset", () => {
    test("clears all messages", async () => {
      await app.request("/api/bridge/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "code", content: "hello" }),
      });

      const resetRes = await app.request("/api/bridge/reset", { method: "POST" });
      expect(resetRes.status).toBe(200);
      const resetBody = await resetRes.json();
      expect(resetBody.ok).toBe(true);

      const res = await app.request("/api/bridge/messages");
      const body = await res.json();
      expect(body.messages).toEqual([]);
    });
  });
});
