import { describe, test, expect } from "bun:test";

// Extracted logic from NotificationsFeed — tested in isolation

function relativeTime(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const SEVERITY_CLASS: Record<string, string> = {
  info: "badge-muted",
  warning: "badge-yellow",
  critical: "badge-red",
};

function severityClass(severity: string): string {
  return SEVERITY_CLASS[severity] ?? "badge-muted";
}

type AgentNotification = {
  id: string;
  message: string;
  severity: "info" | "warning" | "critical";
  timestamp: string;
  dismissed: boolean;
};

function filterActive(notifications: AgentNotification[]): AgentNotification[] {
  return notifications.filter((n) => !n.dismissed);
}

describe("NotificationsFeed — relativeTime", () => {
  const base = new Date("2025-01-01T12:00:00Z").getTime();

  test("returns 'just now' for sub-minute diff", () => {
    const ts = new Date(base - 30_000).toISOString();
    expect(relativeTime(ts, base)).toBe("just now");
  });

  test("returns minutes ago for < 1 hour", () => {
    const ts = new Date(base - 5 * 60_000).toISOString();
    expect(relativeTime(ts, base)).toBe("5 min ago");
  });

  test("returns hours ago for < 24 hours", () => {
    const ts = new Date(base - 3 * 60 * 60_000).toISOString();
    expect(relativeTime(ts, base)).toBe("3h ago");
  });

  test("returns days ago for 24+ hours", () => {
    const ts = new Date(base - 2 * 24 * 60 * 60_000).toISOString();
    expect(relativeTime(ts, base)).toBe("2d ago");
  });

  test("returns '1 min ago' at exactly 1 minute", () => {
    const ts = new Date(base - 60_000).toISOString();
    expect(relativeTime(ts, base)).toBe("1 min ago");
  });
});

describe("NotificationsFeed — severityClass", () => {
  test("info maps to badge-muted", () => {
    expect(severityClass("info")).toBe("badge-muted");
  });

  test("warning maps to badge-yellow", () => {
    expect(severityClass("warning")).toBe("badge-yellow");
  });

  test("critical maps to badge-red", () => {
    expect(severityClass("critical")).toBe("badge-red");
  });

  test("unknown severity falls back to badge-muted", () => {
    expect(severityClass("unknown")).toBe("badge-muted");
  });
});

describe("NotificationsFeed — filterActive", () => {
  const notifications: AgentNotification[] = [
    { id: "1", message: "Alert A", severity: "info", timestamp: "", dismissed: false },
    { id: "2", message: "Alert B", severity: "warning", timestamp: "", dismissed: true },
    { id: "3", message: "Alert C", severity: "critical", timestamp: "", dismissed: false },
  ];

  test("filters out dismissed notifications", () => {
    const active = filterActive(notifications);
    expect(active).toHaveLength(2);
    expect(active.map((n) => n.id)).toEqual(["1", "3"]);
  });

  test("returns empty array when all dismissed", () => {
    const all = notifications.map((n) => ({ ...n, dismissed: true }));
    expect(filterActive(all)).toHaveLength(0);
  });

  test("returns all when none dismissed", () => {
    const all = notifications.map((n) => ({ ...n, dismissed: false }));
    expect(filterActive(all)).toHaveLength(3);
  });

  test("badge count equals active length", () => {
    expect(filterActive(notifications).length).toBe(2);
  });
});
