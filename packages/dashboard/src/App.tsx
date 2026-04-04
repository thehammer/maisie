import { useCallback, useState, useEffect } from "react";
import type { Device, NasHealth, PlexStatus, HdhrStatus, CalibreStatus, NightlyStatus } from "@maisie/shared";
import { useApi } from "./hooks/useApi";
import { useMqtt } from "./hooks/useMqtt";
import { NetworkCard } from "./components/NetworkCard";
import { NasCard } from "./components/NasCard";
import { PlexCard } from "./components/PlexCard";
import { MediaCard } from "./components/MediaCard";
import { ServiceStatus } from "./components/ServiceStatus";
import { SmartHomeCard } from "./components/SmartHomeCard";
import { HdhrCard } from "./components/HdhrCard";
import { DakboardCard } from "./components/DakboardCard";
import { BambuCard } from "./components/BambuCard";
import { PackagesCard } from "./components/PackagesCard";
import { RecentlyAddedCard } from "./components/RecentlyAddedCard";
import { CalibreCard } from "./components/CalibreCard";
import { CalibreEnrichmentCard } from "./components/CalibreEnrichmentCard";
import { NightlyCard } from "./components/NightlyCard";
import { YouTubeCleanupCard } from "./components/YouTubeCleanupCard";
import { MediaSearchPage } from "./pages/MediaSearchPage";
import { ModelViewerPage } from "./pages/ModelViewerPage";
import { CamerasPage } from "./pages/CamerasPage";
import { TvPage } from "./pages/TvPage";
import { BridgePage } from "./pages/BridgePage";
import { BridgeAgentPage } from "./pages/BridgeAgentPage";
import { ChatPage } from "./pages/ChatPage";
import { PluginsPage } from "./pages/PluginsPage";
import { PersonasPage } from "./pages/PersonasPage";
import { ChatPanel } from "./components/ChatPanel";
import { NotificationsFeed } from "./components/NotificationsFeed";
import { AgentStatus } from "./components/AgentStatus";
import { DraggableDashboardGrid } from "./components/DraggableDashboardGrid";
import { WidgetSlot } from "./components/WidgetSlot";
import { useLayout } from "./hooks/useLayout";


const POLL_INTERVAL = 30_000; // 30 seconds

const MQTT_TOPICS = [
  "home/system/agent/heartbeat",
  "home/network/devices/new",
  "home/network/devices/missing",
  "home/media/plex/now_playing",
  "home/nas/health",
  "home/smarthome/state",
  "home/printer/status",
  "home/system/nightly/status",
];

function useHashRoute() {
  const [page, setPage] = useState(window.location.hash.slice(1) || "dashboard");

  useEffect(() => {
    const onHash = () => setPage(window.location.hash.slice(1) || "dashboard");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((p: string) => {
    window.location.hash = p;
  }, []);

  return { page, navigate };
}

export function App() {
  const { page, navigate } = useHashRoute();
  const [notifCount, setNotifCount] = useState(0);
  const [notifsOpen, setNotifsOpen] = useState(false);

  const health = useApi<{ status: string }>("/api/health", POLL_INTERVAL);
  const devicesApi = useApi<Device[]>("/api/devices", POLL_INTERVAL);
  const nasApi = useApi<NasHealth>("/api/nas/health", POLL_INTERVAL);
  const plexApi = useApi<PlexStatus>("/api/plex/status", POLL_INTERVAL);
  const mediaApi = useApi<any>("/api/media/calendar", POLL_INTERVAL);
  const hdhrApi = useApi<HdhrStatus>("/api/hdhr/status", POLL_INTERVAL);
  const dakboardApi = useApi<any[]>("/api/dakboard/devices", POLL_INTERVAL);
  const switchesApi = useApi<any[]>("/api/ha/switches", POLL_INTERVAL);
  const bambuApi = useApi<any>("/api/bambu/status", POLL_INTERVAL);
  // Packages API requires Google OAuth. Skip unless we know it's configured to
  // avoid a 401 on every load. Check /api/packages/configured before polling.
  const packagesConfiguredApi = useApi<{ configured: boolean }>("/api/packages/configured", 0);
  const packagesApi = useApi<{ orders: any[]; count: number }>(
    packagesConfiguredApi.data?.configured ? "/api/packages/active" : null,
    5 * 60_000,
  );
  const calibreApi = useApi<CalibreStatus>("/api/calibre/status", POLL_INTERVAL);

  const layout = useLayout("home");

  // Handle live MQTT messages — refresh relevant data immediately
  const handleMqttMessage = useCallback(
    (topic: string, _payload: Record<string, unknown>) => {
      switch (topic) {
        case "home/network/devices/new":
        case "home/network/devices/missing":
          devicesApi.refresh();
          break;
        case "home/media/plex/now_playing":
          plexApi.refresh();
          break;
        case "home/nas/health":
          nasApi.refresh();
          break;
        case "home/smarthome/state":
          switchesApi.refresh();
          break;
        case "home/printer/status":
          bambuApi.refresh();
          break;
        case "home/system/agent/heartbeat":
          health.refresh();
          break;
      }
    },
    [devicesApi.refresh, plexApi.refresh, nasApi.refresh, switchesApi.refresh, bambuApi.refresh, health.refresh],
  );

  const { connected: mqttConnected } = useMqtt({
    topics: MQTT_TOPICS,
    onMessage: handleMqttMessage,
  });

  const agentUp = health.data?.status === "ok";

  const isOnChatPage = page === "chat";

  const chatOverlay = isOnChatPage ? null : (
    <>
      <ChatPanel notificationCount={notifCount} onOpenNotifications={() => setNotifsOpen(true)} />
      <NotificationsFeed open={notifsOpen} onClose={() => setNotifsOpen(false)} onCountChange={setNotifCount} />
    </>
  );

  if (page === "tv") {
    return (
      <div className="dashboard">
        <TvPage onBack={() => navigate("dashboard")} />
        {chatOverlay}
      </div>
    );
  }

  if (page === "media") {
    return (
      <div className="dashboard">
        <MediaSearchPage onBack={() => navigate("dashboard")} />
        {chatOverlay}
      </div>
    );
  }

  if (page === "cameras") {
    return (
      <div className="dashboard">
        <CamerasPage onBack={() => navigate("dashboard")} />
        {chatOverlay}
      </div>
    );
  }

  if (page === "bridge") {
    return (
      <div className="dashboard">
        <BridgePage onBack={() => navigate("dashboard")} />
        {chatOverlay}
      </div>
    );
  }

  if (page === "bridge-agent") {
    return (
      <div className="dashboard">
        <BridgeAgentPage onBack={() => navigate("dashboard")} />
        {chatOverlay}
      </div>
    );
  }

  if (page === "model-viewer" || page.startsWith("model-viewer/")) {
    return (
      <div className="dashboard">
        <ModelViewerPage onBack={() => navigate("dashboard")} />
        {chatOverlay}
      </div>
    );
  }

  if (page === "chat") {
    return (
      <div className="dashboard">
        <ChatPage onBack={() => navigate("dashboard")} />
      </div>
    );
  }

  if (page === "plugins") {
    return (
      <div className="dashboard">
        <PluginsPage onBack={() => navigate("dashboard")} />
        {chatOverlay}
      </div>
    );
  }

  if (page === "personas") {
    return (
      <div className="dashboard">
        <PersonasPage onBack={() => navigate("dashboard")} />
        {chatOverlay}
      </div>
    );
  }

  const services = [
    {
      name: "Agent",
      status: agentUp ? "connected" as const : "error" as const,
    },
    {
      name: "MQTT",
      status: mqttConnected ? "connected" as const : "error" as const,
      detail: mqttConnected ? "live" : "disconnected",
    },
    {
      name: "UniFi",
      status: devicesApi.data ? "connected" as const : devicesApi.error ? "error" as const : "unconfigured" as const,
      detail: devicesApi.data ? `${devicesApi.data.length} devices` : undefined,
    },
    {
      name: "Synology",
      status: nasApi.data ? "connected" as const : nasApi.error ? "error" as const : "unconfigured" as const,
      detail: nasApi.data ? nasApi.data.system.model : undefined,
    },
    {
      name: "Plex",
      status: plexApi.data ? "connected" as const : plexApi.error ? "error" as const : "unconfigured" as const,
      detail: plexApi.data ? plexApi.data.name : undefined,
    },
    {
      name: "Radarr",
      status: mediaApi.data ? "connected" as const : mediaApi.error ? "error" as const : "unconfigured" as const,
    },
    {
      name: "Sonarr",
      status: mediaApi.data ? "connected" as const : mediaApi.error ? "error" as const : "unconfigured" as const,
    },
    {
      name: "DAKboard",
      status: dakboardApi.data ? "connected" as const : dakboardApi.error ? "error" as const : "unconfigured" as const,
      detail: dakboardApi.data ? `${dakboardApi.data.length} displays` : undefined,
    },
    {
      name: "HDHomeRun",
      status: hdhrApi.data ? "connected" as const : hdhrApi.error ? "error" as const : "unconfigured" as const,
      detail: hdhrApi.data ? `${hdhrApi.data.tuners.length} tuners` : undefined,
    },
    {
      name: "Home Assistant",
      status: switchesApi.data ? "connected" as const : switchesApi.error ? "error" as const : "unconfigured" as const,
      detail: switchesApi.data ? `${switchesApi.data.length} switches` : undefined,
    },
    {
      name: "Bambu X1C",
      status: bambuApi.data ? "connected" as const : bambuApi.error ? "error" as const : "unconfigured" as const,
      detail: bambuApi.data ? bambuApi.data.state : undefined,
    },
    {
      name: "Calibre",
      status: calibreApi.data ? "connected" as const : calibreApi.error ? "error" as const : "unconfigured" as const,
      detail: calibreApi.data ? `${calibreApi.data.totalBooks} books` : undefined,
    },
  ];

  function renderCard(id: string, apis: {
    services: typeof services;
    devicesApi: typeof devicesApi; nasApi: typeof nasApi; plexApi: typeof plexApi;
    mediaApi: typeof mediaApi; hdhrApi: typeof hdhrApi; dakboardApi: typeof dakboardApi;
    bambuApi: typeof bambuApi; calibreApi: typeof calibreApi; packagesApi: typeof packagesApi;
    switchesApi: typeof switchesApi;
  }) {
    switch (id) {
      case "ServiceStatus":    return <ServiceStatus services={apis.services} />;
      case "NetworkCard":      return apis.devicesApi.data ? <NetworkCard devices={apis.devicesApi.data} /> : null;
      case "NasCard":          return apis.nasApi.data ? <NasCard health={apis.nasApi.data} /> : null;
      case "PlexCard":         return apis.plexApi.data ? <PlexCard status={apis.plexApi.data} /> : null;
      case "MediaCard":        return apis.mediaApi.data ? <MediaCard calendar={apis.mediaApi.data} /> : null;
      case "HdhrCard":         return apis.hdhrApi.data ? <HdhrCard status={apis.hdhrApi.data} /> : null;
      case "DakboardCard":     return <DakboardCard pollInterval={POLL_INTERVAL} />;
      case "BambuCard":        return apis.bambuApi.data ? <BambuCard status={apis.bambuApi.data} /> : null;
      case "CalibreCard":      return apis.calibreApi.data ? <CalibreCard status={apis.calibreApi.data} /> : null;
      case "CalibreEnrichmentCard": return <CalibreEnrichmentCard pollInterval={POLL_INTERVAL} />;
      case "NightlyCard":      return <NightlyCard pollInterval={POLL_INTERVAL} />;
      case "YouTubeCleanupCard": return <YouTubeCleanupCard pollInterval={POLL_INTERVAL} />;
      case "PackagesCard":     return apis.packagesApi.data ? <PackagesCard orders={apis.packagesApi.data.orders} /> : null;
      case "RecentlyAddedCard":
        return apis.plexApi.data && apis.plexApi.data.recentlyAdded.length > 0
          ? <RecentlyAddedCard items={apis.plexApi.data.recentlyAdded} />
          : null;
      case "SmartHomeCard":    return <SmartHomeCard pollInterval={POLL_INTERVAL} />;
      default:                 return null;
    }
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="dashboard-nav">
          <h1 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <img src="/favicon.svg" alt="" width="28" height="28" style={{ display: "block" }} />
            Maisie
          </h1>
          <nav className="nav-links">
            <a href="#media" className="nav-link">Media</a>
            <a href="#tv" className="nav-link">TV</a>
            <a href="#cameras" className="nav-link">Cameras</a>
            <a href="#model-viewer" className="nav-link">3D Models</a>
            <a href="#bridge" className="nav-link">Bridge</a>
            <a href="#bridge-agent" className="nav-link">Agent</a>
            <a href="#chat" className="nav-link">Chat</a>
            <a href="#plugins" className="nav-link">Plugins</a>
            <a href="#personas" className="nav-link">Personas</a>
          </nav>
        </div>
        <div className="status">
          <AgentStatus />
          <div className={`status-dot ${agentUp ? "" : "down"}`} />
          {agentUp ? "Agent connected" : "Agent offline"}
          {mqttConnected && <span className="mqtt-badge">LIVE</span>}
          {layout.isEditMode ? (
            <>
              <button className="edit-layout-btn save" onClick={layout.saveLayout} disabled={layout.saving}>
                {layout.saving ? "Saving…" : "Save Layout"}
              </button>
              <button className="edit-layout-btn cancel" onClick={layout.cancelEditMode}>Cancel</button>
            </>
          ) : (
            <button className="edit-layout-btn" onClick={layout.enterEditMode}>Edit Layout</button>
          )}
        </div>
      </div>

      <DraggableDashboardGrid
        widgets={layout.widgets}
        isEditMode={layout.isEditMode}
        onReorder={layout.reorder}
      >
        {layout.widgets.map((widget) => (
          <WidgetSlot
            key={widget.id}
            widget={widget}
            isEditMode={layout.isEditMode}
            onToggleVisible={() => layout.setVisible(widget.id, !widget.visible)}
            onToggleColSpan={() => layout.setColSpan(widget.id, widget.col_span === 1 ? 2 : 1)}
          >
            {renderCard(widget.id, {
              services,
              devicesApi, nasApi, plexApi, mediaApi, hdhrApi,
              dakboardApi, bambuApi, calibreApi, packagesApi,
              switchesApi,
            })}
          </WidgetSlot>
        ))}
      </DraggableDashboardGrid>
      {chatOverlay}
    </div>
  );
}
