import { useState, useEffect, useRef, useCallback } from "react";
import type { BridgeMessage, BridgeCommand, BridgeResult, BridgeCommandAction } from "@maisie/shared";

const API = import.meta.env.VITE_API_URL || "";
const POLL_INTERVAL = 2500;
const DEFAULT_TARGET = `${window.location.origin}/#dashboard`;

export function BridgeAgentPage({ onBack }: { onBack: () => void }) {
  const [targetUrl, setTargetUrl] = useState(DEFAULT_TARGET);
  const [urlInput, setUrlInput] = useState(DEFAULT_TARGET);
  const [log, setLog] = useState<string[]>([]);
  const [polling, setPolling] = useState(true);
  const [consoleBuffer, setConsoleBuffer] = useState<Array<{ level: string; text: string; time: string }>>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sinceRef = useRef<string>(new Date().toISOString());
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [...prev.slice(-200), `[${ts}] ${msg}`]);
  }, []);

  const postResult = useCallback(async (action: BridgeCommandAction, success: boolean, data?: unknown, error?: string) => {
    const result: BridgeResult = { action, success, ...(data !== undefined && { data }), ...(error && { error }) };
    const content = success ? `[result] ${action}: ok` : `[result] ${action}: ${error}`;
    await fetch(`${API}/api/bridge/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "browser", content, result }),
    });
  }, []);

  // Execute JS in the iframe — the universal execution engine
  const iframeEval = useCallback((code: string): unknown => {
    const win = iframeRef.current?.contentWindow as (Window & typeof globalThis) | null;
    if (!win) throw new Error("Cannot access iframe");
    return win.eval(code);
  }, []);

  const executeCommand = useCallback(async (cmd: BridgeCommand) => {
    addLog(`Executing: ${cmd.action}${cmd.selector ? ` (${cmd.selector})` : ""}${cmd.url ? ` → ${cmd.url}` : ""}`);

    try {
      switch (cmd.action) {
        case "navigate": {
          const url = cmd.url ?? DEFAULT_TARGET;
          // For hash-only changes on the same origin, use evalJs to avoid full reload
          try {
            const targetOrigin = new URL(url).origin;
            const currentOrigin = new URL(targetUrl).origin;
            const targetHash = new URL(url).hash;
            if (targetOrigin === currentOrigin && targetHash) {
              iframeEval(`window.location.hash = ${JSON.stringify(targetHash)}`);
              setUrlInput(url);
              await new Promise((r) => setTimeout(r, 500)); // let React re-render
              await postResult("navigate", true);
              addLog("Navigate complete (hash)");
              break;
            }
          } catch { /* invalid URL, fall through to full navigate */ }

          setTargetUrl(url);
          setUrlInput(url);
          await new Promise<void>((resolve) => {
            const iframe = iframeRef.current;
            if (!iframe) return resolve();
            const onLoad = () => { iframe.removeEventListener("load", onLoad); resolve(); };
            iframe.addEventListener("load", onLoad);
            setTimeout(resolve, 5000);
          });
          await postResult("navigate", true);
          addLog("Navigate complete");
          break;
        }

        case "readText": {
          const sel = cmd.selector ? JSON.stringify(cmd.selector) : "null";
          const text = iframeEval(
            `(() => { const el = ${sel} ? document.querySelector(${sel}) : document.body; ` +
            `if (!el) throw new Error('Element not found: ' + ${sel}); return el.textContent || ''; })()`
          ) as string;
          await postResult("readText", true, text);
          addLog(`readText: ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`);
          break;
        }

        case "readHtml": {
          const sel = cmd.selector ? JSON.stringify(cmd.selector) : "null";
          const html = iframeEval(
            `(() => { const el = ${sel} ? document.querySelector(${sel}) : document.documentElement; ` +
            `if (!el) throw new Error('Element not found: ' + ${sel}); return el.outerHTML; })()`
          ) as string;
          await postResult("readHtml", true, html);
          addLog(`readHtml: ${html.length} chars`);
          break;
        }

        case "click": {
          const sel = JSON.stringify(cmd.selector ?? "");
          iframeEval(
            `(() => { const el = document.querySelector(${sel}); ` +
            `if (!el) throw new Error('Element not found: ' + ${sel}); el.click(); })()`
          );
          await postResult("click", true);
          addLog(`Clicked: ${cmd.selector}`);
          break;
        }

        case "type": {
          const sel = JSON.stringify(cmd.selector ?? "");
          const text = JSON.stringify(cmd.text ?? "");
          iframeEval(
            `(() => { const el = document.querySelector(${sel}); ` +
            `if (!el) throw new Error('Element not found: ' + ${sel}); ` +
            `el.focus(); el.value = ${text}; ` +
            `el.dispatchEvent(new Event('input', { bubbles: true })); ` +
            `el.dispatchEvent(new Event('change', { bubbles: true })); })()`
          );
          await postResult("type", true);
          addLog(`Typed into ${cmd.selector}: "${cmd.text}"`);
          break;
        }

        case "evalJs": {
          const result = iframeEval(cmd.code ?? "");
          await postResult("evalJs", true, result);
          addLog(`evalJs result: ${JSON.stringify(result).slice(0, 100)}`);
          break;
        }

        case "readConsole": {
          await postResult("readConsole", true, [...consoleBuffer]);
          addLog(`readConsole: ${consoleBuffer.length} entries`);
          setConsoleBuffer([]);
          break;
        }

        case "waitFor": {
          const sel = JSON.stringify(cmd.selector ?? "");
          const timeout = cmd.timeout ?? 5000;
          const found = await new Promise<boolean>((resolve) => {
            const check = () => {
              try {
                return !!iframeEval(`document.querySelector(${sel})`);
              } catch { return false; }
            };
            if (check()) return resolve(true);
            const interval = setInterval(() => {
              if (check()) { clearInterval(interval); resolve(true); }
            }, 200);
            setTimeout(() => { clearInterval(interval); resolve(false); }, timeout);
          });
          await postResult("waitFor", true, found);
          addLog(`waitFor ${cmd.selector}: ${found ? "found" : "timeout"}`);
          break;
        }

        case "getPageInfo": {
          const iframe = iframeRef.current;
          if (!iframe) { await postResult("getPageInfo", false, undefined, "No iframe"); break; }
          const info = iframeEval(
            `({ url: location.href, title: document.title, ` +
            `viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, ` +
            `readyState: document.readyState })`
          );
          await postResult("getPageInfo", true, info);
          addLog(`pageInfo: ${(info as any)?.title}`);
          break;
        }

        case "screenshot": {
          // Capture what's visible — serialize DOM to SVG foreignObject then canvas
          const iframe = iframeRef.current;
          if (!iframe) { await postResult("screenshot", false, undefined, "No iframe"); break; }
          try {
            const html = iframeEval("document.documentElement.outerHTML") as string;
            const width = iframe.clientWidth;
            const height = iframe.clientHeight;
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
              <foreignObject width="100%" height="100%">
                <div xmlns="http://www.w3.org/1999/xhtml">${html}</div>
              </foreignObject>
            </svg>`;
            const blob = new Blob([svg], { type: "image/svg+xml" });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = reject;
              img.src = url;
            });
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            canvas.getContext("2d")?.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            const dataUrl = canvas.toDataURL("image/png");
            await postResult("screenshot", true, dataUrl);
            addLog("Screenshot captured");
          } catch (err) {
            await postResult("screenshot", false, undefined, String(err));
          }
          break;
        }

        case "getTabs": {
          await postResult("getTabs", true, [{ url: targetUrl, active: true }]);
          break;
        }

        default:
          await postResult(cmd.action, false, undefined, `Unknown action: ${cmd.action}`);
      }
    } catch (err) {
      await postResult(cmd.action, false, undefined, String(err));
      addLog(`Error: ${err}`);
    }
  }, [addLog, postResult, iframeEval, targetUrl, consoleBuffer]);

  // Capture console from iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const onLoad = () => {
      try {
        const win = iframe.contentWindow as (Window & typeof globalThis) | null;
        if (!win) return;
        const origConsole = { log: win.console.log, warn: win.console.warn, error: win.console.error, info: win.console.info };
        for (const level of ["log", "warn", "error", "info"] as const) {
          win.console[level] = (...args: unknown[]) => {
            origConsole[level].apply(win.console, args);
            setConsoleBuffer((prev) => [...prev.slice(-100), {
              level,
              text: args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" "),
              time: new Date().toISOString(),
            }]);
          };
        }
      } catch { /* cross-origin, ignore */ }
    };

    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [targetUrl]);

  // Poll for commands
  useEffect(() => {
    if (!polling) return;
    let active = true;

    const poll = async () => {
      while (active) {
        try {
          const res = await fetch(`${API}/api/bridge/messages?since=${sinceRef.current}`);
          const { messages } = await res.json() as { messages: BridgeMessage[] };

          for (const msg of messages) {
            sinceRef.current = msg.timestamp;
            if (msg.from === "code" && msg.command) {
              await executeCommand(msg.command);
            }
          }
        } catch { /* network error, retry */ }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      }
    };

    poll();
    return () => { active = false; };
  }, [polling, executeCommand]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  return (
    <>
      <div className="bsp-header">
        <button className="bsp-back" onClick={onBack}>&larr; Dashboard</button>
        <h2>Bridge Agent</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span className={`bridge-agent-status ${polling ? "active" : "paused"}`}>
            {polling ? "Polling" : "Paused"}
          </span>
          <button className="bsp-back" onClick={() => setPolling((p) => !p)}>
            {polling ? "Pause" : "Resume"}
          </button>
        </div>
      </div>

      <div className="bridge-agent-url-bar">
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setTargetUrl(urlInput); }}
          placeholder="Target URL..."
        />
        <button onClick={() => setTargetUrl(urlInput)}>Go</button>
      </div>

      <div className="bridge-agent-layout">
        <div className="bridge-agent-viewport">
          <iframe
            ref={iframeRef}
            src={targetUrl}
            title="Bridge Target"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        </div>
        <div className="bridge-agent-log">
          <div className="bridge-agent-log-header">
            <span>Command Log</span>
            <button onClick={() => setLog([])}>Clear</button>
          </div>
          <div className="bridge-agent-log-entries">
            {log.map((entry, i) => (
              <div key={i} className="bridge-agent-log-entry">{entry}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </>
  );
}
