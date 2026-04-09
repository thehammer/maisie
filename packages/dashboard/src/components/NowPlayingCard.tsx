/**
 * NowPlayingCard — shows Plex cover art for what's currently playing.
 *
 * When nothing is playing, the card hides itself.
 * When something is playing, shows a large poster/thumb with the title,
 * user, player, and a progress bar overlaid.
 */

import type { PlexNowPlaying } from "@maisie/shared";

interface Props {
  nowPlaying: PlexNowPlaying[];
}

function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60000);
  const hrs = Math.floor(min / 60);
  const rem = min % 60;
  if (hrs > 0) return `${hrs}:${String(rem).padStart(2, "0")}`;
  return `${min}m`;
}

export function NowPlayingCard({ nowPlaying }: Props) {
  if (!nowPlaying.length) return null;

  return (
    <div className="card now-playing-card">
      <div className="card-header">
        <span className="card-title">Now Playing</span>
        <span className="card-badge badge-green">
          {nowPlaying.length} stream{nowPlaying.length > 1 ? "s" : ""}
        </span>
      </div>
      {nowPlaying.map((np, i) => {
        const pct = np.duration > 0 ? (np.progress / np.duration) * 100 : 0;
        const displayTitle = np.seriesTitle
          ? `${np.seriesTitle} — ${np.seasonEpisode}`
          : np.title;
        const subtitle = np.seriesTitle ? np.title : (np.year ? `(${np.year})` : "");

        return (
          <div key={i} className="now-playing-session">
            {np.thumb && (
              <div className="now-playing-art">
                <img src={np.thumb} alt="" loading="lazy" />
                {/* Progress bar overlay at bottom of image */}
                <div className="now-playing-progress">
                  <div className="now-playing-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                {/* State badge */}
                <div className={`now-playing-state now-playing-state-${np.state}`}>
                  {np.state === "playing" ? "▶" : np.state === "paused" ? "⏸" : "⏳"}
                </div>
              </div>
            )}
            <div className="now-playing-meta">
              <div className="now-playing-title">{displayTitle}</div>
              {subtitle && <div className="now-playing-subtitle">{subtitle}</div>}
              <div className="now-playing-info">
                {np.user} on {np.player}
                {np.transcoding ? " (transcoding)" : ""}
                {" — "}
                {formatDuration(np.progress)} / {formatDuration(np.duration)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
