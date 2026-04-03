import { useState } from "react";
import { useApi } from "../hooks/useApi";

interface YouTubeCleanupStatus {
  running: boolean;
  lastRun: string | null;
  lastResult: string | null;
  likesRemaining: number;
  subsRemaining: number;
  likesRemovedTotal: number;
  subsRemovedTotal: number;
  quotaExhausted: boolean;
  nextScheduledRun: string | null;
}

interface Props {
  pollInterval: number;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function YouTubeCleanupCard({ pollInterval }: Props) {
  const statusApi = useApi<YouTubeCleanupStatus>("/api/youtube/cleanup/status", pollInterval);
  const [actionPending, setActionPending] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const status = statusApi.data;
  if (!status) return null;

  const totalRemaining = status.likesRemaining + status.subsRemaining;
  const totalRemoved = status.likesRemovedTotal + status.subsRemovedTotal;

  // Don't show card if nothing to do and nothing was done
  if (totalRemaining === 0 && totalRemoved === 0 && !status.lastRun) return null;

  const totalItems = totalRemaining + totalRemoved;
  const progress = totalItems > 0 ? Math.round((totalRemoved / totalItems) * 100) : 100;

  async function triggerRun() {
    setActionPending(true);
    setLastAction(null);
    try {
      const res = await fetch("/api/youtube/cleanup/run", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setLastAction(`Error: ${data.error}`);
      } else if (data.quotaExhausted) {
        setLastAction("Quota exhausted — will continue tomorrow");
      } else if (data.likesRemaining === 0 && data.subsRemaining === 0) {
        setLastAction("Cleanup complete!");
      } else {
        setLastAction(`Removed batch — ${data.likesRemaining + data.subsRemaining} remaining`);
      }
      statusApi.refresh();
    } catch (err) {
      setLastAction(`Error: ${err}`);
    }
    setActionPending(false);
  }

  const isDone = totalRemaining === 0 && totalRemoved > 0;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">YouTube Cleanup</span>
        <span className={`card-badge ${
          status.running ? "badge-green"
            : status.quotaExhausted ? "badge-yellow"
              : isDone ? "badge-green"
                : "badge-muted"
        }`}>
          {status.running ? "RUNNING"
            : isDone ? "DONE"
              : status.quotaExhausted ? "QUOTA HIT"
                : "SCHEDULED"}
        </span>
      </div>

      {/* Progress bar */}
      {totalItems > 0 && (
        <>
          <div className="stat-row">
            <span className="stat-label">Progress</span>
            <span className="stat-value">{totalRemoved} / {totalItems} removed</span>
          </div>
          <div className="progress-bar">
            <div
              className={`progress-fill ${isDone ? "green" : "yellow"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </>
      )}

      <div className="card-divider" />

      {/* Breakdown */}
      <div className="stat-row">
        <span className="stat-label">Likes remaining</span>
        <span className="stat-value" style={status.likesRemaining === 0 ? { color: "var(--green)" } : undefined}>
          {status.likesRemaining === 0 ? "Done" : status.likesRemaining}
        </span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Subs remaining</span>
        <span className="stat-value" style={status.subsRemaining === 0 ? { color: "var(--green)" } : undefined}>
          {status.subsRemaining === 0 ? "Done" : status.subsRemaining}
        </span>
      </div>

      {totalRemoved > 0 && (
        <>
          <div className="card-divider" />
          <div className="stat-row">
            <span className="stat-label">Likes removed</span>
            <span className="stat-value">{status.likesRemovedTotal}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Subs removed</span>
            <span className="stat-value">{status.subsRemovedTotal}</span>
          </div>
        </>
      )}

      {/* Last run info */}
      {status.lastRun && (
        <>
          <div className="card-divider" />
          <div className="stat-row">
            <span className="stat-label">Last run</span>
            <span className="stat-value">{formatDateTime(status.lastRun)}</span>
          </div>
          {status.lastResult && (
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
              {status.lastResult}
            </div>
          )}
        </>
      )}

      {/* Next scheduled run */}
      {status.nextScheduledRun && !isDone && (
        <div className="stat-row">
          <span className="stat-label">Next run</span>
          <span className="stat-value">{formatDateTime(status.nextScheduledRun)}</span>
        </div>
      )}

      {/* Run button */}
      {!isDone && (
        <>
          <div className="card-divider" />
          <div style={{ display: "flex", gap: "8px", padding: "8px 0" }}>
            <button
              className="card-btn"
              onClick={triggerRun}
              disabled={actionPending || status.running}
            >
              {actionPending ? "Running..." : status.running ? "Running..." : "Run Now"}
            </button>
          </div>
        </>
      )}

      {lastAction && (
        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
          {lastAction}
        </div>
      )}
    </div>
  );
}
