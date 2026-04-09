/**
 * Static card descriptors for hand-written cards.
 *
 * These mirror the shape of plugin-action-backed CardDescriptors but for the
 * legacy cards backed by raw Hono routes. They provide field info to the card
 * configurator and enable progressive migration to DynamicCard.
 *
 * Each descriptor declares:
 *   - id: matches the card's ID in DEFAULT_WIDGET_ORDER
 *   - endpoint: direct API URL for DynamicCard (if converted)
 *   - outputFields: what the API returns, with maisieType annotations
 */

import type { CardDescriptor } from "../components/DynamicCard";

export type StaticDescriptor = CardDescriptor & {
  /** Direct API endpoint URL (bypasses pluginName/actionName URL derivation). */
  endpoint: string;
};

export const STATIC_DESCRIPTORS: Record<string, StaticDescriptor> = {
  HdhrCard: {
    id: "HdhrCard",
    pluginName: "hdhr",
    actionName: "get_status",
    label: "HDHomeRun",
    section: "media",
    schemaType: "record",
    endpoint: "/api/hdhr/status",
    outputFields: [
      { key: "name",         type: "string",  maisieType: "string",    label: "Model Name",  optional: false },
      { key: "model",        type: "string",  maisieType: "string",    label: "Model",        optional: false },
      { key: "firmware",     type: "string",  maisieType: "string",    label: "Firmware",     optional: false },
      { key: "deviceId",     type: "string",  maisieType: "string",    label: "Device ID",    optional: false },
      { key: "channelCount", type: "number",  maisieType: "number",    label: "Channels",     optional: false },
      { key: "tuners",       type: "array",   maisieType: "collection",label: "Tuners",       optional: false },
      { key: "timestamp",    type: "string",  maisieType: "timestamp", label: "Last Updated", optional: false },
    ],
  },

  NasCard: {
    id: "NasCard",
    pluginName: "synology",
    actionName: "get_storage_health",
    label: "NAS",
    section: "system",
    schemaType: "record",
    endpoint: "/api/synology/storage-health",
    outputFields: [
      { key: "system",     type: "object",  maisieType: "record",     label: "System",       optional: false },
      { key: "volumes",    type: "array",   maisieType: "collection", label: "Volumes",      optional: false },
      { key: "disks",      type: "array",   maisieType: "collection", label: "Disks",        optional: false },
      { key: "containers", type: "array",   maisieType: "collection", label: "Containers",   optional: false },
    ],
  },

  PlexCard: {
    id: "PlexCard",
    pluginName: "plex",
    actionName: "get_plex_status",
    label: "Plex",
    section: "media",
    schemaType: "record",
    endpoint: "/api/plex/plex-status",
    outputFields: [
      { key: "name",          type: "string",  maisieType: "string",     label: "Server Name",    optional: false },
      { key: "version",       type: "string",  maisieType: "string",     label: "Version",        optional: false },
      { key: "online",        type: "boolean", maisieType: "status",     label: "Status",         optional: false },
      { key: "libraries",     type: "array",   maisieType: "collection", label: "Libraries",      optional: false },
      { key: "nowPlaying",    type: "array",   maisieType: "collection", label: "Now Playing",    optional: false },
      { key: "recentlyAdded", type: "array",   maisieType: "collection", label: "Recently Added", optional: false },
    ],
  },

  MediaCard: {
    id: "MediaCard",
    pluginName: "media",
    actionName: "get_calendar",
    label: "Media Calendar",
    section: "media",
    schemaType: "record",
    endpoint: "/api/media/calendar",
    outputFields: [
      { key: "upcoming", type: "array",  maisieType: "collection", label: "Upcoming",       optional: false },
      { key: "queue",    type: "array",  maisieType: "collection", label: "Download Queue", optional: false },
    ],
  },

  PackagesCard: {
    id: "PackagesCard",
    pluginName: "packages",
    actionName: "get_active",
    label: "Packages",
    section: "system",
    schemaType: "collection",
    endpoint: "/api/packages/active",
    outputFields: [
      { key: "description",     type: "string",  maisieType: "string",    label: "Description",    optional: false },
      { key: "retailer",        type: "string",  maisieType: "string",    label: "Retailer",       optional: false },
      { key: "carrier",         type: "string",  maisieType: "string",    label: "Carrier",        optional: true  },
      { key: "status",          type: "string",  maisieType: "status",    label: "Status",         optional: false },
      { key: "imageUrl",        type: "string",  maisieType: "image",     label: "Image",          optional: true  },
      { key: "estimatedDelivery",type: "string",  maisieType: "timestamp", label: "Est. Delivery",  optional: true  },
    ],
  },

  NetworkCard: {
    id: "NetworkCard",
    pluginName: "unifi",
    actionName: "get_devices",
    label: "Network",
    section: "network",
    schemaType: "collection",
    endpoint: "/api/devices",
    outputFields: [
      { key: "name",       type: "string",  maisieType: "string", label: "Name",        optional: false },
      { key: "mac",        type: "string",  maisieType: "string", label: "MAC",         optional: false },
      { key: "ip",         type: "string",  maisieType: "string", label: "IP",          optional: true  },
      { key: "type",       type: "string",  maisieType: "string", label: "Type",        optional: false },
      { key: "model",      type: "string",  maisieType: "string", label: "Model",       optional: true  },
      { key: "connection",  type: "string",  maisieType: "string", label: "Connection",  optional: true  },
      { key: "signal",     type: "number",  maisieType: "signal", label: "Signal",      optional: true  },
      { key: "lastSeen",   type: "string",  maisieType: "timestamp", label: "Last Seen", optional: false },
    ],
  },

  ServiceStatus: {
    id: "ServiceStatus",
    pluginName: "core",
    actionName: "services",
    label: "Services",
    section: "system",
    schemaType: "collection",
    endpoint: "",  // aggregated in App.tsx — no single endpoint
    outputFields: [
      { key: "name",   type: "string", maisieType: "string", label: "Service", optional: false },
      { key: "status", type: "string", maisieType: "status", label: "Status",  optional: false },
      { key: "detail", type: "string", maisieType: "string", label: "Detail",  optional: true  },
    ],
  },

  BambuCard: {
    id: "BambuCard",
    pluginName: "bambu",
    actionName: "get_print_status",
    label: "Bambu X1C",
    section: "devices",
    schemaType: "record",
    endpoint: "/api/bambu/print-status",
    outputFields: [
      { key: "state",         type: "string",  maisieType: "status",     label: "State",       optional: false },
      { key: "progress",      type: "number",  maisieType: "percentage", label: "Progress",    optional: true  },
      { key: "printName",     type: "string",  maisieType: "string",     label: "Print",       optional: true  },
      { key: "remainingTime", type: "number",  maisieType: "duration",   label: "Remaining",   optional: true  },
      { key: "nozzleTemp",    type: "number",  maisieType: "temperature",label: "Nozzle Temp", optional: true  },
      { key: "bedTemp",       type: "number",  maisieType: "temperature",label: "Bed Temp",    optional: true  },
    ],
  },

  DakboardCard: {
    id: "DakboardCard",
    pluginName: "dakboard",
    actionName: "get_devices",
    label: "DAKboard",
    section: "devices",
    schemaType: "collection",
    endpoint: "/api/dakboard/devices",
    outputFields: [
      { key: "name",   type: "string",  maisieType: "string", label: "Display",  optional: false },
      { key: "status", type: "string",  maisieType: "status", label: "Status",   optional: false },
      { key: "screen", type: "string",  maisieType: "string", label: "Screen",   optional: true  },
    ],
  },

  // ── Cards that stay hand-written (descriptors for configurator) ──────────

  CalibreCard: {
    id: "CalibreCard",
    pluginName: "calibre",
    actionName: "get_calibre_status",
    label: "Calibre",
    section: "media",
    schemaType: "record",
    endpoint: "/api/calibre/calibre-status",
    outputFields: [
      { key: "totalBooks",  type: "number",  maisieType: "number",     label: "Total Books",  optional: false },
      { key: "libraries",   type: "array",   maisieType: "collection", label: "Libraries",    optional: false },
      { key: "recentBooks", type: "array",   maisieType: "collection", label: "Recent Books", optional: false },
    ],
  },

  CalibreEnrichmentCard: {
    id: "CalibreEnrichmentCard",
    pluginName: "calibre",
    actionName: "get_enrichment_status",
    label: "Book Enrichment",
    section: "media",
    schemaType: "record",
    endpoint: "/api/calibre/enrichment-status",
    outputFields: [
      { key: "pending",   type: "number", maisieType: "number", label: "Pending",   optional: false },
      { key: "enriched",  type: "number", maisieType: "number", label: "Enriched",  optional: false },
      { key: "failed",    type: "number", maisieType: "number", label: "Failed",    optional: false },
    ],
  },

  NightlyCard: {
    id: "NightlyCard",
    pluginName: "core",
    actionName: "get_nightly_status",
    label: "Nightly Tasks",
    section: "system",
    schemaType: "record",
    endpoint: "/api/nightly/status",
    outputFields: [
      { key: "state",      type: "string",  maisieType: "status",    label: "State",      optional: false },
      { key: "lastRun",    type: "string",  maisieType: "timestamp", label: "Last Run",   optional: true  },
      { key: "nextRun",    type: "string",  maisieType: "timestamp", label: "Next Run",   optional: true  },
      { key: "taskCount",  type: "number",  maisieType: "number",    label: "Tasks",      optional: false },
      { key: "failedCount",type: "number",  maisieType: "number",    label: "Failed",     optional: false },
    ],
  },

  YouTubeCleanupCard: {
    id: "YouTubeCleanupCard",
    pluginName: "youtube",
    actionName: "get_cleanup_status",
    label: "YouTube Cleanup",
    section: "system",
    schemaType: "record",
    endpoint: "/api/youtube/cleanup/status",
    outputFields: [
      { key: "status",         type: "string",  maisieType: "status",     label: "Status",       optional: false },
      { key: "likesRemaining", type: "number",  maisieType: "number",     label: "Likes Left",   optional: false },
      { key: "subsRemaining",  type: "number",  maisieType: "number",     label: "Subs Left",    optional: false },
      { key: "likesRemoved",   type: "number",  maisieType: "number",     label: "Likes Removed",optional: false },
      { key: "subsRemoved",    type: "number",  maisieType: "number",     label: "Subs Removed", optional: false },
      { key: "lastRun",        type: "string",  maisieType: "timestamp",  label: "Last Run",     optional: true  },
    ],
  },

  SmartHomeCard: {
    id: "SmartHomeCard",
    pluginName: "home-assistant",
    actionName: "get_devices",
    label: "Smart Home",
    section: "devices",
    schemaType: "collection",
    endpoint: "",  // multi-API (lights + switches) — no single endpoint
    outputFields: [
      { key: "name",       type: "string",  maisieType: "string",  label: "Device",     optional: false },
      { key: "state",      type: "string",  maisieType: "status",  label: "State",      optional: false },
      { key: "brightness", type: "number",  maisieType: "percentage", label: "Brightness", optional: true  },
    ],
  },

  NowPlayingCard: {
    id: "NowPlayingCard",
    pluginName: "plex",
    actionName: "get_now_playing",
    label: "Now Playing",
    section: "media",
    schemaType: "collection",
    endpoint: "",  // derived from PlexStatus.nowPlaying
    outputFields: [
      { key: "title",         type: "string",  maisieType: "string",    label: "Title",       optional: false },
      { key: "seriesTitle",   type: "string",  maisieType: "string",    label: "Series",      optional: true  },
      { key: "seasonEpisode", type: "string",  maisieType: "string",    label: "Episode",     optional: true  },
      { key: "user",          type: "string",  maisieType: "string",    label: "User",        optional: false },
      { key: "player",        type: "string",  maisieType: "string",    label: "Player",      optional: false },
      { key: "state",         type: "string",  maisieType: "status",    label: "State",       optional: false },
      { key: "thumb",         type: "string",  maisieType: "image",     label: "Cover Art",   optional: true  },
      { key: "progress",      type: "number",  maisieType: "duration",  label: "Progress",    optional: false },
      { key: "duration",      type: "number",  maisieType: "duration",  label: "Duration",    optional: false },
    ],
  },

  RecentlyAddedCard: {
    id: "RecentlyAddedCard",
    pluginName: "plex",
    actionName: "get_recently_added",
    label: "Recently Added",
    section: "media",
    schemaType: "collection",
    endpoint: "",  // derived from PlexStatus.recentlyAdded — no direct endpoint
    outputFields: [
      { key: "title",    type: "string",  maisieType: "string",    label: "Title",     optional: false },
      { key: "type",     type: "string",  maisieType: "string",    label: "Type",      optional: false },
      { key: "thumb",    type: "string",  maisieType: "image",     label: "Thumbnail", optional: true  },
      { key: "addedAt",  type: "number",  maisieType: "epoch_ms",  label: "Added",     optional: false },
    ],
  },

};

/**
 * Get a descriptor for any card ID — either from the static registry or
 * from the catalog API. Returns undefined if not found in either.
 */
export function getDescriptor(
  id: string,
  catalog: CardDescriptor[],
): CardDescriptor | StaticDescriptor | undefined {
  return STATIC_DESCRIPTORS[id] ?? catalog.find((d) => d.id === id);
}
