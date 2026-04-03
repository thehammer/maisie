import { useState, useEffect, useRef } from "react";
import { useMqtt } from "../hooks/useMqtt";
import type { BridgeMessage } from "@maisie/shared";

const API = import.meta.env.VITE_API_URL || "";

export function BridgePage({ onBack }: { onBack: () => void }) {
  const [messages, setMessages] = useState<BridgeMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API}/api/bridge/messages`)
      .then((r) => r.json())
      .then((data) => setMessages(data.messages));
  }, []);

  useMqtt({
    topics: ["home/bridge/message"],
    onMessage: (_topic, payload) => {
      const msg = payload as unknown as BridgeMessage;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setInput("");
    try {
      const res = await fetch(`${API}/api/bridge/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "browser", content }),
      });
      const msg = await res.json();
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    } finally {
      setSending(false);
    }
  };

  const reset = async () => {
    await fetch(`${API}/api/bridge/reset`, { method: "POST" });
    setMessages([]);
  };

  return (
    <>
      <div className="bsp-header">
        <button className="bsp-back" onClick={onBack}>&larr; Dashboard</button>
        <h2>Claude Bridge</h2>
        <button className="bsp-back" onClick={reset} style={{ marginLeft: "auto" }}>
          Clear
        </button>
      </div>

      <div className="bridge-messages">
        {messages.length === 0 && (
          <div className="bridge-empty">
            No messages yet. Send a message or wait for Claude Code to connect.
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`bridge-msg bridge-msg-${msg.from}`}>
            <div className="bridge-msg-meta">
              <span className="bridge-msg-from">{msg.from === "code" ? "Claude Code" : "Browser"}</span>
              <span className="bridge-msg-time">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="bridge-msg-content">{msg.content}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="bridge-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type a message..."
          disabled={sending}
        />
        <button onClick={send} disabled={sending || !input.trim()}>
          Send
        </button>
      </div>
    </>
  );
}
