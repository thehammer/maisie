import { useState, useEffect, useRef, useCallback } from "react";
import type { ProtectStatus } from "@maisie/shared";

const API = import.meta.env.VITE_API_URL || "";

interface CameraInfo {
  id: string;
  name: string;
  streamName: string;
  group: string;
}

// Map camera name to go2rtc stream name (must match config/go2rtc.yaml keys)
function toStreamName(name: string): string {
  return name.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
}

function CameraFeed({ camera }: { camera: CameraInfo }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use go2rtc's WebSocket API with MSE (works in Safari)
    const go2rtcHost = window.location.hostname;
    const wsUrl = `ws://${go2rtcHost}:1984/api/ws?src=${camera.streamName}`;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.className = "cam-video";
    container.prepend(video);

    let ws: WebSocket | null = null;
    let pc: RTCPeerConnection | null = null as RTCPeerConnection | null;
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
          // Safari may not support all codecs — try with reported codecs, fall back to basic H.264
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

    ws.onopen = () => {
      // Start with MSE — more reliable in Safari than WebRTC
      startMSE();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const msg = JSON.parse(ev.data);
        onMseMessage(msg);
      } else if (ev.data instanceof ArrayBuffer) {
        // Binary MSE data
        if (mseSourceBuffer && !mseSourceBuffer.updating) {
          mseSourceBuffer.appendBuffer(ev.data);
        } else {
          mseQueue.push(ev.data);
        }
      }
    };

    ws.onerror = () => setStatus("error");
    ws.onclose = () => {
      if (status !== "error") setStatus("error");
    };

    return () => {
      ws?.close();
      pc?.close();
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
