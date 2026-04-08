import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const devices = sqliteTable("devices", {
  mac: text("mac").primaryKey(),
  ip: text("ip"),
  hostname: text("hostname"),
  ouiManufacturer: text("oui_manufacturer"),
  deviceType: text("device_type").default("unknown"),
  deviceDescription: text("device_description"),
  openPorts: text("open_ports").default("[]"),
  services: text("services").default("{}"),
  networkSegment: text("network_segment"),
  status: text("status").default("new"),
  firstSeen: text("first_seen").notNull(),
  lastSeen: text("last_seen").notNull(),
  dnsPatterns: text("dns_patterns").default("[]"),
  notes: text("notes"),
});

export const eventLog = sqliteTable("event_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull(),
  topic: text("topic").notNull(),
  payload: text("payload").notNull(),
  source: text("source").notNull(),
});

export const schedules = sqliteTable("schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  cronExpression: text("cron_expression").notNull(),
  skill: text("skill").notNull(),
  action: text("action").notNull(),
  config: text("config").default("{}"),
  lastRun: text("last_run"),
  nextRun: text("next_run"),
  enabled: integer("enabled").default(1),
});

export const calibreEnrichment = sqliteTable("calibre_enrichment", {
  bookId: integer("book_id").primaryKey(),
  libraryId: text("library_id"),
  title: text("title"),
  authors: text("authors"),
  status: text("status").default("pending"),
  scanDate: text("scan_date"),
  gaps: text("gaps"),
  proposedChanges: text("proposed_changes"),
  changeSource: text("change_source"),
  confidence: real("confidence"),
  reviewedAt: text("reviewed_at"),
  appliedAt: text("applied_at"),
  errorMessage: text("error_message"),
});

export const calibreAuthorMap = sqliteTable("calibre_author_map", {
  variant: text("variant").primaryKey(),
  canonical: text("canonical").notNull(),
});

export const nightlyRuns = sqliteTable("nightly_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull(),
  stoppedAt: text("stopped_at"),
  status: text("status").notNull().default("running"),
  moviesScanned: integer("movies_scanned").default(0),
  tvScanned: integer("tv_scanned").default(0),
  filesCleaned: integer("files_cleaned").default(0),
  filesSkipped: integer("files_skipped").default(0),
  filesErrored: integer("files_errored").default(0),
  spaceRecoveredBytes: integer("space_recovered_bytes").default(0),
});

export const ps4Apps = sqliteTable("ps4_apps", {
  titleId: text("title_id").primaryKey(),
  title: text("title").notNull(),
  version: text("version").default(""),
  category: text("category").default("unknown"),
  contentId: text("content_id").default(""),
  sizeMb: integer("size_mb"),
  storage: text("storage").default("internal"),
  firstSeen: text("first_seen").notNull(),
  lastSeen: text("last_seen").notNull(),
  removed: integer("removed").default(0),
});

export const hdhrChannels = sqliteTable("hdhr_channels", {
  number: text("number").primaryKey(),
  name: text("name").notNull(),
  streamName: text("stream_name").notNull(), // go2rtc stream key
  cameraId: text("camera_id"), // Protect camera ID
  enabled: integer("enabled").notNull().default(1),
});

export const libraryChannels = sqliteTable("library_channels", {
  number: text("number").primaryKey(),
  name: text("name").notNull(),
  mode: text("mode").notNull(), // "marathon" | "shuffle" | "scheduled"
  content: text("content").notNull(), // JSON content config
  enabled: integer("enabled").notNull().default(1),
  iconUrl: text("icon_url"), // custom icon: stored filename or external URL
  createdAt: text("created_at").notNull(),
});

export const nightlyFiles = sqliteTable("nightly_files", {
  filePath: text("file_path").primaryKey(),
  status: text("status").notNull().default("pending"),
  originalSizeBytes: integer("original_size_bytes"),
  cleanedSizeBytes: integer("cleaned_size_bytes"),
  actions: text("actions").default("[]"),
  processedAt: text("processed_at"),
  runId: integer("run_id"),
  errorMessage: text("error_message"),
});

export const agentEpisodes = sqliteTable('agent_episodes', {
  id: text('id').primaryKey(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  trigger: text('trigger').notNull(),         // MQTT topic or 'user_message'
  persona: text('persona').notNull(),          // 'maisie' | 'natalie' | 'channing' | 'alexandria'
  summary: text('summary').notNull(),
  toolsUsed: text('tools_used'),               // JSON array of tool names called
  outcome: text('outcome').notNull(),          // 'informed' | 'advised' | 'acted'
  userApproved: integer('user_approved', { mode: 'boolean' }),
})

export const agentFacts = sqliteTable('agent_facts', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),              // JSON-encoded value
  confidence: real('confidence'),              // 0-1, null if unknown
  source: text('source'),                      // which persona set this
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const agentPreferences = sqliteTable('agent_preferences', {
  id: text('id').primaryKey(),
  domain: text('domain').notNull(),            // 'network' | 'media' | 'books' etc
  key: text('key').notNull().unique(),
  value: text('value').notNull(),              // JSON-encoded value
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

// User-defined or overridden personas (supplements built-in personas from plugins)
export const personaConfigs = sqliteTable('persona_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  role: text('role').notNull(),
  avatar: text('avatar'),
  defaultTier: text('default_tier', { enum: ['inform', 'advise', 'act'] }).notNull().default('advise'),
  eventSubscriptions: text('event_subscriptions').notNull().default('[]'), // JSON array
  toolScopes: text('tool_scopes').notNull().default('[]'), // JSON array
  systemPrompt: text('system_prompt').notNull(),
  isCustom: integer('is_custom', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// BLE device registry
export const bleDevices = sqliteTable("ble_devices", {
  mac: text("mac").primaryKey(),
  name: text("name"),
  companyId: integer("company_id"),
  companyName: text("company_name"),
  rssi: real("rssi").default(0),
  persistence: real("persistence").default(0),
  seenCount: integer("seen_count").default(0),
  totalScans: integer("total_scans").default(0),
  ownership: text("ownership").default("unknown"), // "home" | "neighbor" | "unknown"
  room: text("room"),
  label: text("label"),
  protocol: text("protocol"), // "sleepnumber" | "govee" | "generic" | null
  services: text("services").default("[]"), // JSON array of GATT service UUIDs
  capabilities: text("capabilities").default("{}"), // JSON: Record<string, string[]>
  gatewayNode: text("gateway_node").default("tokyo"),
  firstSeen: text("first_seen").notNull(),
  lastSeen: text("last_seen").notNull(),
});

// BLE auto-claim rules
export const bleAutoClaimRules = sqliteTable("ble_auto_claim_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id"),
  namePattern: text("name_pattern"),
  minPersistence: real("min_persistence"),
  ownership: text("ownership").default("home"),
  label: text("label"), // auto-assigned label when claimed
  protocol: text("protocol"), // auto-assigned protocol
  createdAt: text("created_at").notNull(),
});

// Dashboard layout per page
export const dashboardLayouts = sqliteTable('dashboard_layouts', {
  id: text('id').primaryKey(),
  page: text('page').notNull().unique(), // 'home', 'media', 'network', etc.
  widgets: text('widgets').notNull().default('[]'), // JSON: CardConfig[]
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// Card templates — saved card configurations reusable from the Add Card panel
export const cardTemplates = sqliteTable('card_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** The card descriptor ID this template is based on (e.g. "hp-printer.get_supply_levels" or "HdhrCard"). */
  descriptorId: text('descriptor_id').notNull(),
  /** JSON-encoded CardConfig fields: ops, rendererConfigs, visibleFields, sections, title. */
  config: text('config').notNull().default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// Plugin configuration overrides (env vars, enabled/disabled)
export const pluginConfigs = sqliteTable('plugin_configs', {
  id: text('id').primaryKey(),
  packageName: text('package_name').notNull().unique(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  envOverrides: text('env_overrides').notNull().default('{}'), // JSON: Record<string,string>
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
