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

const SUGGESTED_PROMPTS = [
  "What's on TV tonight?",
  "Who's on the network right now?",
  "What books am I currently reading?",
  "How is the NAS doing?",
  "Any packages arriving today?",
];

interface Props {
  onBack: () => void;
}

export function ChatPage({ onBack }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const statusApi = useApi<AgentStatus>("/api/agent/status", 30_000);
  const mentioned = detectMention(input);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const sendMessage = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || sending) return;

      const persona = detectMention(content) ?? undefined;

      const userMsg: Message = { id: genId(), role: "user", content };
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
          body: JSON.stringify({ message: content, persona, history }),
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
                prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
              );
              continue;
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + data } : m,
              ),
            );
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: "Sorry, something went wrong.", streaming: false }
                : m,
            ),
          );
        }
      } finally {
        setSending(false);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
        );
      }
    },
    [input, sending, statusApi.data, messages],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const status = statusApi.data;

  return (
    <div className="chat-page">
      {/* Status bar */}
      <div className="chat-page-statusbar">
        <button className="chat-page-back" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>

        <div className="chat-page-statusbar-center">
          <span className="chat-page-title">Maisie</span>
          {status && (
            <>
              <span className="chat-page-persona" style={{ color: personaColor(status.persona) }}>
                {status.persona}
              </span>
              <span className="chat-page-mem">{status.facts}f · {status.episodes}ep</span>
              <span className={`chat-page-status-dot ${status.status === "ready" ? "ready" : "down"}`} />
            </>
          )}
        </div>

        <div style={{ width: 80 }} />
      </div>

      {/* Messages */}
      <div className="chat-page-messages">
        {messages.length === 0 && (
          <div className="chat-page-empty">
            <div className="chat-page-empty-heading">How can I help with the house today?</div>
            <div className="chat-page-suggestions">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  className="chat-page-suggestion"
                  onClick={() => sendMessage(prompt)}
                  disabled={sending}
                >
                  {prompt}
                </button>
              ))}
            </div>
            <div className="chat-page-mention-tip">
              Use @natalie, @channing, or @alexandria for specialists
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-page-message chat-page-message-${msg.role}`}>
            {msg.role === "assistant" && (
              <div
                className="chat-page-message-persona"
                style={{ color: personaColor(msg.persona ?? "maisie") }}
              >
                {msg.persona ?? "maisie"}
              </div>
            )}
            <div className="chat-page-bubble">
              {msg.content || (msg.streaming ? <span className="chat-cursor" /> : null)}
              {msg.streaming && msg.content && <span className="chat-cursor" />}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {mentioned && (
        <div className="chat-page-mention-hint" style={{ color: personaColor(mentioned) }}>
          Routing to @{mentioned}
        </div>
      )}
      <div className="chat-page-input-area">
        <input
          ref={inputRef}
          className="chat-page-input"
          placeholder="Ask Maisie... (@natalie, @channing, @alexandria)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button
          className="chat-send-btn"
          onClick={() => sendMessage()}
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
  );
}
