import type { GoogleAuth } from "./google-auth";

const YT_API = "https://www.googleapis.com/youtube/v3";

export interface YouTubeSubscription {
  id: string; // subscription resource ID (used for DELETE)
  channelId: string;
  title: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
}

export interface YouTubeLikedVideo {
  id: string; // video ID
  title: string;
  channelTitle: string;
  thumbnail: string;
  publishedAt: string;
}

/**
 * List all subscriptions, auto-paginating through results.
 */
export async function getSubscriptions(auth: GoogleAuth): Promise<YouTubeSubscription[]> {
  const subs: YouTubeSubscription[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      part: "snippet",
      mine: "true",
      maxResults: "50",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await auth.apiRequest(`${YT_API}/subscriptions?${params}`);

    for (const item of data.items || []) {
      subs.push({
        id: item.id,
        channelId: item.snippet.resourceId.channelId,
        title: item.snippet.title,
        description: item.snippet.description?.slice(0, 200) || "",
        thumbnail: item.snippet.thumbnails?.default?.url || "",
        publishedAt: item.snippet.publishedAt,
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return subs;
}

/**
 * Remove a subscription by its subscription resource ID.
 */
export async function removeSubscription(auth: GoogleAuth, subscriptionId: string): Promise<void> {
  await auth.apiRequest(`${YT_API}/subscriptions?id=${subscriptionId}`, {
    method: "DELETE",
  });
}

/**
 * Remove multiple subscriptions. Stops early on quota errors.
 */
export async function removeSubscriptions(
  auth: GoogleAuth,
  subscriptionIds: string[],
): Promise<{ removed: number; remaining: string[]; errors: string[]; quotaExhausted: boolean }> {
  let removed = 0;
  const errors: string[] = [];

  for (let i = 0; i < subscriptionIds.length; i++) {
    try {
      await removeSubscription(auth, subscriptionIds[i]);
      removed++;
    } catch (err) {
      const msg = String(err);
      if (msg.includes("quotaExceeded")) {
        return { removed, remaining: subscriptionIds.slice(i), errors, quotaExhausted: true };
      }
      errors.push(`${subscriptionIds[i]}: ${msg}`);
    }
  }

  return { removed, remaining: [], errors, quotaExhausted: false };
}

/**
 * List all liked videos, auto-paginating through results.
 */
export async function getLikedVideos(auth: GoogleAuth): Promise<YouTubeLikedVideo[]> {
  const videos: YouTubeLikedVideo[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      part: "snippet",
      myRating: "like",
      maxResults: "50",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await auth.apiRequest(`${YT_API}/videos?${params}`);

    for (const item of data.items || []) {
      videos.push({
        id: item.id,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails?.default?.url || "",
        publishedAt: item.snippet.publishedAt,
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return videos;
}

/**
 * Remove a like from a video (sets rating to "none").
 */
export async function removeLike(auth: GoogleAuth, videoId: string): Promise<void> {
  await auth.apiRequest(`${YT_API}/videos/rate?id=${videoId}&rating=none`, {
    method: "POST",
  });
}

/**
 * Remove likes from multiple videos. Stops early on quota errors.
 */
export async function removeLikes(
  auth: GoogleAuth,
  videoIds: string[],
): Promise<{ removed: number; remaining: string[]; errors: string[]; quotaExhausted: boolean }> {
  let removed = 0;
  const errors: string[] = [];

  for (let i = 0; i < videoIds.length; i++) {
    try {
      await removeLike(auth, videoIds[i]);
      removed++;
    } catch (err) {
      const msg = String(err);
      if (msg.includes("quotaExceeded")) {
        return { removed, remaining: videoIds.slice(i), errors, quotaExhausted: true };
      }
      errors.push(`${videoIds[i]}: ${msg}`);
    }
  }

  return { removed, remaining: [], errors, quotaExhausted: false };
}
