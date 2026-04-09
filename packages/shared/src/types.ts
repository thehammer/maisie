// Core types shared across agent and dashboard

export type DeviceStatus = "trusted" | "known" | "new" | "suspicious" | "blocked";

export type DeviceType =
  | "ap"
  | "switch"
  | "camera"
  | "plug"
  | "tv"
  | "phone"
  | "computer"
  | "tablet"
  | "iot"
  | "printer"
  | "server"
  | "network"
  | "streaming"
  | "gaming"
  | "thermostat"
  | "sensor"
  | "speaker"
  | "appliance"
  | "irrigation"
  | "garage"
  | "robot"
  | "bed"
  | "tuner"
  | "display"
  | "av"
  | "health"
  | "wearable"
  | "unknown"
  | (string & {});

export interface Device {
  mac: string;
  ip: string | null;
  hostname: string | null;
  ouiManufacturer: string | null;
  deviceType: DeviceType;
  deviceDescription: string | null;
  openPorts: number[];
  services: Record<string, unknown>;
  networkSegment: string | null;
  status: DeviceStatus;
  firstSeen: string;
  lastSeen: string;
  dnsPatterns: string[];
  notes: string | null;
}

export interface EventLogEntry {
  id: number;
  timestamp: string;
  topic: string;
  payload: Record<string, unknown>;
  source: string;
}

export interface HealthStatus {
  skill: string;
  status: "healthy" | "degraded" | "down";
  lastCheck: string;
  message?: string;
}

// Synology NAS types

export interface NasVolume {
  id: string;
  status: string;
  totalBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface NasDisk {
  id: string;
  name: string;
  vendor: string;
  model: string;
  temp: number;
  smartStatus: string;
  sizeBytes: number;
}

export interface NasSystemInfo {
  model: string;
  dsmVersion: string;
  uptime: number;
  cpuLoad: number;
  ramUsedPercent: number;
  temp: number;
}

export interface DockerContainer {
  name: string;
  image: string;
  status: string;
  state: "running" | "stopped" | "exited" | "created";
  uptime?: number;
}

export interface NasHealth {
  system: NasSystemInfo;
  volumes: NasVolume[];
  disks: NasDisk[];
  containers: DockerContainer[];
  timestamp: string;
}

// Home Assistant types

export interface SmartDevice {
  entityId: string;
  domain: string;
  name: string;
  state: string;
  attributes: Record<string, any>;
  lastChanged: string;
}

export interface SmartLight extends SmartDevice {
  domain: "light";
  brightness?: number;
  rgb?: [number, number, number];
  colorTemp?: number;
}

export interface SmartScene {
  entityId: string;
  name: string;
}

// Plex types

export interface PlexNowPlaying {
  title: string;
  type: "movie" | "episode";
  year?: number;
  seriesTitle?: string;
  seasonEpisode?: string;
  user: string;
  player: string;
  state: "playing" | "paused" | "buffering";
  transcoding: boolean;
  progress: number;
  duration: number;
  /** Poster/cover art URL (full URL with Plex token). */
  thumb?: string;
  /** Background art URL (full URL with Plex token). */
  art?: string;
}

export interface PlexRecentlyAdded {
  title: string;
  type: "movie" | "episode";
  year?: number;
  seriesTitle?: string;
  seasonEpisode?: string;
  addedAt: string;
  thumb?: string;
}

export interface PlexLibrary {
  id: string;
  title: string;
  type: string;
  count: number;
}

// HDHomeRun types

export interface HdhrTunerStatus {
  id: string;
  active: boolean;
  channel?: string;
  channelName?: string;
  signalStrength?: number;
}

export interface HdhrStatus {
  name: string;
  model: string;
  firmware: string;
  deviceId: string;
  tuners: HdhrTunerStatus[];
  channelCount: number;
  timestamp: string;
}

export interface PlexStatus {
  name: string;
  version: string;
  online: boolean;
  libraries: PlexLibrary[];
  nowPlaying: PlexNowPlaying[];
  recentlyAdded: PlexRecentlyAdded[];
  timestamp: string;
}

// Calibre types

export interface CalibreLibrary {
  id: string;
  name: string;
  bookCount: number;
}

export interface CalibreStatus {
  libraries: CalibreLibrary[];
  totalBooks: number;
  totalAuthors: number;
  totalTags: number;
  formats: Record<string, number>;
  recentlyAdded: { id: number; title: string; authors: string[]; added: string }[];
  timestamp: string;
}

// Calibre Enrichment types

export type EnrichmentStatus = "pending" | "enriched" | "reviewed" | "applied" | "skipped" | "error";

export interface EnrichmentEntry {
  bookId: number;
  libraryId: string | null;
  title: string | null;
  authors: string[];
  status: EnrichmentStatus;
  scanDate: string | null;
  gaps: {
    tags: boolean;
    identifiers: boolean;
    series: boolean;
    rating: boolean;
    description: boolean;
    author: boolean;
  };
  proposedChanges: {
    tags?: string[];
    isbn?: string;
    series?: string;
    seriesIndex?: number;
    description?: string;
    authors?: string[];
  } | null;
  changeSource: string | null;
  confidence: number | null;
  reviewedAt: string | null;
  appliedAt: string | null;
  errorMessage: string | null;
}

export interface EnrichmentStats {
  total: number;
  pending: number;
  enriched: number;
  reviewed: number;
  applied: number;
  skipped: number;
  error: number;
  gapBreakdown: {
    tags: number;
    identifiers: number;
    series: number;
    rating: number;
    description: number;
    author: number;
  };
}

export interface AuthorVariant {
  variant: string;
  canonical: string;
  bookCount: number;
}

// UniFi Protect types

export interface ProtectCamera {
  id: string;
  name: string;
  type: string;
  state: string;
  host: string;
  mac: string;
  firmwareVersion: string;
  isConnected: boolean;
  isRecording: boolean;
  isMotionDetected: boolean;
  lastMotionEventId: string | null;
  upSince: number | null;
  connectedSince: number | null;
  channels: ProtectCameraChannel[];
}

export interface ProtectCameraChannel {
  id: number;
  name: string;
  enabled: boolean;
  isRtspEnabled: boolean;
  rtspAlias: string | null;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}

export interface ProtectNvr {
  id: string;
  name: string;
  host: string;
  mac: string;
  firmwareVersion: string;
  uptime: number;
  isRecordingDisabled: boolean;
  storageUsedBytes: number;
  storageTotalBytes: number;
  recordingRetentionDays: number;
}

export interface ProtectEvent {
  id: string;
  type: string;
  start: number;
  end: number | null;
  camera: string;
  score: number;
}

export interface ProtectStatus {
  nvr: ProtectNvr | null;
  cameras: ProtectCamera[];
  sensorCount: number;
  lightCount: number;
  timestamp: string;
}

// Nightly maintenance types

export type NightlyRunStatus = "running" | "completed" | "stopped" | "error";

export interface NightlyRun {
  id: number;
  startedAt: string;
  stoppedAt: string | null;
  status: NightlyRunStatus;
  moviesScanned: number;
  tvScanned: number;
  filesCleaned: number;
  filesSkipped: number;
  filesErrored: number;
  spaceRecoveredBytes: number;
}

// PS4 types

export interface Ps4App {
  titleId: string;
  title: string;
  version: string;
  category: string;
  contentId: string;
  sizeMb: number | null;
  storage: "internal" | "external";
  firstSeen?: string;
  lastSeen?: string;
  removed?: boolean;
}

export interface Ps4Status {
  online: boolean;
  apps: Ps4App[];
  totalInstalled: number;
  timestamp: string;
}

export interface NightlyStatus {
  running: boolean;
  currentRun: NightlyRun | null;
  currentFile: string | null;
  totalFiles: number;
  processedFiles: number;
  windowStart: number;
  windowEnd: number;
  inWindow: boolean;
  recentRuns: NightlyRun[];
}

// BLE types

export type BleDeviceOwnership = "home" | "neighbor" | "unknown";

export interface BleDevice {
  /** BLE MAC address (or CoreBluetooth UUID on macOS) */
  mac: string;
  name: string | null;
  companyId: number | null;
  companyName: string | null;
  /** Average RSSI from recent samples */
  rssi: number;
  /** How often this device appears across scans (0-1) */
  persistence: number;
  /** Total times seen */
  seenCount: number;
  /** Total scans run */
  totalScans: number;
  ownership: BleDeviceOwnership;
  /** User-assigned room */
  room: string | null;
  /** User-friendly label */
  label: string | null;
  /** Protocol adapter name (e.g. "sleepnumber", "govee", "generic") */
  protocol: string | null;
  /** GATT services discovered on connection */
  services: string[];
  /** What this device can do (protocol-specific) */
  capabilities: Record<string, string[]>;
  /** Which gateway node discovered this device */
  gatewayNode: string;
  firstSeen: string;
  lastSeen: string;
}

export interface BleDeviceState {
  mac: string;
  protocol: string;
  state: Record<string, unknown>;
  timestamp: string;
}

export interface BleCommand {
  mac: string;
  protocol: string;
  command: string;
  params: Record<string, unknown>;
}

export interface BleCommandResult {
  mac: string;
  command: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
  timestamp: string;
}

/** Auto-claim rule — devices matching these criteria are automatically claimed as "home" */
export interface BleAutoClaimRule {
  companyId?: number;
  namePattern?: string;
  /** Minimum persistence (0-1) before auto-claim applies */
  minPersistence?: number;
}

export interface BleGatewayStatus {
  node: string;
  scanning: boolean;
  scanCount: number;
  uniqueDevices: number;
  uptime: number;
  timestamp: string;
}

