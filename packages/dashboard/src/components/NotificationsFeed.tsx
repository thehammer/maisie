import { useState, useEffect, useCallback } from "react";

interface AgentNotification {
  id: string;
  message: string;
  severity: "info" | "warning" | "critical";
  timestamp: string;
  dismissed: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCountChange: (count: number) => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const SEVERITY_CLASS: Record<string, string> = {
  info: "badge-muted",
  warning: "badge-yellow",
  critical: "badge-red",
};

export function NotificationsFeed({ open, onClose, onCountChange }: Props) {
  const [notifications, setNotifications] = useState<AgentNotification[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/notifications");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as { notifications: AgentNotification[] };
      const active = data.notifications.filter((n) => !n.dismissed);
      setNotifications(active);
      onCountChange(active.length);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [onCountChange]);

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  const dismiss = useCallback(async (id: string) => {
    try {
      await fetch(`/api/agent/notifications/${id}/dismiss`, { method: "POST" });
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      onCountChange(Math.max(0, notifications.length - 1));
    } catch {
      // ignore dismiss failures
    }
  }, [notifications.length, onCountChange]);

  if (!open) return null;

  return (
    <>
      <div className="notif-overlay" onClick={onClose} />
      <div className="notif-panel">
        <div className="notif-header">
          <span className="card-title">Notifications</span>
          <button className="chat-close-btn" onClick={onClose} aria-label="Close notifications">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="search-msg error" style={{ margin: "0.75rem" }}>
            Failed to load notifications
          </div>
        )}

        {!error && notifications.length === 0 && (
          <div className="empty-state">No pending notifications</div>
        )}

        <div className="notif-list">
          {notifications.map((n) => (
            <div key={n.id} className={`notif-item notif-item-${n.severity}`}>
              <div className="notif-item-header">
                <span className={`card-badge ${SEVERITY_CLASS[n.severity] ?? "badge-muted"}`}>
                  {n.severity}
                </span>
                <span className="notif-time">{relativeTime(n.timestamp)}</span>
              </div>
              <div className="notif-message">{n.message}</div>
              <button
                className="notif-dismiss-btn"
                onClick={() => dismiss(n.id)}
                aria-label="Dismiss notification"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
