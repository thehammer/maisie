import { useApi } from "../hooks/useApi";
import { useState } from "react";

interface DakboardDevice {
  id: number;
  name: string;
  serial_num: string;
  model: string;
  ip_addr: string;
  last_connect: string;
  screen_id: number;
}

interface DakboardScreen {
  id: number;
  name: string;
  is_default: boolean;
}

interface Props {
  pollInterval: number;
}

export function DakboardCard({ pollInterval }: Props) {
  const devicesApi = useApi<DakboardDevice[]>("/api/dakboard/devices", pollInterval);
  const screensApi = useApi<DakboardScreen[]>("/api/dakboard/screens", pollInterval);
  const [changing, setChanging] = useState<number | null>(null);

  const devices = devicesApi.data;
  const screens = screensApi.data;

  if (!devices && !devicesApi.error) return null;

  function screenName(screenId: number) {
    return screens?.find((s) => s.id === screenId)?.name || `Screen ${screenId}`;
  }

  async function changeScreen(deviceId: number, screenId: number) {
    setChanging(deviceId);
    await fetch(`/api/dakboard/devices/${deviceId}/screen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screenId }),
    });
    devicesApi.refresh();
    setChanging(null);
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">DAKboard</span>
        <span className="card-badge badge-muted">
          {devices?.length || 0} displays
        </span>
      </div>

      {devices?.map((device) => (
        <div key={device.id} className="list-item">
          <div className="list-item-text">
            <div className="list-item-title">{device.name || device.serial_num}</div>
            <div className="list-item-sub">
              {device.model} — {screenName(device.screen_id)}
            </div>
          </div>
          {screens && screens.length > 1 && (
            <select
              className="screen-select"
              value={device.screen_id}
              disabled={changing === device.id}
              onChange={(e) => changeScreen(device.id, Number(e.target.value))}
            >
              {screens.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}
