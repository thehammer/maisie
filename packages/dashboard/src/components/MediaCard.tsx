interface CalendarItem {
  title: string;
  type: "movie" | "episode";
  seriesTitle?: string;
  seasonEpisode?: string;
  date: string;
  status: "downloading" | "queued" | "missing" | "available" | "upcoming";
  quality?: string;
}

interface MediaCalendar {
  upcoming: CalendarItem[];
  queue: CalendarItem[];
  timestamp: string;
}

interface Props {
  calendar: MediaCalendar;
}

function formatDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function statusBadge(status: CalendarItem["status"]) {
  switch (status) {
    case "downloading": return { cls: "badge-green", label: "Downloading" };
    case "queued": return { cls: "badge-yellow", label: "Queued" };
    case "available": return { cls: "badge-green", label: "Available" };
    case "missing": return { cls: "badge-red", label: "Missing" };
    case "upcoming": return { cls: "badge-muted", label: "Upcoming" };
  }
}

export function MediaCard({ calendar }: Props) {
  const { upcoming, queue } = calendar;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Media Calendar</span>
        <span className="card-badge badge-muted">
          {upcoming.length} upcoming
        </span>
      </div>

      {/* Download Queue */}
      {queue.length > 0 && (
        <>
          <div className="card-title" style={{ marginBottom: "0.5rem", fontSize: "0.75rem" }}>
            Downloading
          </div>
          {queue.map((item, i) => {
            const badge = statusBadge(item.status);
            return (
              <div key={`q-${i}`} className="list-item">
                <div className="list-item-text">
                  <div className="list-item-title">
                    {item.seriesTitle
                      ? `${item.seriesTitle} ${item.seasonEpisode}`
                      : item.title}
                  </div>
                  <div className="list-item-sub">
                    {item.quality || item.type} — {badge.label}
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ borderTop: "1px solid var(--border)", margin: "0.5rem 0" }} />
        </>
      )}

      {/* Upcoming */}
      {upcoming.length === 0 ? (
        <div className="empty-state">No upcoming releases</div>
      ) : (
        upcoming.slice(0, 10).map((item, i) => {
          const badge = statusBadge(item.status);
          return (
            <div key={`u-${i}`} className="list-item">
              <div className="list-item-text">
                <div className="list-item-title">
                  {item.seriesTitle
                    ? `${item.seriesTitle} ${item.seasonEpisode}`
                    : item.title}
                </div>
                <div className="list-item-sub">
                  {item.type === "episode" ? "TV" : "Movie"} — {formatDate(item.date)}
                </div>
              </div>
              <span className={`card-badge ${badge.cls}`} style={{ flexShrink: 0 }}>
                {badge.label}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
