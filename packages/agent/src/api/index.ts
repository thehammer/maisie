import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Services } from "./types";
import { createHealthRouter } from "./health";
import { createDevicesRouter } from "./devices";
import { createNetworkRouter } from "./network";
import { createNasRouter } from "./nas";
import { createMediaRouter } from "./media";
import { createTvRouter } from "./tv";
import { createCalibreRouter } from "./calibre";
import { createGoogleRouter } from "./google";
import { createSmartHomeRouter } from "./smart-home";
import { createPrinterRouter } from "./printer";
import { createGamingRouter } from "./gaming";
import { createProtectRouter } from "./protect";
import { createMaintenanceRouter } from "./maintenance";
import { createPlexImageRouter } from "./plex-image";
import { createDashboardRouter } from "./dashboard";
import { createChatRouter } from "./chat";
import { createPluginsRouter } from "./plugins";
import { createPersonasRouter } from "./personas";
import { createLayoutRouter } from "./layout";
import { createPluginActionRouter } from "./plugin-actions";
import { createBleRouter } from "./ble";
import { createProposalsRouter } from "./proposals";
import { createProposalStore } from "../services/proposal-store";
import { createEntityRouter } from "@maisie/plugin-core/src/entity-routes";
import { createDerivedEntityStore } from "@maisie/plugin-core/src/derived-entity-store";
import { createComponentRouter } from "@maisie/plugin-core/src/component-routes";
import { createDerivedComponentStore } from "@maisie/plugin-core/src/derived-component-store";
import { createEvalRouter } from "@maisie/plugin-core/src/eval-routes";
import { createViewRouter } from "@maisie/plugin-core/src/view-routes";
import { createViewStore } from "@maisie/plugin-core/src/view-store";
import { entityRegistry } from "@maisie/plugin-core";
import type { Agent } from "../agent/index";
import type { MaisiePlugin } from "@maisie/shared";

export type { Services } from "./types";

export function createApi(services: Services, agent?: Agent, plugins: MaisiePlugin[] = []) {
  const app = new Hono();

  app.use("/*", cors());

  // Entity CRUD + field resolution API (Phase 2b)
  const derivedStore = createDerivedEntityStore(services.db as any)
  // Load persisted entities at API creation time (synchronous registry, async store).
  // Boot loading is done in entity-loader.ts before createApi is called;
  // this provides a store reference for the router to persist/delete entities.
  const entityRouter = createEntityRouter(derivedStore, {})
  app.route("/api", entityRouter);

  // Component CRUD API (Phase 2c)
  const componentStore = createDerivedComponentStore(services.db as any)
  const componentRouter = createComponentRouter(componentStore)
  app.route("/api", componentRouter);

  // Proposals API (Phase 4e)
  const proposalStore = createProposalStore(services.db as any)
  const proposalsRouter = createProposalsRouter({
    proposalStore,
    entityStore: derivedStore,
    componentStore,
  })
  app.route("/api", proposalsRouter);

  // View CRUD API (Phase 3k)
  const viewStore = createViewStore(services.db as any)
  const viewRouter = createViewRouter(viewStore)
  app.route("/api", viewRouter);

  // MEL eval endpoint (Phase 4a) — evaluate expressions without saving
  const evalRouter = createEvalRouter({})
  app.route("/api", evalRouter);

  app.route("/api", createHealthRouter(services));
  app.route("/api", createDevicesRouter(services));
  app.route("/api", createNetworkRouter(services));
  app.route("/api", createNasRouter(services));
  // plex-image must come before media so /api/plex/image/* is matched first
  app.route("/api", createPlexImageRouter(services));
  app.route("/api", createMediaRouter(services));
  app.route("/api", createTvRouter(services));
  app.route("/api", createCalibreRouter(services));
  app.route("/api", createGoogleRouter(services));
  app.route("/api", createSmartHomeRouter(services));
  app.route("/api", createPrinterRouter(services));
  app.route("/api", createGamingRouter(services));
  app.route("/api", createProtectRouter(services));
  app.route("/api", createMaintenanceRouter(services));
  app.route("/api", createBleRouter(services));
  app.route("/api", createPluginsRouter(plugins));
  app.route("/api", createPersonasRouter());
  app.route("/api", createLayoutRouter());

  // Mount custom routes from plugins BEFORE auto-router so they take precedence
  // (webhooks, image proxies, OAuth flows, streaming endpoints)
  for (const plugin of plugins) {
    if (plugin.customRoutes) {
      app.route(`/api/${plugin.name}`, plugin.customRoutes);
    }
  }

  // Generic action routing — auto-registers all plugin actions as HTTP endpoints.
  // Hand-written domain routers and custom routes above take precedence.
  app.route("/api", createPluginActionRouter(plugins, services));

  if (agent) {
    app.route("/api", createChatRouter(agent));
  }

  // LAST: catch-all for dashboard SPA
  app.route("/", createDashboardRouter(services));

  return app;
}
