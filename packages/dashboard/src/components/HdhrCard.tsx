import type { HdhrStatus } from "@maisie/shared";

interface Props {
  status: HdhrStatus;
}

export function HdhrCard({ status }: Props) {
  const activeTuners = status.tuners.filter((t) => t.active);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">HDHomeRun</span>
        <span className={`card-badge ${activeTuners.length > 0 ? "badge-green" : "badge-muted"}`}>
          {activeTuners.length}/{status.tuners.length} tuners active
        </span>
      </div>

      <div className="stat-row">
        <span className="stat-label">Model</span>
        <span className="stat-value">{status.name}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Channels</span>
        <span className="stat-value">{status.channelCount}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Firmware</span>
        <span className="stat-value">{status.firmware}</span>
      </div>

      {status.tuners.map((tuner) => (
        <div key={tuner.id} className="list-item">
          <div className="list-item-text">
            <div className="list-item-title">{tuner.id}</div>
            <div className="list-item-sub">
              {tuner.active
                ? `${tuner.channelName || tuner.channel || "Active"}${tuner.signalStrength != null ? ` — ${tuner.signalStrength}% signal` : ""}`
                : "Idle"}
            </div>
          </div>
          <span className={`card-badge ${tuner.active ? "badge-green" : "badge-muted"}`}>
            {tuner.active ? "Active" : "Idle"}
          </span>
        </div>
      ))}
    </div>
  );
}
