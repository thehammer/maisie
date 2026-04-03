import { describe, test, expect, beforeEach } from "bun:test";
import { BridgeService } from "./bridge";
import type { BridgeMessage } from "@maisie/shared";

describe("BridgeService", () => {
  let bridge: BridgeService;
  let published: Array<{ topic: string; payload: unknown }>;

  beforeEach(() => {
    published = [];
    bridge = new BridgeService((topic, payload) => {
      published.push({ topic, payload });
    });
  });

  describe("send", () => {
    test("returns a well-formed message", () => {
      const msg = bridge.send("code", "hello");

      expect(msg.id).toBeString();
      expect(msg.id.length).toBeGreaterThan(0);
      expect(msg.from).toBe("code");
      expect(msg.content).toBe("hello");
      expect(new Date(msg.timestamp).toISOString()).toBe(msg.timestamp);
    });

    test("publishes to MQTT", () => {
      const msg = bridge.send("browser", "hi from browser");

      expect(published).toHaveLength(1);
      expect(published[0].topic).toBe("home/bridge/message");
      expect(published[0].payload).toEqual(msg);
    });

    test("assigns unique IDs", () => {
      const a = bridge.send("code", "first");
      const b = bridge.send("code", "second");

      expect(a.id).not.toBe(b.id);
    });
  });

  describe("getMessages", () => {
    test("returns all messages in order", () => {
      bridge.send("code", "first");
      bridge.send("browser", "second");
      bridge.send("code", "third");

      const messages = bridge.getMessages();

      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe("first");
      expect(messages[1].content).toBe("second");
      expect(messages[2].content).toBe("third");
    });

    test("returns empty array when no messages", () => {
      expect(bridge.getMessages()).toEqual([]);
    });

    test("returns a copy, not the internal array", () => {
      bridge.send("code", "hello");
      const messages = bridge.getMessages();
      messages.pop();

      expect(bridge.getMessages()).toHaveLength(1);
    });
  });

  describe("getMessages with since filter", () => {
    test("returns only messages after the given timestamp", async () => {
      bridge.send("code", "old message");
      const cutoff = new Date().toISOString();

      // Small delay to ensure timestamp difference
      await Bun.sleep(5);

      bridge.send("browser", "new message");

      const filtered = bridge.getMessages(cutoff);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].content).toBe("new message");
    });

    test("returns all messages if since is before all messages", () => {
      const before = new Date(Date.now() - 1000).toISOString();
      bridge.send("code", "a");
      bridge.send("browser", "b");

      expect(bridge.getMessages(before)).toHaveLength(2);
    });

    test("returns empty if since is after all messages", async () => {
      bridge.send("code", "a");

      await Bun.sleep(5);
      const after = new Date().toISOString();

      expect(bridge.getMessages(after)).toEqual([]);
    });
  });

  describe("getStatus", () => {
    test("returns zero state when empty", () => {
      const status = bridge.getStatus();

      expect(status.messageCount).toBe(0);
      expect(status.lastActivity).toBeNull();
    });

    test("returns correct count and last activity", () => {
      bridge.send("code", "a");
      const last = bridge.send("browser", "b");

      const status = bridge.getStatus();

      expect(status.messageCount).toBe(2);
      expect(status.lastActivity).toBe(last.timestamp);
    });
  });

  describe("send with command/result", () => {
    test("includes command when provided", () => {
      const msg = bridge.send("code", "[cmd] navigate", {
        command: { action: "navigate", url: "http://example.com" },
      });

      expect(msg.command).toBeDefined();
      expect(msg.command!.action).toBe("navigate");
      expect(msg.command!.url).toBe("http://example.com");
    });

    test("includes result when provided", () => {
      const msg = bridge.send("browser", "[result] screenshot", {
        result: { action: "screenshot", success: true, data: "base64..." },
      });

      expect(msg.result).toBeDefined();
      expect(msg.result!.action).toBe("screenshot");
      expect(msg.result!.success).toBe(true);
      expect(msg.result!.data).toBe("base64...");
    });

    test("omits command/result when not provided", () => {
      const msg = bridge.send("code", "just a message");

      expect("command" in msg).toBe(false);
      expect("result" in msg).toBe(false);
    });

    test("MQTT publish includes command field", () => {
      bridge.send("code", "[cmd] click", {
        command: { action: "click", selector: "#btn" },
      });

      const payload = published[0].payload as any;
      expect(payload.command.action).toBe("click");
      expect(payload.command.selector).toBe("#btn");
    });

    test("getMessages returns command/result fields", () => {
      bridge.send("code", "[cmd] readText", {
        command: { action: "readText", selector: ".title" },
      });

      const messages = bridge.getMessages();
      expect(messages[0].command).toBeDefined();
      expect(messages[0].command!.action).toBe("readText");
    });
  });

  describe("reset", () => {
    test("clears all messages", () => {
      bridge.send("code", "a");
      bridge.send("browser", "b");

      bridge.reset();

      expect(bridge.getMessages()).toEqual([]);
      expect(bridge.getStatus().messageCount).toBe(0);
    });
  });
});
