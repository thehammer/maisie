import { useState } from "react";
import type { NightlyStatus } from "@maisie/shared";
import { useApi } from "../hooks/useApi";

const API_BASE = "";

interface Props {
  pollInterval: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function NightlyCard({ pollInterval }: Props) {
  const statusApi = useApi<NightlyStatus>("/api/maintenance/nightly/status", pollInterval);
  const [actionPending, setActionPending] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const status = statusApi.data;
  if (!status) return null;

  async function triggerStart() {
    setActionPending(true);
    setLastAction(null);
    try {
      const res = await fetch(`${API_BASE}/api/maintenance/nightly/start`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setLastAction("Started nightly run");
      } else {
        setLastAction(`Could not start: ${data.error}`);
      }
      statusApi.refresh();
    } catch (err) {
      setLastAction(`Error: ${err}`);
    }
    setActionPending(false);
  }

  async function triggerStop() {
    setActionPending(true);
    setLastAction(null);
    try {
      const res = await fetch(`${API_BASE}/api/maintenance/nightly/stop`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setLastAction("Stop requested — finishing current file...");
      } else {
        setLastAction(`Could not stop: ${data.error}`);
      }
      statusApi.refresh();
    } catch (err) {
      setLastAction(`Error: ${err}`);
    }
    setActionPending(false);
  }

  const run = status.currentRun;
  const progress = status.totalFiles > 0
    ? Math.round((status.processedFiles / status.totalFiles) * 100)
    : 0;

  const totalCleaned = run?.filesCleaned || 0;
  const totalSkipped = run?.filesSkipped || 0;
  const totalErrored = run?.filesErrored || 0;
  const spaceSaved = run?.spaceRecoveredBytes || 0;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Nightly Maintenance</span>
        <span className={`card-badge ${
          status.running ? "badge-green" : status.inWindow ? "badge-yellow" : "badge-muted"
        }`}>
          {status.running ? "ACTIVE" : status.inWindow ? "IN WINDOW" : "IDLE"}
        </span>
      </div>

      {status.running && run && (
        <>
          <div className="stat-row">
            <span className="stat-label">Started</span>
            <span className="stat-value">{formatTime(run.startedAt)}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Window</span>
            <span className="stat-value">
              {status.windowStart}:00 — {status.windowEnd}:00
            </span>
          </div>
          <div className="card-divider" />

          <div className="stat-row">
            <span className="stat-label">Progress</span>
            <span className="stat-value">
              {status.processedFiles} / {status.totalFiles} files
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill green"
              style={{ width: `${progress}%` }}
            />
          </div>

          {status.currentFile && (
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>
              {status.currentFile}
            </div>
          )}

          <div className="card-divider" />

          <div className="stat-row">
            <span className="stat-label">Cleaned</span>
            <span className="stat-value">{totalCleaned}</span>
          </div>
          {totalSkipped > 0 && (
            <div className="stat-row">
              <span className="stat-label">Skipped (ok)</span>
              <span className="stat-value">{totalSkipped}</span>
            </div>
          )}
          {totalErrored > 0 && (
            <div className="stat-row">
              <span className="stat-label" style={{ color: "var(--red)" }}>Errors</span>
              <span className="stat-value" style={{ color: "var(--red)" }}>{totalErrored}</span>
            </div>
          )}
          {spaceSaved > 0 && (
            <div className="stat-row">
              <span className="stat-label">Space saved</span>
              <span className="stat-value">{formatBytes(spaceSaved)}</span>
            </div>
          )}
        </>
      )}

      {!status.running && (
        <>
          <div className="stat-row">
            <span className="stat-label">Window</span>
            <span className="stat-value">
              {status.windowStart}:00 — {status.windowEnd}:00
            </span>
          </div>
        </>
      )}

      {status.recentRuns.length > 0 && (
        <>
          <div className="card-divider" />
          <div className="card-section-title">Recent Runs</div>
          {status.recentRuns
            .filter((r) => r.status !== "running")
            .slice(0, 3)
            .map((r) => (
              <div key={r.id} className="list-item">
                <div className="list-item-text">
                  <div className="list-item-title">
                    {formatDate(r.startedAt)} — {r.filesCleaned} cleaned
                    {r.filesErrored > 0 && `, ${r.filesErrored} errors`}
                  </div>
                  <div className="list-item-sub">
                    {r.status === "completed" ? "Completed" : r.status === "stopped" ? "Stopped" : r.status}
                    {r.spaceRecoveredBytes > 0 && ` · Saved ${formatBytes(r.spaceRecoveredBytes)}`}
                  </div>
                </div>
              </div>
            ))}
        </>
      )}

      <div className="card-divider" />
      <div style={{ display: "flex", gap: "8px", padding: "8px 0" }}>
        {!status.running ? (
          <button
            className="card-btn"
            onClick={triggerStart}
            disabled={actionPending}
          >
            {actionPending ? "Starting..." : "Run Now"}
          </button>
        ) : (
          <button
            className="card-btn"
            onClick={triggerStop}
            disabled={actionPending}
          >
            {actionPending ? "Stopping..." : "Stop"}
          </button>
        )}
      </div>

      {lastAction && (
        <div className="list-item">
          <div className="list-item-text">
            <div className="list-item-sub">{lastAction}</div>
          </div>
        </div>
      )}
    </div>
  );
}
