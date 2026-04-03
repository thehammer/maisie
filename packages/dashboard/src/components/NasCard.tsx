import type { NasHealth } from "@maisie/shared";

interface Props {
  health: NasHealth;
}

function progressColor(pct: number) {
  if (pct >= 95) return "red";
  if (pct >= 90) return "orange";
  if (pct >= 85) return "yellow";
  return "green";
}

function formatBytes(bytes: number) {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

export function NasCard({ health }: Props) {
  const { system, volumes, disks, containers } = health;

  const running = containers.filter((c) => c.status === "running").length;
  const stopped = containers.length - running;
  const maxDiskTemp = Math.max(...disks.map((d) => d.temp));

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">NAS — {system.model}</span>
        <span className="card-badge badge-green">DSM {system.dsmVersion.replace("DSM ", "").split(" ")[0]}</span>
      </div>

      <div className="stat-row">
        <span className="stat-label">Uptime</span>
        <span className="stat-value">{formatUptime(system.uptime)}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">CPU</span>
        <span className="stat-value">{system.cpuLoad}%</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">RAM</span>
        <span className="stat-value">{system.ramUsedPercent}%</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Disk Temp (max)</span>
        <span className="stat-value">{maxDiskTemp}°C</span>
      </div>

      {volumes.map((v) => (
        <div key={v.id} style={{ marginTop: "0.75rem" }}>
          <div className="stat-row">
            <span className="stat-label">{v.id}</span>
            <span className="stat-value" style={{ color: v.usedPercent >= 95 ? "var(--red)" : undefined }}>
              {formatBytes(v.usedBytes)} / {formatBytes(v.totalBytes)} ({v.usedPercent}%)
            </span>
          </div>
          <div className="progress-bar">
            <div className={`progress-fill ${progressColor(v.usedPercent)}`} style={{ width: `${v.usedPercent}%` }} />
          </div>
        </div>
      ))}

      <div style={{ marginTop: "1rem" }}>
        <div className="stat-row">
          <span className="stat-label">Containers</span>
          <span className="stat-value">
            {running} running{stopped > 0 ? `, ${stopped} stopped` : ""}
          </span>
        </div>
        <div className="container-grid" style={{ marginTop: "0.5rem" }}>
          {containers.map((c) => (
            <div key={c.name} className={`container-pill ${c.status !== "running" ? "stopped" : ""}`}>
              {c.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
