import type { GoogleAuth } from "./auth";

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  status: string;
  calendarId: string;
  calendarName?: string;
}

export async function getUpcomingEvents(
  auth: GoogleAuth,
  days = 7,
  maxResults = 50,
): Promise<CalendarEvent[]> {
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // Get list of calendars
  const calList = await auth.apiRequest(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
  );

  const allEvents: CalendarEvent[] = [];

  for (const cal of calList.items || []) {
    // Skip hidden or declined calendars
    if (cal.hidden || cal.deleted) continue;

    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      maxResults: String(maxResults),
      singleEvents: "true",
      orderBy: "startTime",
    });

    try {
      const events = await auth.apiRequest(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
      );

      for (const ev of events.items || []) {
        if (ev.status === "cancelled") continue;

        const isAllDay = !!ev.start?.date;
        allEvents.push({
          id: ev.id,
          summary: ev.summary || "(No title)",
          description: ev.description,
          location: ev.location,
          start: ev.start?.dateTime || ev.start?.date || "",
          end: ev.end?.dateTime || ev.end?.date || "",
          allDay: isAllDay,
          status: ev.status,
          calendarId: cal.id,
          calendarName: cal.summary,
        });
      }
    } catch (err) {
      // Some calendars (like holidays) may fail — skip
      console.error(`[calendar] Error fetching ${cal.summary}:`, err);
    }
  }

  // Sort by start time
  allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return allEvents;
}

export async function getTodayEvents(auth: GoogleAuth): Promise<CalendarEvent[]> {
  return getUpcomingEvents(auth, 1);
}
