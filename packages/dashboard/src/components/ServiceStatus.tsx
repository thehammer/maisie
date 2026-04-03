interface Service {
  name: string;
  status: "connected" | "unconfigured" | "error";
  detail?: string;
}

interface Props {
  services: Service[];
}

export function ServiceStatus({ services }: Props) {
  return (
    <div className="card wide">
      <div className="card-header">
        <span className="card-title">Services</span>
      </div>
      <div className="service-chips">
        {services.map((s) => (
          <div key={s.name} className="service-chip">
            <div
              className={`status-dot ${s.status === "connected" ? "" : s.status === "error" ? "down" : "degraded"}`}
            />
            <span className="service-chip-name">{s.name}</span>
            {s.detail && <span className="service-chip-detail">{s.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
