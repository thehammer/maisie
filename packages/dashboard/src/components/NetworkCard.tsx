import type { Device } from "@maisie/shared";

interface Props {
  devices: Device[];
}

// Device types that belong on the Default VLAN (user devices, infrastructure)
const DEFAULT_VLAN_TYPES = new Set([
  "computer", "phone", "tablet", "server", "network", "camera",
  "gaming", "streaming", "unknown", "ap", "wearable",
  "tuner", "av", "display",
]);

export function NetworkCard({ devices }: Props) {
  const byStatus: Record<string, number> = {};
  for (const d of devices) {
    byStatus[d.status] = (byStatus[d.status] || 0) + 1;
  }

  const byType: Record<string, number> = {};
  for (const d of devices) {
    byType[d.deviceType] = (byType[d.deviceType] || 0) + 1;
  }

  const newCount = byStatus["new"] || 0;
  const suspiciousCount = byStatus["suspicious"] || 0;
  const alertCount = newCount + suspiciousCount;

  // IoT devices on Default VLAN that should be on IoT VLAN
  const misplacedIot = devices.filter(
    (d) =>
      d.networkSegment === "Default" &&
      !DEFAULT_VLAN_TYPES.has(d.deviceType) &&
      d.status !== "new",
  );

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Network</span>
        {alertCount > 0 ? (
          <span className="card-badge badge-yellow">{alertCount} new</span>
        ) : (
          <span className="card-badge badge-green">All known</span>
        )}
      </div>

      <div className="network-stats">
        <div>
          <div className="big-number">{devices.length}</div>
          <div className="big-number-label">Devices</div>
        </div>
        <div>
          <div className="big-number">{byStatus["trusted"] || 0}</div>
          <div className="big-number-label">Trusted</div>
        </div>
        <div>
          <div className="big-number">{newCount}</div>
          <div className="big-number-label">New</div>
        </div>
      </div>

      <div>
        {Object.entries(byType)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([type, count]) => (
            <div key={type} className="stat-row">
              <span className="stat-label">{type}</span>
              <span className="stat-value">{count}</span>
            </div>
          ))}
      </div>

      {misplacedIot.length > 0 && (
        <div className="vlan-alert">
          <div className="vlan-alert-header">
            <span className="card-badge badge-yellow">
              {misplacedIot.length} IoT on wrong VLAN
            </span>
          </div>
          <div className="vlan-alert-list">
            {misplacedIot.map((d) => (
              <div key={d.mac} className="vlan-alert-item">
                <span className="vlan-alert-name">
                  {d.deviceDescription || d.hostname || d.mac}
                </span>
                <span className="vlan-alert-detail">
                  {d.deviceType} &middot; {d.ip || "no IP"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
