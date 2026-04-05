import { useState, useEffect, useRef, useCallback } from "react";
import { useApi } from "../hooks/useApi";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  persona?: string;
  streaming?: boolean;
}

interface AgentStatus {
  status: "ready" | "unavailable";
  persona: string;
  facts: number;
  episodes: number;
}

const PERSONA_COLORS: Record<string, string> = {
  maisie: "var(--accent)",
  natalie: "#38bdf8",
  channing: "#c084fc",
  alexandria: "#fbbf24",
};

const MENTION_RE = /@(natalie|channing|alexandria|maisie)\b/i;

function personaColor(name?: string): string {
  return PERSONA_COLORS[(name ?? "").toLowerCase()] ?? "var(--accent)";
}

function detectMention(text: string): string | undefined {
  const m = text.match(MENTION_RE);
  return m ? m[1].toLowerCase() : undefined;
}

function genId() {
  return Math.random().toString(36).slice(2);
}

interface Props {
  notificationCount: number;
  onOpenNotifications: () => void;
}

export function ChatPanel({ notificationCount, onOpenNotifications }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const statusApi = useApi<AgentStatus>("/api/agent/status", 30_000);

  const mentioned = detectMention(input);

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const persona = detectMention(text) ?? undefined;

    const userMsg: Message = { id: genId(), role: "user", content: text };
    const assistantId = genId();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      persona: persona ?? statusApi.data?.persona ?? "maisie",
      streaming: true,
    };

    // Snapshot completed turns before appending the new pair
    const history = messages
      .filter((m) => !m.streaming)
      .map(({ role, content: c }) => ({ role, content: c }));

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setSending(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, persona, history }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m))
            );
            continue;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + data } : m
            )
          );
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Sorry, something went wrong.", streaming: false }
              : m
          )
        );
      }
    } finally {
      setSending(false);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m))
      );
    }
  }, [input, sending, statusApi.data, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Floating action button */}
      <button
        className="chat-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open chat"
        title="Chat with Maisie"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {notificationCount > 0 && (
          <span className="chat-fab-badge" onClick={(e) => { e.stopPropagation(); onOpenNotifications(); }}>
            {notificationCount > 9 ? "9+" : notificationCount}
          </span>
        )}
      </button>

      {/* Slide-in panel */}
      {open && (
        <div className="chat-overlay" onClick={() => setOpen(false)} />
      )}
      <div className={`chat-panel${open ? " open" : ""}`}>
        <div className="chat-panel-header">
          <div className="chat-panel-title">
            <span style={{ color: "var(--accent)", fontWeight: 700 }}>Maisie</span>
            {statusApi.data && (
              <span className="chat-persona-badge" style={{ color: personaColor(statusApi.data.persona) }}>
                {statusApi.data.persona}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {notificationCount > 0 && (
              <button className="chat-notif-btn" onClick={onOpenNotifications} title="Notifications">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <span className="chat-notif-count">{notificationCount}</span>
              </button>
            )}
            <button className="chat-close-btn" onClick={() => setOpen(false)} aria-label="Close chat">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-empty">
              <div style={{ marginBottom: "0.5rem", fontSize: "1.5rem" }}>💬</div>
              <div>Ask Maisie anything about your home.</div>
              <div style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
                Use @natalie, @channing, or @alexandria for specialists.
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-message chat-message-${msg.role}`}>
              {msg.role === "assistant" && (
                <div
                  className="chat-message-persona"
                  style={{ color: personaColor(msg.persona ?? "maisie") }}
                >
                  {msg.persona ?? "maisie"}
                </div>
              )}
              <div className="chat-message-bubble">
                {msg.content || (msg.streaming ? <span className="chat-cursor" /> : null)}
                {msg.streaming && msg.content && <span className="chat-cursor" />}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {mentioned && (
          <div className="chat-mention-hint" style={{ color: personaColor(mentioned) }}>
            Routing to @{mentioned}
          </div>
        )}

        <div className="chat-input-row">
          <input
            ref={inputRef}
            className="chat-input"
            placeholder="Ask Maisie... (@natalie, @channing, @alexandria)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <button
            className="chat-send-btn"
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
