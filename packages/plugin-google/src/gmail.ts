import type { GoogleAuth } from "./auth";

interface GmailThread {
  id: string;
  snippet: string;
  from: string;
  subject: string;
  date: string;
  unread: boolean;
  labelIds: string[];
}

export async function getRecentEmails(auth: GoogleAuth, maxResults = 20): Promise<GmailThread[]> {
  // Get recent message list
  const list = await auth.apiRequest(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&labelIds=INBOX`,
  );

  if (!list.messages || list.messages.length === 0) return [];

  // Fetch each message's metadata (batch would be better but this is simpler)
  const emails: GmailThread[] = [];
  for (const msg of list.messages) {
    const detail = await auth.apiRequest(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    );

    const headers = detail.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

    emails.push({
      id: detail.id,
      snippet: detail.snippet,
      from: getHeader("From"),
      subject: getHeader("Subject"),
      date: getHeader("Date"),
      unread: detail.labelIds?.includes("UNREAD") ?? false,
      labelIds: detail.labelIds || [],
    });
  }

  return emails;
}

export async function getUnreadCount(auth: GoogleAuth): Promise<number> {
  const profile = await auth.apiRequest(
    "https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX",
  );
  return profile.messagesUnread || 0;
}
