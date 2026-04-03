import { useState, useCallback } from "react";
import { useApi } from "../hooks/useApi";

interface PersonaConfig {
  id: string;
  name: string;
  role: string;
  avatar?: string;
  defaultTier: "inform" | "advise" | "act";
  eventSubscriptions: string[];
  toolScopes: string[];
  systemPrompt: string;
  isCustom: boolean;
}

interface Props {
  onBack: () => void;
}

const TIER_STYLES: Record<string, { bg: string; color: string }> = {
  inform: { bg: "rgba(139, 143, 163, 0.15)", color: "#8b8fa3" },
  advise: { bg: "rgba(251, 191, 36, 0.12)", color: "#fbbf24" },
  act: { bg: "rgba(108, 140, 255, 0.12)", color: "var(--accent)" },
};

const PERSONA_COLORS: Record<string, string> = {
  maisie: "var(--accent)",
  natalie: "#38bdf8",
  channing: "#c084fc",
  alexandria: "#fbbf24",
};

function personaColor(name?: string): string {
  return PERSONA_COLORS[(name ?? "").toLowerCase()] ?? "var(--accent)";
}

function InitialAvatar({ name }: { name: string }) {
  const initial = name.charAt(0).toUpperCase();
  const color = personaColor(name);
  return (
    <div
      className="persona-avatar"
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {initial}
    </div>
  );
}

function TierBadge({ tier }: { tier: PersonaConfig["defaultTier"] }) {
  const s = TIER_STYLES[tier];
  return (
    <span className="card-badge" style={{ background: s.bg, color: s.color }}>
      {tier}
    </span>
  );
}

interface PersonaFormData {
  name: string;
  role: string;
  defaultTier: "inform" | "advise" | "act";
  systemPrompt: string;
  toolScopes: string;
  eventSubscriptions: string;
  avatar: string;
}

const EMPTY_FORM: PersonaFormData = {
  name: "",
  role: "",
  defaultTier: "inform",
  systemPrompt: "",
  toolScopes: "",
  eventSubscriptions: "",
  avatar: "",
};

function personaToForm(p: PersonaConfig): PersonaFormData {
  return {
    name: p.name,
    role: p.role,
    defaultTier: p.defaultTier,
    systemPrompt: p.systemPrompt,
    toolScopes: p.toolScopes.join(", "),
    eventSubscriptions: p.eventSubscriptions.join(", "),
    avatar: p.avatar ?? "",
  };
}

function formToPayload(f: PersonaFormData) {
  return {
    name: f.name,
    role: f.role,
    defaultTier: f.defaultTier,
    systemPrompt: f.systemPrompt,
    toolScopes: f.toolScopes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    eventSubscriptions: f.eventSubscriptions
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    avatar: f.avatar || undefined,
  };
}

function PersonaFormModal({
  initial,
  title,
  onClose,
  onSave,
}: {
  initial?: PersonaConfig;
  title: string;
  onClose: () => void;
  onSave: (data: ReturnType<typeof formToPayload>) => Promise<void>;
}) {
  const [form, setForm] = useState<PersonaFormData>(
    initial ? personaToForm(initial) : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof PersonaFormData, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.role.trim()) {
      setError("Name and role are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(formToPayload(form));
      onClose();
    } catch (err) {
      setError(String(err));
      setSaving(false);
    }
  };

  return (
    <div className="tv-modal-overlay" onClick={onClose}>
      <div
        className="tv-modal"
        style={{ width: 560, maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tv-modal-header">
          <h3>{title}</h3>
          <button className="tv-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="tv-modal-body">
          {error && (
            <div className="search-msg error" style={{ marginBottom: "0.75rem" }}>
              {error}
            </div>
          )}

          <div className="tv-modal-label">Name</div>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Scout"
            disabled={!!initial}
          />

          <div className="tv-modal-label">Role</div>
          <input
            value={form.role}
            onChange={(e) => set("role", e.target.value)}
            placeholder="e.g. Security & sensors specialist"
          />

          <div className="tv-modal-label">Default Tier</div>
          <select
            value={form.defaultTier}
            onChange={(e) => set("defaultTier", e.target.value as PersonaFormData["defaultTier"])}
          >
            <option value="inform">inform — agent calls freely</option>
            <option value="advise">advise — surfaces for approval</option>
            <option value="act">act — autonomous action</option>
          </select>

          <div className="tv-modal-label">System Prompt</div>
          <textarea
            className="persona-prompt-textarea"
            value={form.systemPrompt}
            onChange={(e) => set("systemPrompt", e.target.value)}
            placeholder="You are a specialist for..."
            rows={6}
          />

          <div className="tv-modal-label">Tool Scopes (comma-separated action names)</div>
          <input
            value={form.toolScopes}
            onChange={(e) => set("toolScopes", e.target.value)}
            placeholder="get_devices, get_wan_health"
          />

          <div className="tv-modal-label">Event Subscriptions (comma-separated MQTT patterns)</div>
          <input
            value={form.eventSubscriptions}
            onChange={(e) => set("eventSubscriptions", e.target.value)}
            placeholder="home/network/#, home/security/+"
          />

          <div className="tv-modal-label">Avatar URL (optional)</div>
          <input
            value={form.avatar}
            onChange={(e) => set("avatar", e.target.value)}
            placeholder="https://..."
          />
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

function ConfirmDialog({
  name,
  onClose,
  onConfirm,
}: {
  name: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
    onClose();
  };

  return (
    <div className="tv-modal-overlay" onClick={onClose}>
      <div className="tv-modal" style={{ width: 360 }} onClick={(e) => e.stopPropagation()}>
        <div className="tv-modal-header">
          <h3>Delete persona</h3>
          <button className="tv-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="tv-modal-body">
          <p style={{ fontSize: "0.9rem", color: "var(--text)" }}>
            Delete <strong>{name}</strong>? This cannot be undone.
          </p>
        </div>
        <div className="tv-modal-footer">
          <button className="tv-modal-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="tv-modal-save"
            style={{ background: "var(--red)", color: "white" }}
            onClick={handleConfirm}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PersonaCard({
  persona,
  onEdit,
  onDelete,
}: {
  persona: PersonaConfig;
  onEdit: (p: PersonaConfig) => void;
  onDelete: (p: PersonaConfig) => void;
}) {
  return (
    <div className="persona-card">
      <div className="persona-card-top">
        {persona.avatar ? (
          <img src={persona.avatar} alt={persona.name} className="persona-avatar persona-avatar-img" />
        ) : (
          <InitialAvatar name={persona.name} />
        )}
        <div className="persona-card-info">
          <div className="persona-card-name">
            {persona.name}
            {!persona.isCustom && (
              <span className="persona-lock" title="Built-in persona">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
            )}
          </div>
          <div className="persona-card-role">{persona.role}</div>
        </div>
        <TierBadge tier={persona.defaultTier} />
      </div>

      <div className="persona-card-stats">
        <span className="persona-stat">{persona.toolScopes.length} tools</span>
        <span className="persona-stat-sep" />
        <span className="persona-stat">{persona.eventSubscriptions.length} subscriptions</span>
      </div>

      {persona.isCustom && (
        <div className="persona-card-actions">
          <button className="card-btn" onClick={() => onEdit(persona)}>
            Edit
          </button>
          <button
            className="card-btn"
            style={{ color: "var(--red)", borderColor: "var(--red)" }}
            onClick={() => onDelete(persona)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function PersonasPage({ onBack }: Props) {
  const personasApi = useApi<PersonaConfig[]>("/api/personas", 60_000);
  const [personas, setPersonas] = useState<PersonaConfig[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PersonaConfig | null>(null);
  const [deleting, setDeleting] = useState<PersonaConfig | null>(null);

  const effective = personas ?? personasApi.data ?? null;

  const handleCreate = useCallback(
    async (data: ReturnType<typeof formToPayload>) => {
      const res = await fetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const created: PersonaConfig = await res.json();
      setPersonas((prev) => [...(prev ?? effective ?? []), created]);
    },
    [effective],
  );

  const handleEdit = useCallback(
    async (data: ReturnType<typeof formToPayload>) => {
      if (!editing) return;
      const res = await fetch(`/api/personas/${encodeURIComponent(editing.name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const updated: PersonaConfig = await res.json();
      setPersonas((prev) =>
        (prev ?? effective ?? []).map((p) => (p.name === editing.name ? updated : p)),
      );
    },
    [editing, effective],
  );

  const handleDelete = useCallback(async () => {
    if (!deleting) return;
    const res = await fetch(`/api/personas/${encodeURIComponent(deleting.name)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`${res.status}`);
    setPersonas((prev) => (prev ?? effective ?? []).filter((p) => p.name !== deleting.name));
  }, [deleting, effective]);

  return (
    <div className="personas-page">
      <div className="bsp-header">
        <button className="bsp-back" onClick={onBack}>
          &larr; Back
        </button>
        <h2>Personas</h2>
        <button className="search-btn" onClick={() => setCreating(true)}>
          + New Persona
        </button>
      </div>

      {personasApi.loading && !effective && (
        <div className="bsp-loading">Loading personas…</div>
      )}
      {personasApi.error && !effective && (
        <div className="bsp-empty">Could not load personas.</div>
      )}

      {effective && (
        <div className="personas-grid">
          {effective.map((p) => (
            <PersonaCard
              key={p.id}
              persona={p}
              onEdit={setEditing}
              onDelete={setDeleting}
            />
          ))}
        </div>
      )}

      {creating && (
        <PersonaFormModal
          title="New Persona"
          onClose={() => setCreating(false)}
          onSave={handleCreate}
        />
      )}

      {editing && (
        <PersonaFormModal
          title={`Edit — ${editing.name}`}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={handleEdit}
        />
      )}

      {deleting && (
        <ConfirmDialog
          name={deleting.name}
          onClose={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
