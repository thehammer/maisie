import { useState, useEffect } from "react";

interface CalendarItem {
  title: string;
  type: "episode" | "movie";
  seriesTitle?: string;
  seasonEpisode?: string;
  date: string;
  status: string;
}

export function MediaCalendarWidget() {
  const [items, setItems] = useState<CalendarItem[]>([]);

  useEffect(() => {
    const fetchCalendar = async () => {
      try {
        const res = await fetch("/api/media/calendar");
        const data = await res.json();
        setItems(data.upcoming || []);
      } catch (err) {
        console.error("Failed to fetch calendar:", err);
      }
    };
    fetchCalendar();
    const interval = setInterval(fetchCalendar, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Group items by date
  const grouped = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const dateKey = new Date(item.date).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    if (!grouped.has(dateKey)) grouped.set(dateKey, []);
    grouped.get(dateKey)!.push(item);
  }

  // Deduplicate: show series once per day (first episode only)
  const deduped = new Map<string, CalendarItem[]>();
  for (const [dateKey, dayItems] of grouped) {
    const seen = new Set<string>();
    const unique: CalendarItem[] = [];
    for (const item of dayItems) {
      const key = item.seriesTitle || item.title;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }
    deduped.set(dateKey, unique);
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>Upcoming</div>
      <div style={styles.list}>
        {[...deduped.entries()].slice(0, 7).map(([dateKey, dayItems]) => (
          <div key={dateKey} style={styles.dayGroup}>
            <div style={styles.dateLabel}>{dateKey}</div>
            {dayItems.slice(0, 5).map((item, i) => (
              <div key={i} style={styles.item}>
                <div style={styles.badge}>
                  {item.type === "movie" ? "MOVIE" : item.seasonEpisode}
                </div>
                <div style={styles.title}>
                  {item.type === "episode"
                    ? item.seriesTitle
                    : item.title}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    color: "white",
    padding: "16px 20px",
    height: "100vh",
    boxSizing: "border-box",
    overflow: "hidden",
  },
  header: {
    fontSize: "18px",
    fontWeight: 600,
    letterSpacing: "0.5px",
    textTransform: "uppercase" as const,
    marginBottom: "12px",
    textShadow: "0 1px 4px rgba(0,0,0,0.7)",
  },
  list: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
  },
  dayGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
  },
  dateLabel: {
    fontSize: "13px",
    fontWeight: 600,
    color: "rgba(255,255,255,0.7)",
    textShadow: "0 1px 3px rgba(0,0,0,0.6)",
    marginTop: "2px",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    paddingLeft: "8px",
  },
  badge: {
    fontSize: "10px",
    fontWeight: 600,
    color: "rgba(255,255,255,0.85)",
    background: "rgba(255,255,255,0.15)",
    backdropFilter: "blur(4px)",
    padding: "2px 6px",
    borderRadius: "1px",
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  },
  title: {
    fontSize: "14px",
    fontWeight: 500,
    textShadow: "0 1px 3px rgba(0,0,0,0.6)",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
};
