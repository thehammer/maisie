import type { PlexStatus } from "@maisie/shared";

interface Props {
  status: PlexStatus;
}

function formatDuration(ms: number) {
  const min = Math.floor(ms / 60000);
  const hrs = Math.floor(min / 60);
  const rem = min % 60;
  if (hrs > 0) return `${hrs}h ${rem}m`;
  return `${min}m`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function PlexCard({ status }: Props) {
  const { nowPlaying, recentlyAdded, libraries } = status;

  const totalItems = libraries.reduce((sum, l) => sum + l.count, 0);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Plex — {status.name}</span>
        <span className="card-badge badge-green">v{status.version.split(".").slice(0, 2).join(".")}</span>
      </div>

      {/* Library stats */}
      <div style={{ display: "flex", gap: "2rem", marginBottom: "1rem" }}>
        <div>
          <div className="big-number">{totalItems.toLocaleString()}</div>
          <div className="big-number-label">Total Items</div>
        </div>
        <div>
          <div className="big-number">{libraries.length}</div>
          <div className="big-number-label">Libraries</div>
        </div>
      </div>

      {libraries
        .filter((l) => l.type === "movie" || l.type === "show")
        .map((l) => (
          <div key={l.id} className="stat-row">
            <span className="stat-label">{l.title}</span>
            <span className="stat-value">{l.count.toLocaleString()}</span>
          </div>
        ))}

      {/* Now Playing */}
      {nowPlaying.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <div className="card-title" style={{ marginBottom: "0.5rem" }}>Now Playing</div>
          {nowPlaying.map((np, i) => (
            <div key={i} className="list-item">
              <div className="list-item-text">
                <div className="list-item-title">
                  {np.seriesTitle ? `${np.seriesTitle} — ${np.seasonEpisode}` : np.title}
                </div>
                <div className="list-item-sub">
                  {np.user} on {np.player} — {np.state}
                  {np.transcoding ? " (transcoding)" : " (direct)"}
                  {" — "}{formatDuration(np.progress)} / {formatDuration(np.duration)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recently Added */}
      {recentlyAdded.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <div className="card-title" style={{ marginBottom: "0.5rem" }}>Recently Added</div>
          {recentlyAdded.slice(0, 5).map((item, i) => (
            <div key={i} className="list-item">
              <div className="list-item-text">
                <div className="list-item-title">
                  {item.seriesTitle
                    ? `${item.seriesTitle} ${item.seasonEpisode}`
                    : `${item.title}${item.year ? ` (${item.year})` : ""}`}
                </div>
                <div className="list-item-sub">{timeAgo(item.addedAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
