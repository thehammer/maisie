interface BambuStatus {
  state: string;
  progress: number;
  remainingMinutes: number;
  fileName: string;
  nozzleTemp: number;
  nozzleTarget: number;
  bedTemp: number;
  bedTarget: number;
  chamberTemp: number;
  speed: number;
  wifiSignal: string;
  layer: number;
  filaments: { slot: number; type: string; color: string }[];
}

interface Props {
  status: BambuStatus;
}

function formatTime(minutes: number): string {
  if (minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function speedLabel(level: number): string {
  switch (level) {
    case 1: return "Silent";
    case 2: return "Standard";
    case 3: return "Sport";
    case 4: return "Ludicrous";
    default: return `Level ${level}`;
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case "RUNNING": return "Printing";
    case "PAUSE": return "Paused";
    case "FINISH": return "Finished";
    case "IDLE": return "Idle";
    case "PREPARE": return "Preparing";
    case "FAILED": return "Failed";
    default: return state;
  }
}

function stateBadgeClass(state: string): string {
  switch (state) {
    case "RUNNING": return "badge-green";
    case "FINISH": return "badge-green";
    case "PAUSE": return "badge-yellow";
    case "FAILED": return "badge-red";
    default: return "badge-muted";
  }
}

function colorSwatch(hex: string): string {
  if (!hex || hex.length < 6) return "#888";
  return `#${hex.substring(0, 6)}`;
}

export function BambuCard({ status }: Props) {
  const isPrinting = status.state === "RUNNING";

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Bambu X1C</span>
        <span className={`card-badge ${stateBadgeClass(status.state)}`}>
          {stateLabel(status.state)}
        </span>
      </div>

      {isPrinting && status.fileName && (
        <div className="stat-row">
          <span className="stat-label">File</span>
          <span className="stat-value">{status.fileName}</span>
        </div>
      )}

      {isPrinting && (
        <>
          <div className="stat-row">
            <span className="stat-label">Progress</span>
            <span className="stat-value">{status.progress}%</span>
          </div>
          <div style={{ background: "#333", borderRadius: 4, height: 8, margin: "4px 0 8px" }}>
            <div
              style={{
                background: "#4ade80",
                borderRadius: 4,
                height: 8,
                width: `${status.progress}%`,
                transition: "width 0.5s ease",
              }}
            />
          </div>
          <div className="stat-row">
            <span className="stat-label">Remaining</span>
            <span className="stat-value">{formatTime(status.remainingMinutes)}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Layer</span>
            <span className="stat-value">{status.layer}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Speed</span>
            <span className="stat-value">{speedLabel(status.speed)}</span>
          </div>
        </>
      )}

      <div className="stat-row">
        <span className="stat-label">Nozzle</span>
        <span className="stat-value">{status.nozzleTemp}°C / {status.nozzleTarget}°C</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Bed</span>
        <span className="stat-value">{status.bedTemp}°C / {status.bedTarget}°C</span>
      </div>
      {status.chamberTemp > 0 && (
        <div className="stat-row">
          <span className="stat-label">Chamber</span>
          <span className="stat-value">{status.chamberTemp}°C</span>
        </div>
      )}

      {status.filaments.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <span className="stat-label">AMS Filaments</span>
          <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
            {status.filaments.map((f, i) => (
              <div
                key={i}
                title={`Slot ${f.slot}: ${f.type}`}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  background: colorSwatch(f.color),
                  border: "1px solid #555",
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
