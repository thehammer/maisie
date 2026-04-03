import { useApi } from "../hooks/useApi";

interface AgentStatus {
  status: "ready" | "unavailable";
  persona: string;
  facts: number;
  episodes: number;
}

export function AgentStatus() {
  const { data } = useApi<AgentStatus>("/api/agent/status", 30_000);

  if (!data) return null;

  const ready = data.status === "ready";

  return (
    <div className="agent-status-widget" title={`${data.facts} facts · ${data.episodes} episodes`}>
      <div className={`status-dot${ready ? "" : " down"}`} />
      <span className="agent-status-persona">{data.persona}</span>
      <span className="agent-status-mem">
        {data.facts}f · {data.episodes}ep
      </span>
    </div>
  );
}
