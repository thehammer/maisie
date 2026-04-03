import { useState, useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";

const API = import.meta.env.VITE_API_URL || "";

// Track whether user has interacted (unmuted) — lets subsequent tunes start with audio
let userHasUnmuted = false;

interface Channel {
  number: string;
  name: string;
  type: "cable" | "camera" | "library";
  streamName?: string;
  callSign?: string;
}

interface NowPlayingInfo {
  title: string;
  seasonNumber: number;
  episodeNumber: number;
}

interface GuideProgram {
  title: string;
  episodeTitle?: string;
  description?: string;
  startTime: number;
  endTime: number;
  filter?: string[];
}

interface ChannelGuide {
  number: string;
  name: string;
  programs: GuideProgram[];
}

interface LibraryChannel {
  number: string;
  name: string;
  mode: string;
  content: any;
  enabled: boolean;
  iconUrl?: string | null;
  createdAt?: string;
}

interface PlexShow {
  ratingKey: string;
  title: string;
  year?: number;
  leafCount: number;
  librarySection?: string;
  libraryTitle?: string;
}

function MsePlayer({
  streamName,
  onError,
}: {
  streamName: string;
  onError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const go2rtcHost = window.location.hostname;
    const wsUrl = `ws://${go2rtcHost}:1984/api/ws?src=${streamName}`;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.className = "tv-video";
    container.prepend(video);

    let ws: WebSocket | null = null;
    let mseSourceBuffer: SourceBuffer | null = null;
    let mse: MediaSource | null = null;
    let mseQueue: ArrayBuffer[] = [];

    ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      mse = new MediaSource();
      video.src = URL.createObjectURL(mse);
      mse.addEventListener("sourceopen", () => {
        ws?.send(JSON.stringify({ type: "mse", value: "" }));
      }, { once: true });
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const msg = JSON.parse(ev.data);
        if (msg.type === "mse") {
          const codecs = msg.value;
          if (mse && mse.readyState === "open") {
            const mimeTypes = [
              `video/mp4; codecs="${codecs}"`,
              'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
              'video/mp4; codecs="avc1.640029,mp4a.40.2"',
            ];
            for (const mime of mimeTypes) {
              if (MediaSource.isTypeSupported(mime)) {
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
                } catch {}
              }
            }
            setStatus("error");
            onError();
          }
        }
      } else if (ev.data instanceof ArrayBuffer) {
        if (mseSourceBuffer && !mseSourceBuffer.updating) {
          mseSourceBuffer.appendBuffer(ev.data);
        } else {
          mseQueue.push(ev.data);
        }
      }
    };

    ws.onerror = () => { setStatus("error"); onError(); };
    ws.onclose = () => { if (status !== "live") { setStatus("error"); onError(); } };

    return () => {
      ws?.close();
      if (mse && mse.readyState === "open") {
        try { mse.endOfStream(); } catch {}
      }
      video.remove();
    };
  }, [streamName]);

  return (
    <div className="tv-player" ref={containerRef}>
      {status === "connecting" && (
        <div className="tv-player-overlay">Connecting...</div>
      )}
      {status === "error" && (
        <div className="tv-player-overlay">
          <button className="tv-retry-btn" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

function HlsPlayer({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [muted, setMuted] = useState(!userHasUnmuted);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    console.log("[hls] Starting player for", url);

    if (Hls.isSupported()) {
      const hls = new Hls({
        debug: false,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        manifestLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 6,
        nudgeMaxRetry: 10,
        maxBufferHole: 2.0,
        maxMaxBufferLength: 30,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        console.log("[hls] Manifest parsed, levels:", data.levels.length);
        if (userHasUnmuted) {
          // User already interacted — try with audio first
          video.muted = false;
          video.play()
            .then(() => {
              console.log("[hls] play() succeeded with audio");
              setMuted(false);
              setStatus("live");
            })
            .catch(() => {
              // Autoplay with audio blocked — fall back to muted
              video.muted = true;
              video.play()
                .then(() => {
                  console.log("[hls] play() succeeded (muted fallback)");
                  setMuted(true);
                  setStatus("live");
                })
                .catch((err) => {
                  console.warn("[hls] play() rejected:", err.message);
                  setStatus("error");
                });
            });
        } else {
          video.muted = true;
          video.play()
            .then(() => {
              console.log("[hls] play() succeeded (muted)");
              setStatus("live");
            })
            .catch((err) => {
              console.warn("[hls] play() rejected:", err.message);
              setStatus("error");
            });
        }
      });

      hls.on(Hls.Events.MANIFEST_LOADED, () => {
        console.log("[hls] Manifest loaded");
      });

      hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
        console.log(`[hls] Fragment loaded: sn=${data.frag.sn} dur=${data.frag.duration?.toFixed(1)}s`);
      });

      hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
        console.log(`[hls] Fragment buffered: sn=${data.frag.sn}`);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error("[hls] Error:", data.type, data.details, data.fatal ? "(FATAL)" : "", data.response ? `status=${data.response.code}` : "");
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            console.log("[hls] Attempting media error recovery");
            hls.recoverMediaError();
          } else {
            setStatus("error");
          }
        }
      });

      // Monitor for paused state and force resume — handles bufferSeekOverHole
      const watchdog = setInterval(() => {
        if (video.paused && video.readyState >= 3 && video.buffered.length > 0) {
          const buffEnd = video.buffered.end(video.buffered.length - 1);
          if (buffEnd > video.currentTime + 1) {
            console.log(`[hls] Watchdog: resuming (paused at ${video.currentTime.toFixed(1)}, buffer to ${buffEnd.toFixed(1)})`);
            video.play().catch(() => {});
          }
        }
      }, 500);

      hls.on(Hls.Events.BUFFER_APPENDED, () => {
        const buffered = video.buffered;
        if (buffered.length > 0) {
          console.log(`[hls] Buffer: ${buffered.start(0).toFixed(1)}-${buffered.end(0).toFixed(1)}s, currentTime=${video.currentTime.toFixed(1)}, paused=${video.paused}, readyState=${video.readyState}`);
        }
      });

      hls.loadSource(`${API}${url}`);
      hls.attachMedia(video);

      return () => {
        clearInterval(watchdog);
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = `${API}${url}`;
      video.addEventListener("loadedmetadata", () => {
        video.play().catch((err) => console.warn("[hls] Safari play() rejected:", err.message));
        setStatus("live");
      });
    } else {
      console.error("[hls] HLS not supported");
      setStatus("error");
    }
  }, [url]);

  const handleUnmute = () => {
    const video = videoRef.current;
    if (video) {
      video.muted = false;
      setMuted(false);
      userHasUnmuted = true;
    }
  };

  return (
    <div className="tv-player" onClick={handleUnmute}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="tv-video"
      />
      {status === "loading" && (
        <div className="tv-player-overlay">Loading stream...</div>
      )}
      {status === "live" && muted && (
        <div className="tv-player-unmute">Click to unmute</div>
      )}
      {status === "error" && (
        <div className="tv-player-overlay">Stream error</div>
      )}
    </div>
  );
}

function ShowSearch({
  onSelect,
}: {
  onSelect: (show: PlexShow) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlexShow[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`${API}/api/plex/shows?title=${encodeURIComponent(query)}`);
        if (res.ok) setResults(await res.json());
      } catch {} finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  return (
    <div className="tv-show-search">
      <input
        placeholder="Search shows in Plex..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {searching && <div className="tv-show-searching">Searching...</div>}
      {results.length > 0 && (
        <div className="tv-show-results">
          {results.map((show) => (
            <button
              key={`${show.ratingKey}-${show.librarySection}`}
              className="tv-show-result"
              onClick={() => {
                onSelect(show);
                setQuery("");
                setResults([]);
              }}
            >
              <span className="tv-show-title">{show.title}</span>
              {show.year && <span className="tv-show-year">({show.year})</span>}
              <span className="tv-show-meta">
                {show.leafCount} eps
                {show.libraryTitle && ` · ${show.libraryTitle}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface PlexPlaylistInfo {
  ratingKey: string;
  title: string;
  leafCount: number;
}

function EditChannelModal({
  channel,
  onClose,
  onSave,
}: {
  channel: LibraryChannel;
  onClose: () => void;
  onSave: () => void;
}) {
  const [name, setName] = useState(channel.name);
  const [channelNumber, setChannelNumber] = useState(channel.number);
  const [mode, setMode] = useState(channel.mode);
  const [saving, setSaving] = useState(false);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconUrlInput, setIconUrlInput] = useState("");
  const [iconSource, setIconSource] = useState<"file" | "url">("file");
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing icon
  useEffect(() => {
    const img = new Image();
    img.onload = () => setIconPreview(`${API}/api/library-channels/${channel.number}/icon`);
    img.onerror = () => {};
    img.src = `${API}/api/library-channels/${channel.number}/icon`;
  }, [channel.number]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIconFile(file);
    setIconPreview(URL.createObjectURL(file));
  };

  const handleIconUpload = async (): Promise<boolean> => {
    if (iconSource === "file" && iconFile) {
      const formData = new FormData();
      formData.append("icon", iconFile);
      const res = await fetch(`${API}/api/library-channels/${channel.number}/icon`, {
        method: "POST",
        body: formData,
      });
      return res.ok;
    } else if (iconSource === "url" && iconUrlInput.trim()) {
      const res = await fetch(`${API}/api/library-channels/${channel.number}/icon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: iconUrlInput.trim() }),
      });
      return res.ok;
    }
    return true; // no icon change
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let currentNum = channel.number;
      // Renumber if changed
      if (channelNumber !== channel.number) {
        const res = await fetch(`${API}/api/library-channels/${channel.number}/renumber`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ number: channelNumber }),
        });
        if (res.ok) currentNum = channelNumber;
      }
      // Save channel metadata
      if (name !== channel.name || mode !== channel.mode) {
        await fetch(`${API}/api/library-channels/${currentNum}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, mode }),
        });
      }
      // Upload icon if changed
      if (iconFile || (iconSource === "url" && iconUrlInput.trim())) {
        setUploadingIcon(true);
        // Use current number (may have been renumbered)
        if (iconSource === "file" && iconFile) {
          const formData = new FormData();
          formData.append("icon", iconFile);
          await fetch(`${API}/api/library-channels/${currentNum}/icon`, { method: "POST", body: formData });
        } else if (iconSource === "url" && iconUrlInput.trim()) {
          await fetch(`${API}/api/library-channels/${currentNum}/icon`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: iconUrlInput.trim() }),
          });
        }
        setUploadingIcon(false);
      }
      onSave();
    } catch {} finally {
      setSaving(false);
    }
  };

  const handleRemoveIcon = async () => {
    await fetch(`${API}/api/library-channels/${channel.number}/icon`, { method: "DELETE" });
    setIconPreview(null);
    setIconFile(null);
    setIconUrlInput("");
  };

  return (
    <div className="tv-modal-overlay" onClick={onClose}>
      <div className="tv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tv-modal-header">
          <h3>Edit Channel {channel.number}</h3>
          <button className="tv-modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="tv-modal-body">
          <label className="tv-modal-label">Channel Number</label>
          <input
            value={channelNumber}
            onChange={(e) => setChannelNumber(e.target.value)}
            placeholder="20001"
          />

          <label className="tv-modal-label">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Channel name"
          />

          <label className="tv-modal-label">Mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="marathon">Marathon (sequential)</option>
            <option value="shuffle">Shuffle (random daily)</option>
          </select>

          <label className="tv-modal-label">Channel Icon</label>
          <div className="tv-icon-section">
            {iconPreview && (
              <div className="tv-icon-preview-wrap">
                <img src={iconPreview} alt="Icon preview" className="tv-icon-preview" />
                <button className="tv-icon-remove" onClick={handleRemoveIcon}>&times;</button>
              </div>
            )}
            <div className="tv-icon-source-toggle">
              <button
                className={`tv-icon-source-btn ${iconSource === "file" ? "active" : ""}`}
                onClick={() => setIconSource("file")}
              >
                Upload File
              </button>
              <button
                className={`tv-icon-source-btn ${iconSource === "url" ? "active" : ""}`}
                onClick={() => setIconSource("url")}
              >
                From URL
              </button>
            </div>
            {iconSource === "file" ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                />
                <button
                  className="tv-icon-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {iconFile ? iconFile.name : "Choose image..."}
                </button>
              </>
            ) : (
              <input
                value={iconUrlInput}
                onChange={(e) => setIconUrlInput(e.target.value)}
                placeholder="https://example.com/icon.png"
              />
            )}
          </div>
        </div>

        <div className="tv-modal-footer">
          <button className="tv-modal-cancel" onClick={onClose}>Cancel</button>
          <button
            className="tv-modal-save"
            onClick={handleSave}
            disabled={saving || !name}
          >
            {uploadingIcon ? "Uploading icon..." : saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChannelManager({
  libraryChannels,
  onRefresh,
}: {
  libraryChannels: LibraryChannel[];
  onRefresh: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [sourceType, setSourceType] = useState<"show" | "playlist">("show");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [mode, setMode] = useState("marathon");
  const [selectedShow, setSelectedShow] = useState<PlexShow | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlexPlaylistInfo | null>(null);
  const [playlists, setPlaylists] = useState<PlexPlaylistInfo[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingChannel, setEditingChannel] = useState<LibraryChannel | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (idx: number) => {
    setDragIndex(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIndex(idx);
  };

  const handleDrop = async (idx: number) => {
    if (dragIndex === null || dragIndex === idx) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }

    // Reorder: move dragIndex item to idx position
    const sorted = [...libraryChannels].sort((a, b) => parseInt(a.number) - parseInt(b.number));
    const item = sorted[dragIndex];
    const reordered = [...sorted];
    reordered.splice(dragIndex, 1);
    reordered.splice(idx, 0, item);

    // Assign new channel numbers preserving the base (20001+)
    const baseNum = 20001;
    const order = reordered.map((ch, i) => ({
      oldNumber: ch.number,
      newNumber: String(baseNum + i),
    }));

    // Only send if something actually changed
    const changed = order.some((o) => o.oldNumber !== o.newNumber);
    if (changed) {
      await fetch(`${API}/api/library-channels/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      onRefresh();
    }

    setDragIndex(null);
    setDragOverIndex(null);
  };

  const autoAssignNumber = () => {
    const existing = libraryChannels.map((c) => parseInt(c.number));
    let next = 20001;
    while (existing.includes(next)) next++;
    return String(next);
  };

  const handleSelectShow = (show: PlexShow) => {
    setSelectedShow(show);
    setSelectedPlaylist(null);
    if (!name) setName(show.title);
    if (!number) setNumber(autoAssignNumber());
  };

  const handleSelectPlaylist = (pl: PlexPlaylistInfo) => {
    setSelectedPlaylist(pl);
    setSelectedShow(null);
    if (!name) setName(pl.title);
    if (!number) setNumber(autoAssignNumber());
  };

  const loadPlaylists = async () => {
    setLoadingPlaylists(true);
    try {
      const res = await fetch(`${API}/api/plex/playlists`);
      if (res.ok) setPlaylists(await res.json());
    } catch {} finally {
      setLoadingPlaylists(false);
    }
  };

  useEffect(() => {
    if (showForm && sourceType === "playlist" && playlists.length === 0) {
      loadPlaylists();
    }
  }, [showForm, sourceType]);

  const handleAdd = async () => {
    if (!name || !number) return;
    const content: any = sourceType === "playlist" && selectedPlaylist
      ? { type: "playlist", title: selectedPlaylist.title, playlistRatingKey: selectedPlaylist.ratingKey }
      : selectedShow
        ? { type: "show", title: selectedShow.title, librarySection: selectedShow.librarySection || "3", showRatingKey: selectedShow.ratingKey }
        : null;
    if (!content) return;

    setSaving(true);
    try {
      const res = await fetch(`${API}/api/library-channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, name, mode, content }),
      });
      if (res.ok) {
        const created = await res.json();
        setName("");
        setNumber("");
        setSelectedShow(null);
        setSelectedPlaylist(null);
        setShowForm(false);
        await onRefresh();
        // Open edit modal for the new channel to set icon
        setEditingChannel({ number, name, mode, content, enabled: true, iconUrl: null, createdAt: "" });
      }
    } catch {} finally {
      setSaving(false);
    }
  };

  const handleToggle = async (ch: LibraryChannel) => {
    await fetch(`${API}/api/library-channels/${ch.number}/toggle`, { method: "POST" });
    onRefresh();
  };

  const handleDelete = async (ch: LibraryChannel) => {
    await fetch(`${API}/api/library-channels/${ch.number}`, { method: "DELETE" });
    onRefresh();
  };

  const hasSelection = sourceType === "show" ? !!selectedShow : !!selectedPlaylist;

  return (
    <div className="tv-manager">
      <div className="tv-manager-header">
        <span className="tv-group-label" style={{ padding: 0 }}>Library Channels</span>
        <button className="tv-manager-add" onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {showForm && (
        <div className="tv-manager-form">
          <select value={sourceType} onChange={(e) => { setSourceType(e.target.value as any); setSelectedShow(null); setSelectedPlaylist(null); setName(""); }}>
            <option value="show">TV Show</option>
            <option value="playlist">Playlist</option>
          </select>

          {sourceType === "show" ? (
            <>
              <ShowSearch onSelect={handleSelectShow} />
              {selectedShow && (
                <div className="tv-show-selected">
                  {selectedShow.title} ({selectedShow.leafCount} episodes)
                </div>
              )}
            </>
          ) : (
            <>
              {loadingPlaylists ? (
                <div className="tv-show-searching">Loading playlists...</div>
              ) : (
                <div className="tv-show-results" style={{ maxHeight: "200px" }}>
                  {playlists.map((pl) => (
                    <button
                      key={pl.ratingKey}
                      className={`tv-show-result ${selectedPlaylist?.ratingKey === pl.ratingKey ? "selected" : ""}`}
                      onClick={() => handleSelectPlaylist(pl)}
                    >
                      <span className="tv-show-title">{pl.title}</span>
                      <span className="tv-show-meta">{pl.leafCount} items</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedPlaylist && (
                <div className="tv-show-selected">
                  {selectedPlaylist.title} ({selectedPlaylist.leafCount} items)
                </div>
              )}
            </>
          )}
          <input
            placeholder="Channel name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            placeholder="Channel # (e.g. 20001)"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="marathon">Marathon (sequential)</option>
            <option value="shuffle">Shuffle (random daily)</option>
          </select>
          <button onClick={handleAdd} disabled={saving || !name || !number || !hasSelection}>
            {saving ? "Saving..." : "Create Channel"}
          </button>
        </div>
      )}

      {libraryChannels.length === 0 && !showForm && (
        <div className="tv-manager-empty">No library channels configured</div>
      )}

      {[...libraryChannels].sort((a, b) => parseInt(a.number) - parseInt(b.number)).map((ch, idx) => (
        <div
          key={ch.number}
          className={`tv-manager-row ${dragOverIndex === idx ? "drag-over" : ""}`}
          draggable
          onDragStart={() => handleDragStart(idx)}
          onDragOver={(e) => handleDragOver(e, idx)}
          onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
          onDrop={() => handleDrop(idx)}
        >
          <span className="tv-drag-handle" title="Drag to reorder">&#x2630;</span>
          <span className="tv-ch-number">{ch.number}</span>
          <span className="tv-ch-name">{ch.name}</span>
          <span className="tv-manager-mode">{ch.mode}</span>
          <button
            className="tv-manager-edit"
            onClick={() => setEditingChannel(ch)}
            title="Edit channel"
          >
            Edit
          </button>
          <button
            className={`tv-manager-toggle ${ch.enabled ? "on" : "off"}`}
            onClick={() => handleToggle(ch)}
            title={ch.enabled ? "Enabled" : "Disabled"}
          >
            {ch.enabled ? "ON" : "OFF"}
          </button>
          <button className="tv-manager-delete" onClick={() => handleDelete(ch)}>
            &times;
          </button>
        </div>
      ))}

      {editingChannel && (
        <EditChannelModal
          channel={editingChannel}
          onClose={() => setEditingChannel(null)}
          onSave={() => {
            setEditingChannel(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}

function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "p" : "a";
  const hr = h % 12 || 12;
  return `${hr}:${m}${ampm}`;
}

function GuideGrid({
  channels,
  guide,
  currentChannel,
  tuning,
  onTune,
}: {
  channels: Channel[];
  guide: ChannelGuide[];
  currentChannel: Channel | null;
  tuning: boolean;
  onTune: (ch: Channel) => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const nowSec = Math.floor(now / 1000);
  const windowStart = Math.floor(nowSec / 1800) * 1800; // round down to half hour
  const windowEnd = windowStart + 4 * 3600;
  const windowDuration = windowEnd - windowStart;

  const guideMap = new Map(guide.map((g) => [g.number, g]));

  // Time markers every 30 min
  const timeMarkers: number[] = [];
  for (let t = windowStart; t <= windowEnd; t += 1800) {
    timeMarkers.push(t);
  }

  const toPercent = (sec: number) =>
    ((sec - windowStart) / windowDuration) * 100;
  const nowPercent = toPercent(nowSec);

  // 24h block for cameras and library channels
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const midnightSec = Math.floor(midnight.getTime() / 1000);

  const getPrograms = (ch: Channel): GuideProgram[] => {
    // Cable and library channels: check guide map (both have real data now)
    const fromGuide = guideMap.get(ch.number)?.programs;
    if (fromGuide && fromGuide.length > 0) return fromGuide;

    if (ch.type === "camera") {
      return [
        {
          title: `${ch.name} Live`,
          startTime: midnightSec,
          endTime: midnightSec + 86400,
        },
      ];
    }
    // Fallback for library channels without schedule data
    if (ch.type === "library") {
      return [
        {
          title: `${ch.name} Marathon`,
          startTime: midnightSec,
          endTime: midnightSec + 86400,
        },
      ];
    }
    return [];
  };

  const cableChannels = channels.filter((c) => c.type === "cable");
  const cameraChannels = channels.filter((c) => c.type === "camera");
  const libChannels = channels.filter((c) => c.type === "library");

  const renderRow = (ch: Channel) => {
    const programs = getPrograms(ch);
    const isActive = currentChannel?.number === ch.number;
    const visible = programs.filter(
      (p) => p.endTime > windowStart && p.startTime < windowEnd,
    );

    return (
      <div
        key={ch.number}
        className={`guide-row ${isActive ? "active" : ""}`}
      >
        <div
          className="guide-label"
          onClick={() => !tuning && onTune(ch)}
        >
          <span className="guide-label-name">{ch.name}</span>
          <span className="guide-label-num">{ch.number}</span>
        </div>
        <div className="guide-timeline">
          {visible.map((prog, i) => {
            const left = Math.max(0, toPercent(prog.startTime));
            const right = Math.min(100, toPercent(prog.endTime));
            const width = right - left;
            const isOnNow =
              prog.startTime <= nowSec && prog.endTime > nowSec;

            return (
              <div
                key={i}
                className={`guide-block ${isOnNow ? "on-now" : ""} ${isActive && isOnNow ? "tuned" : ""}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                onClick={() => !tuning && onTune(ch)}
                title={prog.description || prog.title}
              >
                <span className="guide-block-title">{prog.title}</span>
                {prog.episodeTitle && (
                  <span className="guide-block-ep">{prog.episodeTitle}</span>
                )}
                {(prog as any).episodeNumber && (
                  <span className="guide-block-ep">
                    {(prog as any).episodeNumber}
                  </span>
                )}
              </div>
            );
          })}
          <div
            className="guide-now-line"
            style={{ left: `${nowPercent}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="guide-grid">
      {/* Time header */}
      <div className="guide-row guide-header-row">
        <div className="guide-label">
          <span className="guide-label-name" style={{ fontSize: "0.7rem" }}>
            Today
          </span>
        </div>
        <div className="guide-timeline guide-time-header">
          {timeMarkers.map((t) => (
            <div
              key={t}
              className="guide-time-mark"
              style={{ left: `${toPercent(t)}%` }}
            >
              {formatTime(t)}
            </div>
          ))}
          <div
            className="guide-now-line"
            style={{ left: `${nowPercent}%` }}
          />
        </div>
      </div>

      {cableChannels.map(renderRow)}

      {cameraChannels.length > 0 && (
        <>
          <div className="guide-divider">Cameras</div>
          {cameraChannels.map(renderRow)}
        </>
      )}

      {libChannels.length > 0 && (
        <>
          <div className="guide-divider">Library</div>
          {libChannels.map(renderRow)}
        </>
      )}
    </div>
  );
}

export function TvPage({ onBack }: { onBack: () => void }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [libraryChannels, setLibraryChannels] = useState<LibraryChannel[]>([]);
  const [guide, setGuide] = useState<ChannelGuide[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [streamName, setStreamName] = useState<string | null>(null);
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingInfo | null>(null);
  const [tuning, setTuning] = useState(false);
  const [showManager, setShowManager] = useState(false);
  const prevDynamicChannel = useRef<{ channel: string; type: string } | null>(null);

  const loadChannels = useCallback(async () => {
    try {
      const [chRes, libRes, guideRes] = await Promise.all([
        fetch(`${API}/api/tv/channels`),
        fetch(`${API}/api/library-channels`),
        fetch(`${API}/api/tv/guide?hours=4`),
      ]);
      const chData: Channel[] = await chRes.json();
      const libData: LibraryChannel[] = await libRes.json();
      setChannels(chData);
      setLibraryChannels(libData);

      const guideData: ChannelGuide[] = guideRes.ok ? await guideRes.json() : [];

      // Fetch library channel schedules and merge into guide
      const libSchedulePromises = libData
        .filter((lc) => lc.enabled)
        .map(async (lc) => {
          try {
            const res = await fetch(`${API}/api/library-channels/${lc.number}/schedule?days=2`);
            if (!res.ok) return null;
            const data = await res.json();
            return {
              number: lc.number,
              name: lc.name,
              programs: (data.schedule || []).map((e: any) => ({
                title: e.title,
                episodeTitle: e.episodeTitle,
                startTime: e.startTime,
                endTime: e.endTime,
              })),
            } as ChannelGuide;
          } catch {
            return null;
          }
        });

      const libSchedules = (await Promise.all(libSchedulePromises)).filter(Boolean) as ChannelGuide[];
      setGuide([...guideData, ...libSchedules]);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const tune = useCallback(
    async (ch: Channel) => {
      if (tuning) return;
      setTuning(true);
      setNowPlaying(null);
      setStreamName(null);
      setHlsUrl(null);

      if (prevDynamicChannel.current) {
        fetch(`${API}/api/tv/untune`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(prevDynamicChannel.current),
        }).catch(() => {});
        prevDynamicChannel.current = null;
      }

      try {
        const res = await fetch(`${API}/api/tv/tune`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: ch.number }),
        });
        const data = await res.json();
        if (data.error) {
          setTuning(false);
          return;
        }
        if (data.type === "cable" || data.type === "library") {
          prevDynamicChannel.current = { channel: ch.number, type: data.type };
        }
        if (data.nowPlaying) setNowPlaying(data.nowPlaying);
        if (data.hlsUrl) {
          setHlsUrl(data.hlsUrl);
        } else {
          setStreamName(data.stream);
        }
        setCurrentChannel(ch);
      } catch {} finally {
        setTuning(false);
      }
    },
    [tuning],
  );

  useEffect(() => {
    return () => {
      if (prevDynamicChannel.current) {
        fetch(`${API}/api/tv/untune`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(prevDynamicChannel.current),
        }).catch(() => {});
      }
    };
  }, []);

  const subtitle = nowPlaying
    ? `S${String(nowPlaying.seasonNumber).padStart(2, "0")}E${String(nowPlaying.episodeNumber).padStart(2, "0")} — ${nowPlaying.title}`
    : null;

  return (
    <div className="tv-page">
      <div className="tv-header">
        <button className="bsp-back" onClick={onBack}>
          &larr; Dashboard
        </button>
        <h2>TV</h2>
        {currentChannel && (
          <span className="tv-now-watching">
            {currentChannel.name}
            {subtitle && <span className="tv-now-episode">{subtitle}</span>}
          </span>
        )}
        <button
          className="tv-manage-btn"
          onClick={() => setShowManager(!showManager)}
        >
          {showManager ? "Guide" : "Manage"}
        </button>
      </div>

      {/* Full-width player */}
      <div className="tv-player-area">
        {tuning ? (
          <div className="tv-placeholder">
            <div className="tv-tuning">Tuning...</div>
          </div>
        ) : hlsUrl ? (
          <HlsPlayer key={hlsUrl} url={hlsUrl} />
        ) : streamName ? (
          <MsePlayer
            key={streamName}
            streamName={streamName}
            onError={() => {}}
          />
        ) : (
          <div className="tv-placeholder">
            Select a channel to start watching
          </div>
        )}
      </div>

      {/* Guide grid or channel manager */}
      {loading ? (
        <div className="tv-loading">Loading channels...</div>
      ) : showManager ? (
        <ChannelManager
          libraryChannels={libraryChannels}
          onRefresh={loadChannels}
        />
      ) : (
        <GuideGrid
          channels={channels}
          guide={guide}
          currentChannel={currentChannel}
          tuning={tuning}
          onTune={tune}
        />
      )}
    </div>
  );
}
