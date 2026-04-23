import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { join } from "path";
import { mkdirSync } from "fs";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle> | null = null;

// Resolve DB path relative to the repo root (4 levels up from this file)
const REPO_ROOT = join(import.meta.dir, "../../../..");

export function initDb() {
  const dbPath = process.env.DB_PATH || join(REPO_ROOT, "data/maisie.db");
  mkdirSync(join(dbPath, ".."), { recursive: true });
  const sqlite = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  sqlite.exec("PRAGMA journal_mode = WAL");

  db = drizzle(sqlite, { schema });

  // Run migrations (create tables if they don't exist)
  migrate(sqlite);

  return db;
}

export function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

function migrate(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      mac TEXT PRIMARY KEY,
      ip TEXT,
      hostname TEXT,
      oui_manufacturer TEXT,
      device_type TEXT DEFAULT 'unknown',
      device_description TEXT,
      open_ports TEXT DEFAULT '[]',
      services TEXT DEFAULT '{}',
      network_segment TEXT,
      status TEXT DEFAULT 'new',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      dns_patterns TEXT DEFAULT '[]',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload TEXT NOT NULL,
      source TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      skill TEXT NOT NULL,
      action TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      last_run TEXT,
      next_run TEXT,
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS calibre_enrichment (
      book_id INTEGER PRIMARY KEY,
      library_id TEXT,
      title TEXT,
      authors TEXT,
      status TEXT DEFAULT 'pending',
      scan_date TEXT,
      gaps TEXT,
      proposed_changes TEXT,
      change_source TEXT,
      confidence REAL,
      reviewed_at TEXT,
      applied_at TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS calibre_author_map (
      variant TEXT PRIMARY KEY,
      canonical TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nightly_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      stopped_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      movies_scanned INTEGER DEFAULT 0,
      tv_scanned INTEGER DEFAULT 0,
      files_cleaned INTEGER DEFAULT 0,
      files_skipped INTEGER DEFAULT 0,
      files_errored INTEGER DEFAULT 0,
      space_recovered_bytes INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ps4_apps (
      title_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      version TEXT DEFAULT '',
      category TEXT DEFAULT 'unknown',
      content_id TEXT DEFAULT '',
      size_mb INTEGER,
      storage TEXT DEFAULT 'internal',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      removed INTEGER DEFAULT 0
    );

    -- Add storage column if missing (added after initial table creation)
    -- SQLite doesn't have ADD COLUMN IF NOT EXISTS, so we handle it in code below

    CREATE TABLE IF NOT EXISTS hdhr_channels (
      number TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stream_name TEXT NOT NULL,
      camera_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS library_channels (
      number TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      content TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nightly_files (
      file_path TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      original_size_bytes INTEGER,
      cleaned_size_bytes INTEGER,
      actions TEXT DEFAULT '[]',
      processed_at TEXT,
      run_id INTEGER,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_episodes (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      trigger TEXT NOT NULL,
      persona TEXT NOT NULL,
      summary TEXT NOT NULL,
      tools_used TEXT,
      outcome TEXT NOT NULL,
      user_approved INTEGER
    );

    CREATE TABLE IF NOT EXISTS agent_facts (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      confidence REAL,
      source TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_preferences (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS persona_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      avatar TEXT,
      default_tier TEXT NOT NULL DEFAULT 'advise',
      event_subscriptions TEXT NOT NULL DEFAULT '[]',
      tool_scopes TEXT NOT NULL DEFAULT '[]',
      system_prompt TEXT NOT NULL,
      is_custom INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dashboard_layouts (
      id TEXT PRIMARY KEY,
      page TEXT NOT NULL UNIQUE,
      widgets TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plugin_configs (
      id TEXT PRIMARY KEY,
      package_name TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      env_overrides TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ble_devices (
      mac TEXT PRIMARY KEY,
      name TEXT,
      company_id INTEGER,
      company_name TEXT,
      rssi REAL DEFAULT 0,
      persistence REAL DEFAULT 0,
      seen_count INTEGER DEFAULT 0,
      total_scans INTEGER DEFAULT 0,
      ownership TEXT DEFAULT 'unknown',
      room TEXT,
      label TEXT,
      protocol TEXT,
      services TEXT DEFAULT '[]',
      capabilities TEXT DEFAULT '{}',
      gateway_node TEXT DEFAULT 'tokyo',
      node_rssi TEXT DEFAULT '{}',
      estimated_room TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ble_auto_claim_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      name_pattern TEXT,
      min_persistence REAL,
      ownership TEXT DEFAULT 'home',
      label TEXT,
      protocol TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ble_gateway_nodes (
      node_id TEXT PRIMARY KEY,
      room TEXT,
      floor INTEGER DEFAULT 0,
      x REAL,
      y REAL,
      active INTEGER DEFAULT 1,
      last_seen TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS docker_services (
      service TEXT PRIMARY KEY,
      image TEXT NOT NULL,
      current_digest TEXT,
      last_checked TEXT,
      last_updated TEXT,
      auto_update INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS docker_upgrade_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL,
      image TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      checked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS derived_entities (
      name TEXT PRIMARY KEY,
      description TEXT,
      fields TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS derived_components (
      name TEXT PRIMARY KEY,
      description TEXT,
      input TEXT,
      props TEXT,
      render TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      descriptor_id TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_notes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      reasoning TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS views (
      name TEXT PRIMARY KEY,
      description TEXT,
      source TEXT NOT NULL,
      chain TEXT NOT NULL,
      component TEXT NOT NULL,
      component_props TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Column migrations — ALTER TABLE ADD COLUMN for columns added after initial release
  const addColumnIfMissing = (table: string, column: string, type: string) => {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  };
  addColumnIfMissing("ps4_apps", "storage", 'TEXT DEFAULT "internal"');
  addColumnIfMissing("library_channels", "icon_url", "TEXT");
  addColumnIfMissing("ble_devices", "node_rssi", "TEXT DEFAULT '{}'");
  addColumnIfMissing("ble_devices", "estimated_room", "TEXT");
}
