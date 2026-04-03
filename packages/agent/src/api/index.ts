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
import { createBridgeRouter } from "./bridge";
import { createPlexImageRouter } from "./plex-image";
import { createDashboardRouter } from "./dashboard";
import { createChatRouter } from "./chat";
import { createPluginsRouter } from "./plugins";
import { createPersonasRouter } from "./personas";
import type { Agent } from "../agent/index";
import type { MaisiePlugin } from "@maisie/shared";

export type { Services } from "./types";

export function createApi(services: Services, agent?: Agent, plugins: MaisiePlugin[] = []) {
  const app = new Hono();

  app.use("/*", cors());

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
  app.route("/api", createBridgeRouter(services));
  app.route("/api", createPluginsRouter(plugins));
  app.route("/api", createPersonasRouter());

  if (agent) {
    app.route("/api", createChatRouter(agent));
  }

  // LAST: catch-all for dashboard SPA
  app.route("/", createDashboardRouter(services));

  return app;
}
