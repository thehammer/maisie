import { useCallback, useState, useEffect, lazy, Suspense } from "react";
import type { Device, NasHealth, PlexStatus, HdhrStatus, CalibreStatus } from "@maisie/shared";
import { useApi } from "./hooks/useApi";
import { useMqtt } from "./hooks/useMqtt";
import { NetworkCard } from "./components/NetworkCard";
import { ServiceStatus } from "./components/ServiceStatus";
import { NowPlayingCard } from "./components/NowPlayingCard";
import { RecentlyAddedCard } from "./components/RecentlyAddedCard";
import { CalibreEnrichmentCard } from "./components/CalibreEnrichmentCard";
import { NightlyCard } from "./components/NightlyCard";
import { YouTubeCleanupCard } from "./components/YouTubeCleanupCard";

// Lazy-loaded pages — split into separate chunks
const MediaSearchPage = lazy(() => import("./pages/MediaSearchPage").then((m) => ({ default: m.MediaSearchPage })));
const ModelViewerPage = lazy(() => import("./pages/ModelViewerPage").then((m) => ({ default: m.ModelViewerPage })));
const CamerasPage = lazy(() => import("./pages/CamerasPage").then((m) => ({ default: m.CamerasPage })));
const TvPage = lazy(() => import("./pages/TvPage").then((m) => ({ default: m.TvPage })));
const ChatPage = lazy(() => import("./pages/ChatPage").then((m) => ({ default: m.ChatPage })));
const PluginsPage = lazy(() => import("./pages/PluginsPage").then((m) => ({ default: m.PluginsPage })));
const PersonasPage = lazy(() => import("./pages/PersonasPage").then((m) => ({ default: m.PersonasPage })));
import { ChatPanel } from "./components/ChatPanel";
import { NotificationsFeed } from "./components/NotificationsFeed";
import { AgentStatus } from "./components/AgentStatus";
import { DraggableDashboardGrid } from "./components/DraggableDashboardGrid";
import { CardSlot } from "./components/CardSlot";
import { useLayout } from "./hooks/useLayout";
import { DynamicCard, type CardDescriptor } from "./components/DynamicCard";
import { AddCardPanel } from "./components/AddCardPanel";
import { CardConfigurator } from "./components/CardConfigurator";
import { STATIC_DESCRIPTORS, getDescriptor } from "./lib/static-descriptors";
import type { SectionConfig } from "@maisie/shared";


const POLL_INTERVAL = 30_000; // 30 seconds

// ── Default compound sections for converted cards ───────────────────────────

const NAS_SECTIONS: SectionConfig[] = [
  { sourceField: "system", title: "System", display: "record",
    visibleFields: ["model", "uptime", "cpuLoad", "ramUsedPercent"],
    rendererConfigs: {
      uptime: { type: "duration" },
      cpuLoad: { type: "percentage", warnAt: 70, critAt: 90 },
      ramUsedPercent: { type: "percentage", warnAt: 70, critAt: 90 },
    } },
  { sourceField: "volumes", title: "Volumes", display: "list",
    visibleFields: ["id", "usedPercent"],
    rendererConfigs: { usedPercent: { type: "percentage", warnAt: 85, critAt: 95 } } },
  { sourceField: "containers", title: "Containers", display: "list",
    visibleFields: ["name", "status"],
    rendererConfigs: { status: { type: "status" } } },
];

const PLEX_SECTIONS: SectionConfig[] = [
  { sourceField: "libraries", title: "Libraries", display: "list",
    visibleFields: ["title", "count"] },
  { sourceField: "nowPlaying", title: "Now Playing", display: "list",
    visibleFields: ["title", "seriesTitle", "user", "player", "state"] },
  { sourceField: "recentlyAdded", title: "Recently Added", display: "list", maxItems: 5,
    visibleFields: ["title", "seriesTitle", "seasonEpisode", "addedAt"],
    rendererConfigs: { addedAt: { type: "timestamp", format: "relative" } } },
];

const MEDIA_SECTIONS: SectionConfig[] = [
  { sourceField: "queue", title: "Downloading", display: "list",
    visibleFields: ["title", "seriesTitle", "quality", "status"],
    rendererConfigs: { status: { type: "status" } } },
  { sourceField: "upcoming", title: "Upcoming", display: "list", maxItems: 10,
    visibleFields: ["title", "seriesTitle", "type", "date", "status"],
    rendererConfigs: { status: { type: "status" }, date: { type: "timestamp", format: "date" } } },
];

const CALIBRE_SECTIONS: SectionConfig[] = [
  { sourceField: "libraries", title: "Libraries", display: "list",
    visibleFields: ["name", "bookCount"] },
  { sourceField: "recentlyAdded", title: "Recently Added", display: "list", maxItems: 5,
    visibleFields: ["title", "authors"] },
];

const MQTT_TOPICS = [
  "home/system/agent/heartbeat",
  "home/network/devices/new",
  "home/network/devices/missing",
  "home/media/plex/now_playing",
  "home/media/plex/new",
  "home/media/sonarr/downloaded",
  "home/media/sonarr/grabbed",
  "home/media/radarr/downloaded",
  "home/media/radarr/grabbed",
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
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [configuringCardId, setConfiguringCardId] = useState<string | null>(null);

  const health = useApi<{ status: string }>("/api/health", POLL_INTERVAL);
  const devicesApi = useApi<Device[]>("/api/devices", POLL_INTERVAL);
  const nasApi = useApi<NasHealth>("/api/synology/storage-health", POLL_INTERVAL);
  const plexApi = useApi<PlexStatus>("/api/plex/plex-status", POLL_INTERVAL);
  const mediaApi = useApi<any>("/api/media/calendar", POLL_INTERVAL);
  const hdhrApi = useApi<HdhrStatus>("/api/hdhr/status", POLL_INTERVAL);
  const dakboardApi = useApi<any[]>("/api/dakboard/devices", POLL_INTERVAL);
  const switchesApi = useApi<any[]>("/api/home-assistant/switches", POLL_INTERVAL);
  const bambuApi = useApi<any>("/api/bambu/print-status", POLL_INTERVAL);
  // Packages API requires Google OAuth. Skip unless we know it's configured to
  // avoid a 401 on every load. Check /api/packages/configured before polling.
  const packagesConfiguredApi = useApi<{ configured: boolean }>("/api/packages/configured", 0);
  const packagesApi = useApi<{ orders: any[]; count: number }>(
    packagesConfiguredApi.data?.configured ? "/api/packages/active" : null,
    5 * 60_000,
  );
  const calibreApi = useApi<CalibreStatus>("/api/calibre/calibre-status", POLL_INTERVAL);
  const catalogApi = useApi<CardDescriptor[]>("/api/cards/catalog", 0);

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
        case "home/media/plex/new":
          plexApi.refresh();
          break;
        case "home/media/sonarr/downloaded":
        case "home/media/sonarr/grabbed":
        case "home/media/radarr/downloaded":
        case "home/media/radarr/grabbed":
          mediaApi.refresh();
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
    [devicesApi.refresh, plexApi.refresh, nasApi.refresh, switchesApi.refresh, bambuApi.refresh, health.refresh, mediaApi.refresh],
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

  const pageFallback = <div className="dashboard"><div style={{ padding: "2rem", color: "var(--text-muted)" }}>Loading…</div></div>;

  if (page === "tv") {
    return (
      <div className="dashboard">
        <Suspense fallback={pageFallback}>
          <TvPage onBack={() => navigate("dashboard")} />
        </Suspense>
        {chatOverlay}
      </div>
    );
  }

  if (page === "media") {
    return (
      <div className="dashboard">
        <Suspense fallback={pageFallback}>
          <MediaSearchPage onBack={() => navigate("dashboard")} />
        </Suspense>
        {chatOverlay}
      </div>
    );
  }

  if (page === "cameras") {
    return (
      <div className="dashboard">
        <Suspense fallback={pageFallback}>
          <CamerasPage onBack={() => navigate("dashboard")} />
        </Suspense>
        {chatOverlay}
      </div>
    );
  }

  if (page === "model-viewer" || page.startsWith("model-viewer/")) {
    return (
      <div className="dashboard">
        <Suspense fallback={pageFallback}>
          <ModelViewerPage onBack={() => navigate("dashboard")} />
        </Suspense>
        {chatOverlay}
      </div>
    );
  }

  if (page === "chat") {
    return (
      <div className="dashboard">
        <Suspense fallback={pageFallback}>
          <ChatPage onBack={() => navigate("dashboard")} />
        </Suspense>
      </div>
    );
  }

  if (page === "plugins") {
    return (
      <div className="dashboard">
        <Suspense fallback={pageFallback}>
          <PluginsPage onBack={() => navigate("dashboard")} />
        </Suspense>
        {chatOverlay}
      </div>
    );
  }

  if (page === "personas") {
    return (
      <div className="dashboard">
        <Suspense fallback={pageFallback}>
          <PersonasPage onBack={() => navigate("dashboard")} />
        </Suspense>
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

  function renderCard(id: string, widget: import("./hooks/useLayout").CardConfig, apis: {
    services: typeof services;
    devicesApi: typeof devicesApi; nasApi: typeof nasApi; plexApi: typeof plexApi;
    mediaApi: typeof mediaApi; hdhrApi: typeof hdhrApi; dakboardApi: typeof dakboardApi;
    bambuApi: typeof bambuApi; calibreApi: typeof calibreApi; packagesApi: typeof packagesApi;
    switchesApi: typeof switchesApi;
  }) {
    switch (id) {
      case "ServiceStatus":    return <ServiceStatus services={apis.services} />;
      case "NowPlayingCard":   return apis.plexApi.data ? <NowPlayingCard nowPlaying={apis.plexApi.data.nowPlaying} /> : null;
      case "NetworkCard":      return apis.devicesApi.data ? <NetworkCard devices={apis.devicesApi.data} /> : null;
      case "NasCard":
        return STATIC_DESCRIPTORS.NasCard ? (
          <DynamicCard
            descriptor={STATIC_DESCRIPTORS.NasCard}
            endpoint={STATIC_DESCRIPTORS.NasCard.endpoint}
            data={apis.nasApi.data}
            dataLoading={apis.nasApi.loading}
            dataError={apis.nasApi.error}
            sections={widget.sections ?? NAS_SECTIONS}
            visibleFields={widget.visibleFields}
            rendererConfigs={widget.rendererConfigs}
            titleOverride={widget.title}
          />
        ) : null;
      case "PlexCard":
        return STATIC_DESCRIPTORS.PlexCard ? (
          <DynamicCard
            descriptor={STATIC_DESCRIPTORS.PlexCard}
            endpoint={STATIC_DESCRIPTORS.PlexCard.endpoint}
            data={apis.plexApi.data}
            dataLoading={apis.plexApi.loading}
            dataError={apis.plexApi.error}
            sections={widget.sections ?? PLEX_SECTIONS}
            visibleFields={widget.visibleFields ?? ["name", "version", "online"]}
            rendererConfigs={widget.rendererConfigs}
            titleOverride={widget.title}
          />
        ) : null;
      case "MediaCard":
        return STATIC_DESCRIPTORS.MediaCard ? (
          <DynamicCard
            descriptor={STATIC_DESCRIPTORS.MediaCard}
            endpoint={STATIC_DESCRIPTORS.MediaCard.endpoint}
            data={apis.mediaApi.data}
            dataLoading={apis.mediaApi.loading}
            dataError={apis.mediaApi.error}
            sections={widget.sections ?? MEDIA_SECTIONS}
            rendererConfigs={widget.rendererConfigs}
            titleOverride={widget.title}
          />
        ) : null;
      case "HdhrCard":
        return STATIC_DESCRIPTORS.HdhrCard ? (
          <DynamicCard
            descriptor={STATIC_DESCRIPTORS.HdhrCard}
            endpoint={STATIC_DESCRIPTORS.HdhrCard.endpoint}
            data={apis.hdhrApi.data}
            dataLoading={apis.hdhrApi.loading}
            dataError={apis.hdhrApi.error}
            ops={widget.ops}
            rendererConfigs={widget.rendererConfigs}
            visibleFields={widget.visibleFields ?? ["name", "channelCount", "firmware", "tuners"]}
            titleOverride={widget.title}
          />
        ) : null;
      case "DakboardCard":
        return STATIC_DESCRIPTORS.DakboardCard ? (
          <DynamicCard
            descriptor={STATIC_DESCRIPTORS.DakboardCard}
            endpoint={STATIC_DESCRIPTORS.DakboardCard.endpoint}
            pollInterval={POLL_INTERVAL}
            ops={widget.ops}
            rendererConfigs={widget.rendererConfigs}
            visibleFields={widget.visibleFields}
            titleOverride={widget.title}
          />
        ) : null;
      case "BambuCard":
        return STATIC_DESCRIPTORS.BambuCard ? (
          <DynamicCard
            descriptor={STATIC_DESCRIPTORS.BambuCard}
            endpoint={STATIC_DESCRIPTORS.BambuCard.endpoint}
            data={apis.bambuApi.data}
            dataLoading={apis.bambuApi.loading}
            dataError={apis.bambuApi.error}
            ops={widget.ops}
            rendererConfigs={widget.rendererConfigs}
            visibleFields={widget.visibleFields}
            titleOverride={widget.title}
          />
        ) : null;
      case "CalibreCard":
        return STATIC_DESCRIPTORS.CalibreCard ? (
          <DynamicCard
            descriptor={STATIC_DESCRIPTORS.CalibreCard}
            endpoint={STATIC_DESCRIPTORS.CalibreCard.endpoint}
            data={apis.calibreApi.data}
            dataLoading={apis.calibreApi.loading}
            dataError={apis.calibreApi.error}
            sections={widget.sections ?? CALIBRE_SECTIONS}
            visibleFields={widget.visibleFields ?? ["totalBooks"]}
            rendererConfigs={widget.rendererConfigs}
            titleOverride={widget.title}
          />
        ) : null;
      case "CalibreEnrichmentCard": return <CalibreEnrichmentCard pollInterval={POLL_INTERVAL} />;
      case "NightlyCard":      return <NightlyCard pollInterval={POLL_INTERVAL} />;
      case "YouTubeCleanupCard": return <YouTubeCleanupCard pollInterval={POLL_INTERVAL} />;
      case "PackagesCard":
        return STATIC_DESCRIPTORS.PackagesCard ? (
          <DynamicCard
            descriptor={STATIC_DESCRIPTORS.PackagesCard}
            endpoint={STATIC_DESCRIPTORS.PackagesCard.endpoint}
            data={apis.packagesApi.data?.orders ?? null}
            dataLoading={apis.packagesApi.loading}
            dataError={apis.packagesApi.error}
            ops={widget.ops ?? [{ type: "limit", n: 10 }]}
            rendererConfigs={widget.rendererConfigs}
            visibleFields={widget.visibleFields}
            titleOverride={widget.title}
          />
        ) : null;
      case "RecentlyAddedCard":
        return apis.plexApi.data && apis.plexApi.data.recentlyAdded.length > 0
          ? <RecentlyAddedCard items={apis.plexApi.data.recentlyAdded} />
          : null;
      case "SmartHomeCard": {
        const lights = (apis.switchesApi.data ?? []) as Array<{ entityId: string; name: string; state: string; brightness?: number }>;
        // switchesApi.data contains all HA entities — lights endpoint is separate
        // Merge both into a single list for the DynamicCard
        const smartHomeData = lights.map((d) => ({
          ...d,
          state: d.state === "on" ? "on" : "off",
        }));
        return STATIC_DESCRIPTORS.SmartHomeCard && smartHomeData.length > 0 ? (
          <DynamicCard
            descriptor={STATIC_DESCRIPTORS.SmartHomeCard}
            data={smartHomeData}
            dataLoading={apis.switchesApi.loading}
            dataError={apis.switchesApi.error}
            onRefresh={apis.switchesApi.refresh}
            rendererConfigs={widget.rendererConfigs ?? {
              state: {
                type: "toggle",
                writeEndpoint: "/api/home-assistant/toggle",
                payloadField: "entityId",
              },
            }}
            visibleFields={widget.visibleFields ?? ["name", "state"]}
            titleOverride={widget.title}
          />
        ) : null;
      }
      default: {
        // Fall back to auto-rendered card from the widget catalog
        const descriptor = (catalogApi.data ?? []).find((w) => w.id === id);
        if (descriptor) return (
          <DynamicCard
            descriptor={descriptor}
            pollInterval={POLL_INTERVAL}
            ops={widget.ops}
            rendererConfigs={widget.rendererConfigs}
            visibleFields={widget.visibleFields}
            titleOverride={widget.title}
          />
        );
        return null;
      }
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
              <button className="edit-layout-btn" onClick={() => setAddCardOpen((o) => !o)}>
                {addCardOpen ? "Hide Catalog" : "+ Add Card"}
              </button>
              <button className="edit-layout-btn save" onClick={() => { layout.saveLayout(); setAddCardOpen(false); }} disabled={layout.saving}>
                {layout.saving ? "Saving…" : "Save Layout"}
              </button>
              <button className="edit-layout-btn cancel" onClick={() => { layout.cancelEditMode(); setAddCardOpen(false); }}>Cancel</button>
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
          <CardSlot
            key={widget.id}
            widget={widget}
            isEditMode={layout.isEditMode}
            onToggleVisible={() => layout.setVisible(widget.id, !widget.visible)}
            onToggleColSpan={() => layout.setColSpan(widget.id, widget.col_span === 1 ? 2 : 1)}
            onRemove={widget.id.includes(".") ? () => layout.removeCard(widget.id) : undefined}
            onConfigure={() => setConfiguringCardId(widget.id)}
          >
            {renderCard(widget.id, widget, {
              services,
              devicesApi, nasApi, plexApi, mediaApi, hdhrApi,
              dakboardApi, bambuApi, calibreApi, packagesApi,
              switchesApi,
            })}
          </CardSlot>
        ))}
      </DraggableDashboardGrid>

      <AddCardPanel
        open={addCardOpen}
        onClose={() => setAddCardOpen(false)}
        catalog={catalogApi.data ?? []}
        existingIds={new Set(layout.widgets.map((w) => w.id))}
        onAdd={(id, templateConfig) => layout.addCard(id, templateConfig)}
      />

      {configuringCardId && (() => {
        const widget = layout.widgets.find((w) => w.id === configuringCardId);
        if (!widget) return null;
        const descriptor = getDescriptor(configuringCardId, catalogApi.data ?? []);
        return (
          <CardConfigurator
            widget={widget}
            descriptor={descriptor}
            onSave={(patch) => layout.updateCardConfig(configuringCardId, patch)}
            onClose={() => setConfiguringCardId(null)}
          />
        );
      })()}

      {chatOverlay}
    </div>
  );
}
