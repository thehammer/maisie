import { useState } from "react";
import { useApi } from "../hooks/useApi";

interface DockerService {
  service: string;
  image: string;
  currentDigest: string | null;
  lastChecked: string | null;
  lastUpdated: string | null;
  autoUpdate: boolean;
  enabled: boolean;
}

interface HistoryEntry {
  id: number;
  service: string;
  image: string;
  status: "updated" | "current" | "failed" | "skipped";
  errorMessage: string | null;
  checkedAt: string;
}

interface DockerUpgradesStatus {
  checking: boolean;
  upgradeHour: number;
  services: DockerService[];
  recentHistory: HistoryEntry[];
}

interface Props {
  pollInterval: number;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function shortDigest(digest: string | null): string {
  if (!digest) return "—";
  // sha256:abc123... → abc123
  const hash = digest.replace(/^sha256:/, "");
  return hash.slice(0, 12);
}

const STATUS_COLOR: Record<HistoryEntry["status"], string> = {
  updated: "var(--green, #4ade80)",
  current: "var(--text-muted, #6b7280)",
  failed: "var(--red, #f87171)",
  skipped: "var(--yellow, #facc15)",
};

export function DockerUpgradesCard({ pollInterval }: Props) {
  const statusApi = useApi<DockerUpgradesStatus>(
    "/api/maintenance/docker/status",
    pollInterval,
  );
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const status = statusApi.data;
  if (!status) return null;

  async function triggerCheck(service?: string) {
    const key = service ?? "all";
    setActionPending(key);
    setLastMessage(null);
    try {
      const res = await fetch("/api/maintenance/docker/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(service ? { service } : {}),
      });
      const data = await res.json();
      setLastMessage(
        data.ok
          ? service
            ? `Checking ${service}…`
            : "Check started for all services"
          : `Could not start: ${data.error}`,
      );
      statusApi.refresh();
    } catch (err) {
      setLastMessage(`Error: ${err}`);
    }
    setActionPending(null);
  }

  async function toggleAutoUpdate(service: string, current: boolean) {
    setActionPending(`toggle-${service}`);
    setLastMessage(null);
    try {
      const res = await fetch(`/api/maintenance/docker/services/${service}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoUpdate: !current }),
      });
      const data = await res.json();
      setLastMessage(
        data.ok
          ? `Auto-update ${!current ? "enabled" : "disabled"} for ${service}`
          : `Error: ${data.error}`,
      );
      statusApi.refresh();
    } catch (err) {
      setLastMessage(`Error: ${err}`);
    }
    setActionPending(null);
  }

  const recentFiltered = status.recentHistory.slice(0, 10);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Docker Updates</span>
        <span
          className={`card-badge ${
            status.checking ? "badge-yellow" : "badge-muted"
          }`}
        >
          {status.checking ? "CHECKING" : `auto @ ${status.upgradeHour}:00`}
        </span>
      </div>

      {/* Services table */}
      {status.services.length > 0 && (
        <>
          {status.services.map((svc) => (
            <div key={svc.service} className="list-item">
              <div className="list-item-text">
                <div className="list-item-title">
                  {svc.service}
                  {!svc.autoUpdate && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: "0.7rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      manual
                    </span>
                  )}
                </div>
                <div className="list-item-sub">
                  {svc.image}
                  {svc.currentDigest && (
                    <span style={{ marginLeft: 6 }}>
                      · {shortDigest(svc.currentDigest)}
                    </span>
                  )}
                  {svc.lastChecked && (
                    <span style={{ marginLeft: 6, color: "var(--text-muted)" }}>
                      · {formatRelative(svc.lastChecked)}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <button
                  className="card-btn"
                  style={{ fontSize: "0.7rem", padding: "2px 8px" }}
                  onClick={() => triggerCheck(svc.service)}
                  disabled={
                    !!actionPending || status.checking || !svc.enabled
                  }
                >
                  Check
                </button>
                <button
                  className="card-btn"
                  style={{
                    fontSize: "0.7rem",
                    padding: "2px 8px",
                    opacity: svc.autoUpdate ? 1 : 0.5,
                  }}
                  onClick={() => toggleAutoUpdate(svc.service, svc.autoUpdate)}
                  disabled={!!actionPending}
                  title={
                    svc.autoUpdate
                      ? "Disable auto-update"
                      : "Enable auto-update"
                  }
                >
                  {svc.autoUpdate ? "Auto ✓" : "Auto"}
                </button>
              </div>
            </div>
          ))}
          <div className="card-divider" />
        </>
      )}

      {status.services.length === 0 && (
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", padding: "8px 0" }}>
          No services configured.
        </div>
      )}

      {/* Check All button */}
      <div style={{ display: "flex", gap: 8, padding: "8px 0" }}>
        <button
          className="card-btn"
          onClick={() => triggerCheck()}
          disabled={!!actionPending || status.checking}
        >
          {status.checking
            ? "Checking…"
            : actionPending === "all"
              ? "Starting…"
              : "Check All Now"}
        </button>
      </div>

      {/* Recent history */}
      {recentFiltered.length > 0 && (
        <>
          <div className="card-divider" />
          <div className="card-section-title">Recent Activity</div>
          {recentFiltered.map((entry) => (
            <div key={entry.id} className="list-item">
              <div className="list-item-text">
                <div className="list-item-title">
                  {entry.service}
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: "0.72rem",
                      color: STATUS_COLOR[entry.status],
                    }}
                  >
                    {entry.status}
                  </span>
                </div>
                <div className="list-item-sub">
                  {formatRelative(entry.checkedAt)}
                  {entry.errorMessage && (
                    <span style={{ marginLeft: 6, color: "var(--red, #f87171)" }}>
                      · {entry.errorMessage}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {lastMessage && (
        <>
          <div className="card-divider" />
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", padding: "4px 0" }}>
            {lastMessage}
          </div>
        </>
      )}
    </div>
  );
}
