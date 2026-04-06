import { useState, useEffect, useRef, useCallback } from "react";
import type { ProtectStatus } from "@maisie/shared";

const API = import.meta.env.VITE_API_URL || "";

interface CameraInfo {
  id: string;
  name: string;
  streamName: string;
  group: string;
}

// Map camera name to go2rtc stream name (must match config/go2rtc.yaml keys).
// Normalize both straight (') and curly (') apostrophes before slugifying.
function toStreamName(name: string): string {
  return name.toLowerCase().replace(/[\u2018\u2019']/g, "").replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
}

// Safari (including iOS) has unreliable MediaSource support — use native HLS instead.
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

function CameraFeed({ camera }: { camera: CameraInfo }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.className = "cam-video";
    container.prepend(video);

    // Safari: use native HLS — no MSE/WebSocket needed, lower latency on iOS.
    // go2rtc's HLS endpoint is proxied through Caddy at /go2rtc/*.
    if (isSafari) {
      const hlsUrl = `/go2rtc/api/stream.m3u8?src=${camera.streamName}`;
      video.src = hlsUrl;
      video.oncanplay = () => setStatus("live");
      video.onerror = () => setStatus("error");
      return () => { video.src = ""; video.remove(); };
    }

    // All other browsers: WebSocket + MSE for lower latency.
    // Proxied through Caddy at /go2rtc/* so wss:// works on HTTPS pages.
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/go2rtc/api/ws?src=${camera.streamName}`;

    let ws: WebSocket | null = null;
    let mseSourceBuffer: SourceBuffer | null = null;
    let mse: MediaSource | null = null;
    let mseQueue: ArrayBuffer[] = [];

    function startMSE() {
      mse = new MediaSource();
      video.src = URL.createObjectURL(mse);
      mse.addEventListener("sourceopen", () => {
        ws?.send(JSON.stringify({ type: "mse", value: "" }));
      }, { once: true });
    }

    function onMseMessage(msg: any) {
      if (msg.type === "mse") {
        const codecs = msg.value;
        console.log(`[cam:${camera.streamName}] MSE codecs: ${codecs}`);
        if (mse && mse.readyState === "open") {
          const mimeTypes = [
            `video/mp4; codecs="${codecs}"`,
            'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
            'video/mp4; codecs="avc1.640029,mp4a.40.2"',
          ];
          for (const mime of mimeTypes) {
            if (MediaSource.isTypeSupported(mime)) {
              console.log(`[cam:${camera.streamName}] Using MIME: ${mime}`);
              try {
                mseSourceBuffer = mse.addSourceBuffer(mime);
                mseSourceBuffer.mode = "segments";
                mseSourceBuffer.addEventListener("updateend", () => {
                  if (mseQueue.length > 0 && !mseSourceBuffer!.updating) {
                    mseSourceBuffer!.appendBuffer(mseQueue.shift()!);
                  }
                });
                setStatus("live");
                return;
              } catch (e) {
                console.warn(`[cam:${camera.streamName}] addSourceBuffer failed for ${mime}:`, e);
              }
            }
          }
          console.error(`[cam:${camera.streamName}] No supported MIME type found`);
          setStatus("error");
        }
      }
    }

    ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => { startMSE(); };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        onMseMessage(JSON.parse(ev.data));
      } else if (ev.data instanceof ArrayBuffer) {
        if (mseSourceBuffer && !mseSourceBuffer.updating) {
          mseSourceBuffer.appendBuffer(ev.data);
        } else {
          mseQueue.push(ev.data);
        }
      }
    };

    ws.onerror = () => setStatus("error");
    ws.onclose = () => setStatus("error");

    return () => {
      ws?.close();
      if (mse && mse.readyState === "open") {
        try { mse.endOfStream(); } catch {}
      }
      video.remove();
    };
  }, [camera.streamName]);

  return (
    <div className="cam-feed" ref={containerRef}>
      <div className="cam-overlay">
        <span className="cam-name">{camera.name}</span>
        {status === "connecting" && <span className="cam-badge cam-badge-connecting">Connecting</span>}
        {status === "error" && <span className="cam-badge cam-badge-error">Error</span>}
        {status === "live" && <span className="cam-badge cam-badge-live">LIVE</span>}
      </div>
    </div>
  );
}

export function CamerasPage({ onBack }: { onBack: () => void }) {
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCameras() {
      const allCameras: CameraInfo[] = [];

      // Load Protect cameras
      try {
        const res = await fetch(`${API}/api/protect/status`);
        const data: ProtectStatus = await res.json();
        for (const cam of data.cameras.filter((c) => c.isConnected)) {
          allCameras.push({
            id: cam.id,
            name: cam.name,
            streamName: toStreamName(cam.name),
            group: "Security",
          });
        }
      } catch {}

      // Load additional streams from go2rtc that aren't Protect cameras
      try {
        const res = await fetch(`${API}/go2rtc/api/streams`);
        const streams = await res.json() as Record<string, any>;
        const protectNames = new Set(allCameras.map((c) => c.streamName));
        for (const [name, _info] of Object.entries(streams)) {
          if (protectNames.has(name) || name.startsWith("cable_") || name.startsWith("library_")) continue;
          // Smart display name: reverse the toStreamName conversion
          const displayName = name
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase())
            .replace(/\bHiros\b/, "Hiro's");
          allCameras.push({
            id: name,
            name: displayName,
            streamName: name,
            group: protectNames.size > 0 ? "Other" : "Security",
          });
        }
      } catch {}

      allCameras.sort((a, b) => {
        if (a.group !== b.group) return a.group === "Security" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      setCameras(allCameras);
      setLoading(false);
    }

    loadCameras();
  }, []);

  return (
    <div className="cam-page">
      <div className="cam-header">
        <button className="bsp-back" onClick={onBack}>&larr; Dashboard</button>
        <h2>Cameras</h2>
        <span className="cam-count">{cameras.length} cameras</span>
      </div>
      {loading ? (
        <div className="cam-loading">Loading cameras...</div>
      ) : (
        <div className="cam-grid">
          {cameras.map((cam) => (
            <CameraFeed key={cam.id} camera={cam} />
          ))}
        </div>
      )}
    </div>
  );
}
