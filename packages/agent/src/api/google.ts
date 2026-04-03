import { Hono } from "hono";
import { getRecentEmails, getUnreadCount } from "../skills/google/gmail";
import { getUpcomingEvents } from "../skills/google/calendar";
import {
  getSubscriptions,
  removeSubscription,
  removeSubscriptions,
  getLikedVideos,
  removeLike,
  removeLikes,
} from "../skills/google/youtube";
import {
  getStatus as getYouTubeCleanupStatus,
  runCleanup as runYouTubeCleanup,
} from "../skills/google/youtube-cleanup";
import { scanForOrders, getActiveOrders } from "../skills/packages/order-tracker";
import type { Services } from "./types";

export function createGoogleRouter(services: Pick<Services, "google">) {
  const router = new Hono();

  router.get("/google/auth", (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    const url = services.google!.getAuthUrl();
    return c.redirect(url);
  });

  router.get("/google/callback", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    const code = c.req.query("code");
    if (!code) return c.json({ error: "Missing code parameter" }, 400);
    try {
      await services.google!.exchangeCode(code);
      return c.html("<h2>Google account connected!</h2><p>You can close this tab.</p>");
    } catch (err) {
      console.error("[google] Auth error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/google/status", (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    return c.json({ authorized: services.google!.isAuthorized() });
  });

  router.get("/gmail/inbox", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized — visit /api/google/auth" }, 401);
    try {
      const limit = Number(c.req.query("limit")) || 20;
      const emails = await getRecentEmails(services.google!, limit);
      const unreadCount = await getUnreadCount(services.google!);
      return c.json({ emails, unreadCount });
    } catch (err) {
      console.error("[gmail] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/gmail/unread", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized — visit /api/google/auth" }, 401);
    try {
      const count = await getUnreadCount(services.google!);
      return c.json({ unreadCount: count });
    } catch (err) {
      console.error("[gmail] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/calendar/events", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized — visit /api/google/auth" }, 401);
    try {
      const days = Number(c.req.query("days")) || 7;
      const events = await getUpcomingEvents(services.google!, days);
      return c.json({ events });
    } catch (err) {
      console.error("[calendar] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- Gmail debug (raw message) ---

  router.get("/gmail/message/:id", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized" }, 401);
    try {
      const id = c.req.param("id");
      const detail = await services.google!.apiRequest(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      );
      return c.json(detail);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/gmail/search", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized" }, 401);
    try {
      const q = c.req.query("q") || "";
      const list = await services.google!.apiRequest(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=${encodeURIComponent(q)}`,
      );
      return c.json(list);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- YouTube ---

  router.get("/youtube/subscriptions", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized — visit /api/google/auth" }, 401);
    try {
      const subs = await getSubscriptions(services.google!);
      return c.json({ subscriptions: subs, count: subs.length });
    } catch (err) {
      console.error("[youtube] Error listing subscriptions:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.delete("/youtube/subscriptions/:id", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized — visit /api/google/auth" }, 401);
    try {
      const id = c.req.param("id");
      await removeSubscription(services.google!, id);
      return c.json({ removed: true });
    } catch (err) {
      console.error("[youtube] Error removing subscription:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/youtube/subscriptions/remove", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized — visit /api/google/auth" }, 401);
    try {
      const { ids } = await c.req.json<{ ids: string[] }>();
      if (!ids || !Array.isArray(ids)) return c.json({ error: "Body must include ids array" }, 400);
      const result = await removeSubscriptions(services.google!, ids);
      return c.json(result);
    } catch (err) {
      console.error("[youtube] Error removing subscriptions:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/youtube/likes", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized — visit /api/google/auth" }, 401);
    try {
      const videos = await getLikedVideos(services.google!);
      return c.json({ videos, count: videos.length });
    } catch (err) {
      console.error("[youtube] Error listing liked videos:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.delete("/youtube/likes/:videoId", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized — visit /api/google/auth" }, 401);
    try {
      const videoId = c.req.param("videoId");
      await removeLike(services.google!, videoId);
      return c.json({ removed: true });
    } catch (err) {
      console.error("[youtube] Error removing like:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.post("/youtube/likes/remove", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized — visit /api/google/auth" }, 401);
    try {
      const { ids } = await c.req.json<{ ids: string[] }>();
      if (!ids || !Array.isArray(ids)) return c.json({ error: "Body must include ids array" }, 400);
      const result = await removeLikes(services.google!, ids);
      return c.json(result);
    } catch (err) {
      console.error("[youtube] Error removing likes:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- YouTube Debug: remove one like and verify ---

  router.post("/youtube/debug/test-remove", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized" }, 401);

    try {
      // 1. Get first page of liked videos
      const params = new URLSearchParams({ part: "snippet", myRating: "like", maxResults: "5" });
      const before = await services.google!.apiRequest(
        `https://www.googleapis.com/youtube/v3/videos?${params}`,
      );
      const likedBefore = (before.items || []).map((v: any) => ({ id: v.id, title: v.snippet.title }));

      if (likedBefore.length === 0) {
        return c.json({ result: "no_likes", message: "No liked videos found" });
      }

      const target = likedBefore[0];

      // 2. Remove the like
      await removeLike(services.google!, target.id);

      // 3. Verify via getRating endpoint (separate from videos.list)
      const ratingParams = new URLSearchParams({ id: target.id });
      const ratingCheck = await services.google!.apiRequest(
        `https://www.googleapis.com/youtube/v3/videos/getRating?${ratingParams}`,
      );
      const ratingAfter = ratingCheck.items?.[0]?.rating || "unknown";

      return c.json({
        target,
        removeCallSucceeded: true,
        ratingAfterRemoval: ratingAfter,
        verdict: ratingAfter === "none" ? "REMOVAL WORKED" : "REMOVAL FAILED — like persisted",
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- YouTube Debug: remove one subscription and verify ---

  router.post("/youtube/debug/test-remove-sub", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized" }, 401);

    try {
      // 1. Get first page of subscriptions
      const params = new URLSearchParams({ part: "snippet", mine: "true", maxResults: "5" });
      const before = await services.google!.apiRequest(
        `https://www.googleapis.com/youtube/v3/subscriptions?${params}`,
      );
      const subsBefore = (before.items || []).map((s: any) => ({
        id: s.id,
        channelId: s.snippet.resourceId.channelId,
        title: s.snippet.title,
      }));

      if (subsBefore.length === 0) {
        return c.json({ result: "no_subs", message: "No subscriptions found" });
      }

      const target = subsBefore[0];

      // 2. Remove the subscription
      await removeSubscription(services.google!, target.id);

      // 3. Verify — check if we're still subscribed to that channel
      const checkParams = new URLSearchParams({
        part: "snippet",
        mine: "true",
        forChannelId: target.channelId,
      });
      const after = await services.google!.apiRequest(
        `https://www.googleapis.com/youtube/v3/subscriptions?${checkParams}`,
      );
      const stillSubscribed = (after.items || []).length > 0;

      return c.json({
        target,
        removeCallSucceeded: true,
        stillSubscribed,
        verdict: stillSubscribed ? "REMOVAL FAILED — still subscribed" : "REMOVAL WORKED",
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- YouTube Cleanup ---

  router.get("/youtube/cleanup/status", (c) => {
    return c.json(getYouTubeCleanupStatus());
  });

  router.post("/youtube/cleanup/run", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized — visit /api/google/auth" }, 401);
    try {
      const status = await runYouTubeCleanup(services.google!);
      return c.json(status);
    } catch (err) {
      console.error("[youtube-cleanup] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- Package / Order Tracking ---

  // No auth required — lets the dashboard skip polling /packages/active when Google isn't set up
  router.get("/packages/configured", (c) => {
    const configured = !!(services.google && services.google.isAuthorized());
    return c.json({ configured });
  });

  router.get("/packages/active", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized — visit /api/google/auth" }, 401);
    try {
      const orders = await getActiveOrders(services.google!);
      return c.json({ orders, count: orders.length });
    } catch (err) {
      console.error("[packages] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  router.get("/packages/all", async (c) => {
    if (!services.google) return c.json({ error: "Google not configured" }, 503);
    if (!services.google.isAuthorized()) return c.json({ error: "Not authorized — visit /api/google/auth" }, 401);
    try {
      const orders = await scanForOrders(services.google!);
      return c.json({ orders, count: orders.length });
    } catch (err) {
      console.error("[packages] Error:", err);
      return c.json({ error: String(err) }, 500);
    }
  });

  return router;
}
