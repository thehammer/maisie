/**
 * ProposalsPanel — Phase 4e Proactive Authoring UI
 *
 * Slide-out drawer listing pending agent proposals. Each proposal shows:
 * - Kind badge (entity / component)
 * - Name and reasoning (if present)
 * - MEL source in a code block
 * - Approve / Reject buttons
 *
 * The panel is opened by clicking the proposals badge in the ChatPanel.
 * After approval or rejection the item is removed from the pending list.
 */

import { useState, useEffect, useCallback } from "react";

interface Proposal {
  id: string;
  kind: "entity" | "component";
  name: string;
  source: string;
  reasoning?: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCountChange: (count: number) => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ProposalsPanel({ open, onClose, onCountChange }: Props) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // id of proposal being actioned

  const fetchProposals = useCallback(async () => {
    try {
      const res = await fetch("/api/proposals?status=pending");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as Proposal[];
      setProposals(data);
      onCountChange(data.length);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [onCountChange]);

  useEffect(() => {
    fetchProposals();
    const id = setInterval(fetchProposals, 30_000);
    return () => clearInterval(id);
  }, [fetchProposals]);

  const approve = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/proposals/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setProposals((prev) => prev.filter((p) => p.id !== id));
      onCountChange(Math.max(0, proposals.length - 1));
    } catch (err) {
      setError(`Approve failed: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  }, [proposals.length, onCountChange]);

  const reject = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/proposals/${id}/reject`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setProposals((prev) => prev.filter((p) => p.id !== id));
      onCountChange(Math.max(0, proposals.length - 1));
    } catch (err) {
      setError(`Reject failed: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  }, [proposals.length, onCountChange]);

  if (!open) return null;

  return (
    <>
      <div className="notif-overlay" onClick={onClose} />
      <div className="notif-panel proposals-panel">
        <div className="notif-header">
          <span className="card-title">Agent Proposals</span>
          <button className="chat-close-btn" onClick={onClose} aria-label="Close proposals">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="search-msg error" style={{ margin: "0.75rem" }}>
            {error}
          </div>
        )}

        {!error && proposals.length === 0 && (
          <div className="empty-state">No pending proposals</div>
        )}

        <div className="notif-list">
          {proposals.map((p) => (
            <div key={p.id} className="notif-item proposals-item">
              <div className="notif-item-header">
                <span className={`card-badge ${p.kind === "component" ? "badge-yellow" : "badge-green"}`}>
                  {p.kind}
                </span>
                <span className="proposals-item-name">{p.name}</span>
                <span className="notif-time">{relativeTime(p.createdAt)}</span>
              </div>

              {p.reasoning && (
                <div className="notif-message" style={{ marginBottom: "0.5rem" }}>
                  {p.reasoning}
                </div>
              )}

              <pre className="proposals-source">{p.source}</pre>

              <div className="proposals-actions">
                <button
                  className="card-btn"
                  onClick={() => approve(p.id)}
                  disabled={busy === p.id}
                  aria-label="Approve proposal"
                >
                  {busy === p.id ? "Saving…" : "Approve"}
                </button>
                <button
                  className="notif-dismiss-btn"
                  onClick={() => reject(p.id)}
                  disabled={busy === p.id}
                  aria-label="Reject proposal"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
