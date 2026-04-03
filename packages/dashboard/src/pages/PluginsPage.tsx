import { useState, useCallback } from "react";
import { useApi } from "../hooks/useApi";

interface EnvVarSpec {
  name: string;
  required: boolean;
  description: string;
  example?: string;
  currentValue?: string | null;
}

interface PluginInfo {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  envVars: EnvVarSpec[];
  enabled?: boolean;
}

interface Props {
  onBack: () => void;
}

const CAPABILITY_COLORS: Record<string, { bg: string; color: string }> = {
  network: { bg: "rgba(56, 189, 248, 0.12)", color: "#38bdf8" },
  storage: { bg: "rgba(74, 222, 128, 0.12)", color: "#4ade80" },
  "media-server": { bg: "rgba(192, 132, 252, 0.12)", color: "#c084fc" },
  camera: { bg: "rgba(251, 146, 60, 0.12)", color: "#fb923c" },
  "smart-home": { bg: "rgba(45, 212, 191, 0.12)", color: "#2dd4bf" },
  printer: { bg: "rgba(139, 143, 163, 0.15)", color: "#8b8fa3" },
  "book-library": { bg: "rgba(251, 191, 36, 0.12)", color: "#fbbf24" },
};

function capabilityStyle(cap: string) {
  return CAPABILITY_COLORS[cap] ?? { bg: "rgba(108, 140, 255, 0.12)", color: "var(--accent)" };
}

function PluginCard({
  plugin,
  onToggle,
  onConfigure,
}: {
  plugin: PluginInfo;
  onToggle: (name: string, enabled: boolean) => void;
  onConfigure: (plugin: PluginInfo) => void;
}) {
  const enabled = plugin.enabled !== false;

  return (
    <div className={`plugin-card${enabled ? "" : " plugin-card-disabled"}`}>
      <div className="plugin-card-header">
        <div className="plugin-card-name">{plugin.name}</div>
        <div className="plugin-card-version">v{plugin.version}</div>
      </div>
      <div className="plugin-card-desc">{plugin.description}</div>
      <div className="plugin-card-caps">
        {plugin.capabilities.map((cap) => {
          const s = capabilityStyle(cap);
          return (
            <span
              key={cap}
              className="plugin-cap-badge"
              style={{ background: s.bg, color: s.color }}
            >
              {cap}
            </span>
          );
        })}
      </div>
      <div className="plugin-card-actions">
        <button className="card-btn" onClick={() => onConfigure(plugin)}>
          Configure
        </button>
        <button
          className={`toggle-btn${enabled ? " on" : ""}`}
          onClick={() => onToggle(plugin.name, !enabled)}
        >
          {enabled ? "Enabled" : "Disabled"}
        </button>
      </div>
    </div>
  );
}

function ConfigureModal({
  plugin,
  onClose,
  onSave,
}: {
  plugin: PluginInfo;
  onClose: () => void;
  onSave: (name: string, overrides: Record<string, string>) => Promise<void>;
}) {
  const seedPairs = plugin.envVars?.length
    ? plugin.envVars.map((v) => ({ key: v.name, value: v.currentValue ?? "", spec: v }))
    : [{ key: "", value: "", spec: undefined as EnvVarSpec | undefined }];

  const [pairs, setPairs] = useState<Array<{ key: string; value: string; spec?: EnvVarSpec }>>(seedPairs);
  const [saving, setSaving] = useState(false);

  const addPair = () => setPairs((p) => [...p, { key: "", value: "" }]);
  const removePair = (i: number) => setPairs((p) => p.filter((_, idx) => idx !== i));
  const updatePair = (i: number, field: "key" | "value", val: string) => {
    setPairs((p) => p.map((pair, idx) => (idx === i ? { ...pair, [field]: val } : pair)));
  };

  const handleSave = async () => {
    const overrides: Record<string, string> = {};
    for (const { key, value } of pairs) {
      if (key.trim()) overrides[key.trim()] = value;
    }
    setSaving(true);
    await onSave(plugin.name, overrides);
    setSaving(false);
    onClose();
  };

  return (
    <div className="tv-modal-overlay" onClick={onClose}>
      <div className="tv-modal" style={{ width: 500 }} onClick={(e) => e.stopPropagation()}>
        <div className="tv-modal-header">
          <h3>Configure — {plugin.name}</h3>
          <button className="tv-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="tv-modal-body">
          <div className="tv-modal-label">Environment variable overrides</div>
          {pairs.map((pair, i) => (
            <div key={i} style={{ marginBottom: "0.5rem" }}>
              {pair.spec && (
                <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
                  <span style={{ color: pair.spec.required ? "#f87171" : "var(--muted)" }}>
                    {pair.spec.required ? "required" : "optional"}
                  </span>
                  {" — "}{pair.spec.description}
                  {pair.spec.example && <span style={{ opacity: 0.6 }}> (e.g. {pair.spec.example})</span>}
                </div>
              )}
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  placeholder="KEY"
                  value={pair.key}
                  readOnly={!!pair.spec}
                  onChange={(e) => updatePair(i, "key", e.target.value)}
                  style={{ flex: 1, fontFamily: "monospace", fontSize: "0.82rem", opacity: pair.spec ? 0.7 : 1 }}
                />
                <input
                  placeholder={pair.spec?.example ?? "value"}
                  value={pair.value}
                  onChange={(e) => updatePair(i, "value", e.target.value)}
                  style={{ flex: 2, fontFamily: "monospace", fontSize: "0.82rem" }}
                />
                {!pair.spec && (
                  <button
                    className="tv-manager-delete"
                    onClick={() => removePair(i)}
                    aria-label="Remove"
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>
          ))}
          <button className="card-btn" onClick={addPair} style={{ alignSelf: "flex-start", marginTop: "0.25rem" }}>
            + Add variable
          </button>
        </div>
        <div className="tv-modal-footer">
          <button className="tv-modal-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="tv-modal-save" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PluginsPage({ onBack }: Props) {
  const pluginsApi = useApi<{ plugins: PluginInfo[] }>("/api/plugins", 60_000);
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  const [configuring, setConfiguring] = useState<PluginInfo | null>(null);
  const [installPackage, setInstallPackage] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Sync local copy from API
  const effective = plugins ?? pluginsApi.data?.plugins ?? null;

  const handleToggle = useCallback(
    async (name: string, enabled: boolean) => {
      if (!effective) return;
      setPlugins(effective.map((p) => (p.name === name ? { ...p, enabled } : p)));
      try {
        await fetch(`/api/plugins/${encodeURIComponent(name)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
      } catch {
        // Revert on error
        setPlugins(effective);
      }
    },
    [effective],
  );

  const handleSaveConfig = useCallback(async (name: string, envOverrides: Record<string, string>) => {
    await fetch(`/api/plugins/${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ envOverrides }),
    });
  }, []);

  const handleInstall = useCallback(async () => {
    const pkg = installPackage.trim();
    if (!pkg || installing) return;
    setInstalling(true);
    setInstallMsg(null);
    try {
      const res = await fetch("/api/plugins/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: pkg }),
      });
      if (res.status === 404 || res.status === 501) {
        setInstallMsg({ text: "Plugin install is coming soon. Stay tuned.", ok: false });
      } else if (!res.ok) {
        setInstallMsg({ text: `Install failed: ${res.status}`, ok: false });
      } else {
        setInstallMsg({ text: `${pkg} installed successfully.`, ok: true });
        setInstallPackage("");
        pluginsApi.refresh();
      }
    } catch {
      setInstallMsg({ text: "Plugin install is coming soon. Stay tuned.", ok: false });
    } finally {
      setInstalling(false);
    }
  }, [installPackage, installing, pluginsApi]);

  return (
    <div className="plugins-page">
      <div className="bsp-header">
        <button className="bsp-back" onClick={onBack}>
          &larr; Back
        </button>
        <h2>Plugins</h2>
        {effective && (
          <span className="card-badge badge-muted">{effective.length} installed</span>
        )}
      </div>

      {pluginsApi.loading && !effective && (
        <div className="bsp-loading">Loading plugins…</div>
      )}
      {pluginsApi.error && !effective && (
        <div className="bsp-empty">Could not load plugins.</div>
      )}

      {effective && (
        <div className="plugins-grid">
          {effective.map((plugin) => (
            <PluginCard
              key={plugin.name}
              plugin={plugin}
              onToggle={handleToggle}
              onConfigure={setConfiguring}
            />
          ))}
        </div>
      )}

      {/* Install new plugin */}
      <div className="plugin-install-section">
        <div className="bsp-section-title">Install New Plugin</div>
        <div className="search-row">
          <input
            className="search-input"
            placeholder="npm package name (e.g. @maisie/plugin-hue)"
            value={installPackage}
            onChange={(e) => setInstallPackage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleInstall()}
            disabled={installing}
          />
          <button
            className="search-btn"
            onClick={handleInstall}
            disabled={!installPackage.trim() || installing}
          >
            {installing ? "Installing…" : "Install"}
          </button>
        </div>
        {installMsg && (
          <div className={`search-msg ${installMsg.ok ? "success" : "error"}`}>
            {installMsg.text}
          </div>
        )}
      </div>

      {configuring && (
        <ConfigureModal
          plugin={configuring}
          onClose={() => setConfiguring(null)}
          onSave={handleSaveConfig}
        />
      )}
    </div>
  );
}
