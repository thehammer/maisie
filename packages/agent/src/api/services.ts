import { Hono } from "hono";
import type { Services } from "./types";

export interface ServiceStatusItem {
  name: string;
  status: "connected" | "error" | "unconfigured";
  detail?: string;
}

/**
 * GET /api/services/status
 *
 * Aggregates connection status for all configured integrations.
 * Returns the live state of the `services` object: null client = unconfigured,
 * non-null client = connected (established at startup).
 */
export function createServicesRouter(services: Services): Hono {
  const router = new Hono();

  router.get("/services/status", (c) => {
    const items: ServiceStatusItem[] = [
      { name: "Agent", status: "connected" },
      {
        name: "UniFi",
        status: services.unifi ? "connected" : "unconfigured",
      },
      {
        name: "Synology",
        status: services.dsm ? "connected" : "unconfigured",
      },
      {
        name: "Plex",
        status: services.plex ? "connected" : "unconfigured",
      },
      {
        name: "Radarr",
        status: services.radarr ? "connected" : "unconfigured",
      },
      {
        name: "Sonarr",
        status: services.sonarr ? "connected" : "unconfigured",
      },
      {
        name: "HDHomeRun",
        status: services.hdhr ? "connected" : "unconfigured",
      },
      {
        name: "Home Assistant",
        status: services.ha ? "connected" : "unconfigured",
      },
      {
        name: "DAKboard",
        status: services.dakboard ? "connected" : "unconfigured",
      },
      {
        name: "Bambu X1C",
        status: services.bambu ? "connected" : "unconfigured",
      },
      {
        name: "Calibre",
        status: services.calibre ? "connected" : "unconfigured",
      },
    ];
    return c.json(items);
  });

  return router;
}
