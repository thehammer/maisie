// Deterministic schedule calculator.
// Maps wall-clock time to a specific episode + offset within that episode.
// Pure function — no state needed. Anyone tuning at the same moment sees the same content.

export interface Episode {
  index: number; // global index in the ordered list
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  durationMs: number;
  filePath: string;
}

export interface NowPlaying {
  episode: Episode;
  offsetMs: number; // how far into the episode we should be
}

/**
 * Marathon mode: episodes play in order, looping forever.
 * Position is determined by (currentTime % totalDuration).
 */
export function getMarathonNowPlaying(episodes: Episode[], now?: Date): NowPlaying {
  if (episodes.length === 0) throw new Error("No episodes available");

  const currentMs = (now ?? new Date()).getTime();
  const totalDurationMs = episodes.reduce((sum, ep) => sum + ep.durationMs, 0);

  if (totalDurationMs <= 0) throw new Error("Total duration is zero");

  // Position within the loop
  const positionMs = ((currentMs % totalDurationMs) + totalDurationMs) % totalDurationMs;

  let accumulated = 0;
  for (const episode of episodes) {
    if (accumulated + episode.durationMs > positionMs) {
      return {
        episode,
        offsetMs: positionMs - accumulated,
      };
    }
    accumulated += episode.durationMs;
  }

  // Shouldn't reach here, but return last episode at start as fallback
  return { episode: episodes[episodes.length - 1], offsetMs: 0 };
}

/**
 * Shuffle mode: deterministic pseudo-random order, re-seeded daily.
 * Same day = same order for all viewers. Uses a simple hash-based shuffle.
 */
export function getShuffleNowPlaying(
  episodes: Episode[],
  seed: number = 0,
  now?: Date,
): NowPlaying {
  if (episodes.length === 0) throw new Error("No episodes available");

  const currentTime = now ?? new Date();

  // Seed changes daily — same shuffle all day
  const daysSinceEpoch = Math.floor(currentTime.getTime() / 86400000);
  const daySeed = daysSinceEpoch + seed;

  const shuffled = deterministicShuffle(episodes, daySeed);
  return getMarathonNowPlaying(shuffled, currentTime);
}

function deterministicShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    // Simple LCG-style hash
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
