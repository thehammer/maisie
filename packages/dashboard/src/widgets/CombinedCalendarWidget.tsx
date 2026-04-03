import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTv, faFilm } from "@fortawesome/free-solid-svg-icons";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarName?: string;
}

interface MediaItem {
  title: string;
  type: "episode" | "movie";
  seriesTitle?: string;
  seasonEpisode?: string;
  date: string;
}

interface RolledUpMedia {
  displayTitle: string;
  badge: string;
  type: "episode" | "movie";
}

interface DayData {
  date: Date;
  events: CalendarEvent[];
  media: RolledUpMedia[];
}

// --- Helpers ---

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDayLabel(d: Date): string {
  if (isToday(d)) return "Today";
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function isPast(event: CalendarEvent): boolean {
  if (event.allDay) return false;
  return new Date(event.end) < new Date();
}

// --- Component ---

export function CombinedCalendarWidget() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [calRes, mediaRes] = await Promise.all([
          fetch("/api/calendar/events?days=7"),
          fetch("/api/media/calendar"),
        ]);
        if (calRes.ok) {
          const calData = await calRes.json();
          setEvents(calData.events || []);
        }
        if (mediaRes.ok) {
          const mediaData = await mediaRes.json();
          setMedia(mediaData.upcoming || []);
        }
      } catch (err) {
        console.error("Failed to fetch calendar data:", err);
      }
    };
    fetchAll();
    const interval = setInterval(fetchAll, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Re-render every minute to drop past events
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Filter calendar events
  const filtered = events.filter((e) => {
    if (e.calendarName === "Phases of the Moon") return false;
    if (isPast(e)) return false;
    return true;
  });

  // Group media by series+day, then roll up episodes
  const mediaBySeriesDay = new Map<string, MediaItem[]>();
  for (const item of media) {
    const d = startOfDay(new Date(item.date));
    const seriesKey = item.seriesTitle || item.title;
    const key = `${d.toISOString()}::${seriesKey}`;
    if (!mediaBySeriesDay.has(key)) mediaBySeriesDay.set(key, []);
    mediaBySeriesDay.get(key)!.push(item);
  }

  const rolledUpByDay = new Map<string, RolledUpMedia[]>();
  for (const [key, items] of mediaBySeriesDay) {
    const dayKey = key.split("::")[0];
    if (!rolledUpByDay.has(dayKey)) rolledUpByDay.set(dayKey, []);

    const first = items[0];
    if (first.type === "movie") {
      rolledUpByDay.get(dayKey)!.push({
        displayTitle: first.title,
        badge: "MOVIE",
        type: "movie",
      });
    } else if (items.length === 1) {
      rolledUpByDay.get(dayKey)!.push({
        displayTitle: first.seriesTitle || first.title,
        badge: first.seasonEpisode || "",
        type: "episode",
      });
    } else {
      // Multiple episodes — extract season and episode numbers
      const episodes = items
        .map((m) => m.seasonEpisode || "")
        .filter(Boolean)
        .sort();
      const seasonMatch = episodes[0]?.match(/^S(\d+)E(\d+)$/);
      if (seasonMatch) {
        const season = seasonMatch[1];
        const epNums = episodes
          .map((e) => e.match(/^S\d+E(\d+)$/)?.[1])
          .filter(Boolean)
          .map(Number)
          .sort((a, b) => a - b);
        const firstEp = epNums[0];
        const lastEp = epNums[epNums.length - 1];
        // If episodes are consecutive and span a large range, show as season
        const isFullRange = lastEp - firstEp + 1 === epNums.length;
        let badge: string;
        if (isFullRange && epNums.length >= 6) {
          badge = `Season ${Number(season)}`;
        } else {
          badge = `S${season}E${String(firstEp).padStart(2, "0")}-E${String(lastEp).padStart(2, "0")}`;
        }
        rolledUpByDay.get(dayKey)!.push({
          displayTitle: first.seriesTitle || first.title,
          badge,
          type: "episode",
        });
      } else {
        rolledUpByDay.get(dayKey)!.push({
          displayTitle: first.seriesTitle || first.title,
          badge: `${items.length} episodes`,
          type: "episode",
        });
      }
    }
  }

  // Build unified day map
  const dayMap = new Map<string, DayData>();

  const ensureDay = (d: Date): DayData => {
    const key = startOfDay(d).toISOString();
    if (!dayMap.has(key)) dayMap.set(key, { date: startOfDay(d), events: [], media: [] });
    return dayMap.get(key)!;
  };

  for (const ev of filtered) {
    ensureDay(new Date(ev.start)).events.push(ev);
  }

  for (const [key, items] of rolledUpByDay) {
    ensureDay(new Date(key)).media = items;
  }

  const days = [...dayMap.values()].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  const todayData = days.find((d) => isToday(d.date));
  const upcomingDays = days.filter((d) => !isToday(d.date)).slice(0, 5);

  return (
    <div style={styles.container}>
      {/* Today — prominent */}
      <div style={styles.todaySection}>
        <div style={styles.todayHeader}>
          <div style={styles.todayLabel}>Today</div>
        </div>

        {todayData && (todayData.events.length > 0 || todayData.media.length > 0) ? (
          <div style={styles.todayEvents}>
            {todayData.events
              .filter((e) => e.allDay)
              .map((ev) => (
                <div key={ev.id} style={styles.todayAllDay}>
                  <div style={styles.allDayBadge}>ALL DAY</div>
                  <div style={styles.todayEventTitle}>{ev.summary}</div>
                </div>
              ))}
            {todayData.events
              .filter((e) => !e.allDay)
              .map((ev) => (
                <div key={ev.id} style={styles.todayTimedEvent}>
                  <div style={styles.todayTime}>{formatTime(ev.start)}</div>
                  <div style={styles.todayEventTitle}>{ev.summary}</div>
                </div>
              ))}
            {todayData.media.length > 0 && (
              <div style={styles.todayMediaGroup}>
                {todayData.media.map((item, i) => (
                  <div key={`m${i}`} style={styles.todayMediaItem}>
                    <span style={styles.mediaIcon}><FontAwesomeIcon icon={item.type === "movie" ? faFilm : faTv} /></span>
                    <div style={styles.todayMediaBadge}>{item.badge}</div>
                    <div style={styles.todayMediaTitle}>{item.displayTitle}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={styles.todayEmpty}>Nothing scheduled</div>
        )}
      </div>

      {/* Upcoming days — compact, with media interleaved */}
      {upcomingDays.length > 0 && (
        <div style={styles.upcomingSection}>
          {upcomingDays.map((day) => (
            <div key={day.date.toISOString()} style={styles.upcomingDay}>
              <div style={styles.upcomingDayLabel}>
                {formatDayLabel(day.date)}
              </div>
              <div style={styles.upcomingEvents}>
                {day.events
                  .filter((e) => e.allDay)
                  .map((ev) => (
                    <div key={ev.id} style={styles.upcomingEvent}>
                      <span style={styles.upcomingAllDayBadge}>ALL DAY</span>
                      <span style={styles.upcomingEventTitle}>{ev.summary}</span>
                    </div>
                  ))}
                {day.events
                  .filter((e) => !e.allDay)
                  .map((ev) => (
                    <div key={ev.id} style={styles.upcomingEvent}>
                      <span style={styles.upcomingTime}>{formatTime(ev.start)}</span>
                      <span style={styles.upcomingEventTitle}>{ev.summary}</span>
                    </div>
                  ))}
                {day.media.map((item, i) => (
                  <div key={`m${i}`} style={styles.upcomingEvent}>
                    <span style={styles.mediaIconSmall}><FontAwesomeIcon icon={item.type === "movie" ? faFilm : faTv} /></span>
                    <span style={styles.upcomingMediaBadge}>{item.badge}</span>
                    <span style={styles.upcomingMediaTitle}>{item.displayTitle}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Styles ---

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    color: "white",
    padding: "40px 48px",
    height: "100vh",
    boxSizing: "border-box",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: "32px",
    background: "rgba(30,30,30,0.20)",
    borderRadius: "6px",
  },

  // --- Today ---
  todaySection: {
    paddingBottom: "24px",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
  },
  todayHeader: {
    marginBottom: "24px",
  },
  todayLabel: {
    fontSize: "52px",
    fontWeight: 700,
    letterSpacing: "-0.5px",
    textShadow: "0 3px 8px rgba(0,0,0,0.7)",
  },
  todayEvents: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  todayAllDay: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  allDayBadge: {
    fontSize: "18px",
    fontWeight: 700,
    letterSpacing: "0.5px",
    color: "rgba(255,255,255,0.9)",
    background: "rgba(108,140,255,0.35)",
    padding: "4px 12px",
    borderRadius: "2px",
    flexShrink: 0,
  },
  todayTimedEvent: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  todayTime: {
    fontSize: "30px",
    fontWeight: 600,
    color: "rgba(255,255,255,0.7)",
    textShadow: "0 2px 4px rgba(0,0,0,0.5)",
    minWidth: "160px",
    flexShrink: 0,
  },
  todayEventTitle: {
    fontSize: "34px",
    fontWeight: 500,
    textShadow: "0 2px 6px rgba(0,0,0,0.6)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  todayEmpty: {
    fontSize: "30px",
    color: "rgba(255,255,255,0.4)",
    fontStyle: "italic",
  },
  todayMediaGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    marginTop: "8px",
    paddingTop: "16px",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },
  todayMediaItem: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
  },
  mediaIcon: {
    fontSize: "18px",
    flexShrink: 0,
    color: "rgba(255,255,255,0.5)",
  },
  todayMediaBadge: {
    fontSize: "12px",
    fontWeight: 600,
    color: "rgba(255,255,255,0.65)",
    background: "rgba(255,255,255,0.12)",
    padding: "3px 7px",
    borderRadius: "2px",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  todayMediaTitle: {
    fontSize: "20px",
    fontWeight: 500,
    color: "rgba(255,255,255,0.55)",
    textShadow: "0 1px 3px rgba(0,0,0,0.5)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  // --- Upcoming ---
  upcomingSection: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  upcomingDay: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  upcomingDayLabel: {
    fontSize: "26px",
    fontWeight: 700,
    color: "rgba(255,255,255,0.55)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    textShadow: "0 2px 4px rgba(0,0,0,0.5)",
  },
  upcomingEvents: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    paddingLeft: "16px",
  },
  upcomingEvent: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
  },
  upcomingAllDayBadge: {
    fontSize: "16px",
    fontWeight: 700,
    letterSpacing: "0.4px",
    color: "rgba(255,255,255,0.7)",
    background: "rgba(108,140,255,0.25)",
    padding: "3px 10px",
    borderRadius: "6px",
    flexShrink: 0,
  },
  upcomingTime: {
    fontSize: "26px",
    fontWeight: 600,
    color: "rgba(255,255,255,0.5)",
    textShadow: "0 2px 4px rgba(0,0,0,0.5)",
    minWidth: "140px",
    flexShrink: 0,
  },
  mediaIconSmall: {
    fontSize: "15px",
    flexShrink: 0,
    color: "rgba(255,255,255,0.45)",
  },
  upcomingMediaBadge: {
    fontSize: "11px",
    fontWeight: 600,
    color: "rgba(255,255,255,0.5)",
    background: "rgba(255,255,255,0.1)",
    padding: "2px 7px",
    borderRadius: "2px",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  upcomingEventTitle: {
    fontSize: "28px",
    fontWeight: 500,
    color: "rgba(255,255,255,0.85)",
    textShadow: "0 2px 4px rgba(0,0,0,0.5)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  upcomingMediaTitle: {
    fontSize: "18px",
    fontWeight: 500,
    color: "rgba(255,255,255,0.55)",
    textShadow: "0 1px 3px rgba(0,0,0,0.5)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
};
