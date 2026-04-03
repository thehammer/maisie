import { useState } from "react";
import type { EnrichmentStats, EnrichmentEntry } from "@maisie/shared";
import { useApi } from "../hooks/useApi";

const API_BASE = "";

interface QueueData {
  items: EnrichmentEntry[];
  total: number;
}

interface Props {
  pollInterval: number;
}

export function CalibreEnrichmentCard({ pollInterval }: Props) {
  const statsApi = useApi<EnrichmentStats>("/api/calibre/enrichment/status", pollInterval);
  const [scanning, setScanning] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [queueVisible, setQueueVisible] = useState(false);
  const [queueData, setQueueData] = useState<QueueData | null>(null);

  const stats = statsApi.data;
  if (!stats) return null;

  async function triggerScan() {
    setScanning(true);
    setLastAction(null);
    try {
      const res = await fetch(`${API_BASE}/api/calibre/enrichment/scan`, { method: "POST" });
      const data = await res.json();
      setLastAction(`Scanned ${data.totalBooks} books — ${data.booksWithGaps} with gaps, ${data.newlyAdded} new`);
      statsApi.refresh();
    } catch (err) {
      setLastAction(`Scan error: ${err}`);
    }
    setScanning(false);
  }

  async function triggerLookup() {
    setLookingUp(true);
    setLastAction(null);
    try {
      const res = await fetch(`${API_BASE}/api/calibre/enrichment/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchSize: 10 }),
      });
      const data = await res.json();
      setLastAction(`Looked up ${data.processed} books — ${data.found} found`);
      statsApi.refresh();
    } catch (err) {
      setLastAction(`Lookup error: ${err}`);
    }
    setLookingUp(false);
  }

  async function fetchQueue() {
    try {
      const res = await fetch(`${API_BASE}/api/calibre/enrichment/queue?status=enriched&limit=20`);
      const data = await res.json();
      setQueueData(data);
    } catch {}
  }

  async function toggleQueue() {
    if (!queueVisible) {
      await fetchQueue();
    }
    setQueueVisible(!queueVisible);
  }

  async function reviewBook(bookId: number, action: "approve" | "reject") {
    try {
      await fetch(`${API_BASE}/api/calibre/enrichment/review/${bookId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await fetchQueue();
      statsApi.refresh();
    } catch {}
  }

  const total = stats.total;
  const progress = total > 0 ? Math.round(((stats.applied + stats.skipped) / total) * 100) : 0;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Enrichment</span>
        <span className={`card-badge ${stats.pending > 0 ? "badge-yellow" : "badge-green"}`}>
          {progress}% done
        </span>
      </div>

      <div className="stat-row">
        <span className="stat-label">Total tracked</span>
        <span className="stat-value">{stats.total}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Pending</span>
        <span className="stat-value">{stats.pending}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Enriched</span>
        <span className="stat-value">{stats.enriched}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Reviewed</span>
        <span className="stat-value">{stats.reviewed}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Applied</span>
        <span className="stat-value">{stats.applied}</span>
      </div>
      {stats.error > 0 && (
        <div className="stat-row">
          <span className="stat-label" style={{ color: "#ef4444" }}>Errors</span>
          <span className="stat-value" style={{ color: "#ef4444" }}>{stats.error}</span>
        </div>
      )}

      <div className="card-divider" />
      <div className="card-section-title">Gaps</div>
      {Object.entries(stats.gapBreakdown)
        .filter(([, count]) => count > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([key, count]) => (
          <div key={key} className="stat-row">
            <span className="stat-label">{key}</span>
            <span className="stat-value">{count}</span>
          </div>
        ))}

      <div className="card-divider" />
      <div style={{ display: "flex", gap: "8px", padding: "8px 0" }}>
        <button
          className="card-btn"
          onClick={triggerScan}
          disabled={scanning}
        >
          {scanning ? "Scanning..." : "Scan Library"}
        </button>
        <button
          className="card-btn"
          onClick={triggerLookup}
          disabled={lookingUp || stats.pending === 0}
        >
          {lookingUp ? "Looking up..." : "Run Lookups"}
        </button>
        <button
          className="card-btn"
          onClick={toggleQueue}
        >
          {queueVisible ? "Hide Queue" : "Review Queue"}
        </button>
      </div>

      {lastAction && (
        <div className="list-item">
          <div className="list-item-text">
            <div className="list-item-sub">{lastAction}</div>
          </div>
        </div>
      )}

      {queueVisible && queueData && (
        <>
          <div className="card-divider" />
          <div className="card-section-title">
            Review Queue ({queueData.total} enriched)
          </div>
          {queueData.items.map((item) => (
            <div key={item.bookId} className="list-item" style={{ flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
              <div className="list-item-text">
                <div className="list-item-title">{item.title}</div>
                <div className="list-item-sub">
                  {item.authors.join(", ")}
                  {item.confidence !== null && ` · ${Math.round(item.confidence * 100)}% confidence`}
                  {item.changeSource && ` · ${item.changeSource}`}
                </div>
                {item.proposedChanges && (
                  <div className="list-item-sub" style={{ fontSize: "11px", opacity: 0.7 }}>
                    {item.proposedChanges.tags && `Tags: ${item.proposedChanges.tags.join(", ")}`}
                    {item.proposedChanges.isbn && ` · ISBN: ${item.proposedChanges.isbn}`}
                    {item.proposedChanges.series && ` · Series: ${item.proposedChanges.series}`}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <button className="card-btn" onClick={() => reviewBook(item.bookId, "approve")}>
                  Approve
                </button>
                <button className="card-btn" onClick={() => reviewBook(item.bookId, "reject")}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
