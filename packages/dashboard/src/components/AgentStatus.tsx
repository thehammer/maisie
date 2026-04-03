import { useApi } from "../hooks/useApi";

interface AgentStatus {
  status: string;
  personas: { name: string; role: string }[];
  tools: number;
  eventRules: number;
}

export function AgentStatus() {
  const { data } = useApi<AgentStatus>("/api/agent/status", 30_000);

  if (!data) return null;

  const ready = data.status === "active";

  return (
    <div className="agent-status-widget" title={`${data.tools} tools · ${data.eventRules} event rules · ${data.personas.length} personas`}>
      <div className={`status-dot${ready ? "" : " down"}`} />
      <span className="agent-status-mem">
        {data.tools}t · {data.personas.length}p
      </span>
    </div>
  );
}
