import { useApi } from "../hooks/useApi";

interface SwitchItem {
  entityId: string;
  name: string;
  state: string;
}

interface LightItem {
  entityId: string;
  name: string;
  state: string;
  brightness?: number;
}

interface Props {
  pollInterval: number;
}

export function SmartHomeCard({ pollInterval }: Props) {
  const lightsApi = useApi<LightItem[]>("/api/ha/lights", pollInterval);
  const switchesApi = useApi<SwitchItem[]>("/api/ha/switches", pollInterval);

  const lights = lightsApi.data || [];
  const switches = switchesApi.data || [];
  const all = [
    ...lights.map((l) => ({ ...l, kind: "light" as const })),
    ...switches.map((s) => ({ ...s, kind: "switch" as const })),
  ];

  if (all.length === 0 && !lightsApi.error && !switchesApi.error) {
    return null;
  }

  const onCount = all.filter((d) => d.state === "on").length;

  async function toggle(entityId: string, kind: "light" | "switch") {
    const endpoint =
      kind === "light"
        ? `/api/ha/lights/${entityId}/toggle`
        : `/api/ha/switches/${entityId}/toggle`;
    await fetch(endpoint, { method: "POST" });
    // Refresh after toggle
    lightsApi.refresh();
    switchesApi.refresh();
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Smart Home</span>
        <span className={`card-badge ${onCount > 0 ? "badge-green" : "badge-muted"}`}>
          {onCount} on
        </span>
      </div>

      {all.map((device) => (
        <div key={device.entityId} className="list-item">
          <div className="list-item-text">
            <div className="list-item-title">{device.name}</div>
            <div className="list-item-sub">
              {device.kind === "light" && device.state === "on" && (device as LightItem).brightness
                ? `${Math.round(((device as LightItem).brightness! / 255) * 100)}% brightness`
                : device.state}
            </div>
          </div>
          <button
            className={`toggle-btn ${device.state === "on" ? "on" : ""}`}
            onClick={() => toggle(device.entityId, device.kind)}
          >
            {device.state === "on" ? "ON" : "OFF"}
          </button>
        </div>
      ))}
    </div>
  );
}
